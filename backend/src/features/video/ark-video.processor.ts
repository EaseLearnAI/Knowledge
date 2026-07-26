import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { z } from "zod";
import type { AppConfig } from "../../config.js";
import { AppError } from "../../shared/errors/app-error.js";
import {
  ArkResponseClient,
  type ArkClient,
} from "./ark-response.client.js";
import type {
  ProgressReporter,
  TranscriptResult,
  VideoLanguage,
  VideoProcessInput,
  VideoProcessor,
} from "./video.types.js";

const preparedAudioSchema = z.object({
  audioPath: z.string().min(1),
  title: z.string().min(1),
  durationSeconds: z.number().nonnegative(),
  sizeBytes: z.number().int().nonnegative(),
});

const localTranscriptSchema = z.object({
  text: z.string().min(1),
  segments: z.array(
    z.object({
      start: z.number().nonnegative(),
      end: z.number().nonnegative(),
      text: z.string().min(1),
    }),
  ),
});

type PreparedAudio = z.infer<typeof preparedAudioSchema>;

export interface AudioPreparer {
  prepare(
    input: VideoProcessInput,
    workspace: string,
    report: ProgressReporter,
  ): Promise<PreparedAudio>;
}

function languageInstruction(language: VideoLanguage): string {
  if (language === "en") return "音频主要是英语。";
  if (language === "ja") return "音频主要是日语。";
  if (language === "zh") return "音频主要是中文，可能夹杂英文、方言和专有名词。";
  return "请自动判断音频语言。";
}

function compactPreparationError(stderr: string): string {
  const lines = stderr
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const preferred =
    lines.findLast((line) => line.startsWith("MEDIA_DOWNLOAD_ERROR:")) ??
    lines.findLast((line) => line.startsWith("ERROR:")) ??
    lines.at(-1) ??
    "";
  return preferred.replace(/^MEDIA_DOWNLOAD_ERROR:\s*/, "").slice(0, 600);
}

export function mapAudioPreparationError(
  stderr: string,
  exitCode: number | null,
): AppError {
  if (/video unavailable/i.test(stderr)) {
    return new AppError(
      422,
      "MEDIA_NOT_FOUND",
      "这个 YouTube 视频不存在或不可访问，请检查视频 ID（例如字母 O 和数字 0）以及公开视频权限",
    );
  }
  if (/HTTP Error 412|Precondition Failed/i.test(stderr)) {
    return new AppError(
      422,
      "MEDIA_PLATFORM_BLOCKED",
      "B站拒绝了媒体请求（HTTP 412）。请确认本机 Chrome 已登录 B站后重试；云端部署需配置 VIDEO_COOKIE_FILE",
    );
  }
  if (/sign in|cookies|login required/i.test(stderr)) {
    return new AppError(
      422,
      "MEDIA_LOGIN_REQUIRED",
      "这个视频需要平台登录权限，请确认后端 Cookie 已配置且账号有访问权限",
    );
  }
  return new AppError(
    502,
    "AUDIO_PREPARE_FAILED",
    compactPreparationError(stderr) || `音频准备脚本退出码 ${exitCode}`,
  );
}

export class PythonAudioPreparer implements AudioPreparer {
  constructor(private readonly config: AppConfig) {}

  async prepare(
    input: VideoProcessInput,
    workspace: string,
    report: ProgressReporter,
  ): Promise<PreparedAudio> {
    const binDirectory = dirname(this.config.videoSummarizeBin);
    const pythonCandidates = [
      join(binDirectory, "python3.12"),
      join(binDirectory, "python3"),
      join(binDirectory, "python"),
    ];
    const python = pythonCandidates.find(existsSync);
    if (!python) {
      throw new AppError(
        503,
        "VIDEO_PREPARER_UNAVAILABLE",
        "找不到 videosummarize 虚拟环境中的 Python",
      );
    }
    const script = resolve("scripts/prepare-cloud-audio.py");
    const args = [
      script,
      "--source",
      input.source,
      "--output-dir",
      workspace,
      ...(input.titleHint ? ["--title", input.titleHint] : []),
      ...(this.config.videoCookieBrowser
        ? ["--cookies-browser", this.config.videoCookieBrowser]
        : []),
      ...(this.config.videoCookieFile
        ? ["--cookies-file", this.config.videoCookieFile]
        : []),
    ];
    await report("audio.prepare.started", "开始下载媒体并提取压缩音频");
    const output = await this.run(python, args, report);
    // yt-dlp uses carriage returns for its progress bar, so the final JSON can
    // share a physical line with progress output. Pick the last JSON-looking
    // carriage-return/newline-delimited fragment instead of the last line.
    const jsonLine = output
      .split(/[\r\n]+/)
      .map((line) => line.trim())
      .filter((line) => line.startsWith("{") && line.endsWith("}"))
      .at(-1);
    if (!jsonLine) {
      throw new AppError(
        502,
        "AUDIO_PREPARE_OUTPUT_MISSING",
        "音频准备脚本没有返回结果",
      );
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(jsonLine);
    } catch {
      throw new AppError(
        502,
        "AUDIO_PREPARE_OUTPUT_INVALID",
        "音频准备脚本返回了无效 JSON",
      );
    }
    const prepared = preparedAudioSchema.safeParse(parsed);
    if (!prepared.success) {
      throw new AppError(
        502,
        "AUDIO_PREPARE_SCHEMA_INVALID",
        "音频准备结果不符合契约",
        prepared.error.issues,
      );
    }
    await report("audio.prepare.completed", "压缩音频准备完成", {
      durationSeconds: Math.round(prepared.data.durationSeconds),
      sizeBytes: prepared.data.sizeBytes,
      format: "mp3",
      bitrateKbps: 48,
    });
    return prepared.data;
  }

  private run(
    command: string,
    args: string[],
    report: ProgressReporter,
  ): Promise<string> {
    return new Promise((resolvePromise, reject) => {
      const child = spawn(command, args, {
        cwd: process.cwd(),
        env: { ...process.env, PYTHONUNBUFFERED: "1" },
        shell: false,
      });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (chunk: Buffer) => {
        stdout += chunk.toString("utf8");
      });
      child.stderr.on("data", (chunk: Buffer) => {
        stderr += chunk.toString("utf8");
      });
      child.on("error", (error) => {
        reject(new AppError(503, "VIDEO_PREPARER_UNAVAILABLE", error.message));
      });
      child.on("close", (code) => {
        if (code === 0) {
          resolvePromise(stdout);
          return;
        }
        const error = mapAudioPreparationError(stderr, code);
        void report("audio.prepare.failed", error.message, {
          code: error.code,
        });
        reject(error);
      });
    });
  }
}

export class ArkVideoProcessor implements VideoProcessor {
  private readonly client: ArkClient;
  private readonly preparer: AudioPreparer;

  constructor(
    private readonly config: AppConfig,
    dependencies: {
      client?: ArkClient;
      preparer?: AudioPreparer;
    } = {},
  ) {
    this.client = dependencies.client ?? new ArkResponseClient(config);
    this.preparer = dependencies.preparer ?? new PythonAudioPreparer(config);
  }

  async process(
    input: VideoProcessInput,
    report: ProgressReporter,
  ): Promise<TranscriptResult> {
    const workspace = await mkdtemp(join(tmpdir(), "memo-ark-audio-"));
    const fileIds: string[] = [];
    try {
      const prepared = await this.preparer.prepare(input, workspace, report);
      if (/(?:bilibili\.com|b23\.tv)/i.test(input.source)) {
        return await this.transcribeBilibiliLocally(
          input,
          prepared,
          workspace,
          report,
        );
      }
      const audioPaths = await this.splitAudio(
        prepared.audioPath,
        prepared.durationSeconds,
        workspace,
      );
      await report("transcription.ark.upload.started", "开始分段转写音频", {
        model: this.config.arkAudioModel,
        sizeBytes: prepared.sizeBytes,
        chunks: audioPaths.length,
        concurrency: 3,
      });
      const transcribeChunk = async (audioPath: string, index: number) => {
        const fileId = await this.client.uploadFile(audioPath, "audio/mpeg");
        fileIds.push(fileId);
        try {
          await report("transcription.ark.chunk.uploaded", "音频分段上传完成", {
            chunk: index + 1,
            chunks: audioPaths.length,
          });
          const response = await this.client.create({
            model: this.config.arkAudioModel,
            max_output_tokens: 32_768,
            instructions:
              "你是专业语音转写引擎。忠实逐字转写，不总结、不改写、不补充音频中没有的信息。只输出转录正文，不要标题、代码围栏、JSON、思考过程或额外说明。",
            input: [
              {
                role: "user",
                content: [
                  {
                    type: "input_audio",
                    file_id: fileId,
                  },
                  {
                    type: "input_text",
                    text: `${languageInstruction(input.language)}请逐字转写第 ${
                      index + 1
                    }/${audioPaths.length} 段音频，只返回正文。`,
                  },
                ],
              },
            ],
          });
          const text = response.text
            .replace(/^```(?:text|markdown)?\s*/i, "")
            .replace(/\s*```$/, "")
            .trim();
          if (!text) {
            throw new AppError(
              502,
              "ARK_EMPTY_TRANSCRIPT",
              `火山方舟没有返回第 ${index + 1} 段的转录文本`,
            );
          }
          await report("transcription.ark.chunk.completed", "音频分段转写完成", {
            chunk: index + 1,
            chunks: audioPaths.length,
            characters: text.length,
          });
          return { text, response };
        } finally {
          await this.client.deleteFile(fileId);
          const fileIndex = fileIds.indexOf(fileId);
          if (fileIndex >= 0) fileIds.splice(fileIndex, 1);
        }
      };

      const results: Awaited<ReturnType<typeof transcribeChunk>>[] = [];
      const concurrency = 3;
      for (let start = 0; start < audioPaths.length; start += concurrency) {
        const batch = audioPaths.slice(start, start + concurrency);
        const settled = await Promise.allSettled(
          batch.map((audioPath, offset) =>
            transcribeChunk(audioPath, start + offset),
          ),
        );
        for (const result of settled) {
          if (result.status === "rejected") throw result.reason;
          results.push(result.value);
        }
      }
      const texts = results.map((result) => result.text);
      const responseIds = results.map((result) => result.response.id);
      const totalInputTokens = results.reduce(
        (total, result) => total + result.response.usage.inputTokens,
        0,
      );
      const totalOutputTokens = results.reduce(
        (total, result) => total + result.response.usage.outputTokens,
        0,
      );
      const totalTokens = results.reduce(
        (total, result) => total + result.response.usage.totalTokens,
        0,
      );
      const totalAudioTokens = results.reduce(
        (total, result) => total + result.response.usage.audioTokens,
        0,
      );
      const text = texts.join("\n");
      await report("transcription.ark.completed", "火山方舟语音转写完成", {
        model: this.config.arkAudioModel,
        responseIds,
        characters: text.length,
        segments: 0,
        inputTokens: totalInputTokens,
        outputTokens: totalOutputTokens,
        totalTokens,
        audioTokens: totalAudioTokens,
      });
      return {
        title: prepared.title,
        source: input.source,
        transcriptPath: `ark://responses/${responseIds.join(",")}`,
        text,
        segments: [],
        provider: "volcengine-ark-audio-chunked",
      };
    } finally {
      await Promise.all(fileIds.map((fileId) => this.client.deleteFile(fileId)));
      await rm(workspace, { recursive: true, force: true });
    }
  }

  private async transcribeBilibiliLocally(
    input: VideoProcessInput,
    prepared: PreparedAudio,
    workspace: string,
    report: ProgressReporter,
  ): Promise<TranscriptResult> {
    const binDirectory = dirname(this.config.videoSummarizeBin);
    const python = [
      join(binDirectory, "python3.12"),
      join(binDirectory, "python3"),
      join(binDirectory, "python"),
    ].find(existsSync);
    if (!python) {
      throw new AppError(
        503,
        "LOCAL_WHISPER_UNAVAILABLE",
        "找不到本地 Whisper 虚拟环境中的 Python",
      );
    }
    const outputPath = join(workspace, "local-transcript.json");
    const model =
      input.quality === "accurate"
        ? "large-v3"
        : input.quality === "fast"
          ? "base"
          : "small";
    await report(
      "transcription.local.started",
      "B站音频开始使用本地 Whisper 转写",
      {
        model,
        durationSeconds: Math.round(prepared.durationSeconds),
        chunkSeconds: 600,
        overlapSeconds: 15,
      },
    );
    await this.runLocalTranscriber(
      python,
      [
        resolve("scripts/transcribe-prepared-audio.py"),
        "--input",
        prepared.audioPath,
        "--output",
        outputPath,
        "--model",
        model,
        "--language",
        input.language,
      ],
      report,
    );
    const parsed = localTranscriptSchema.safeParse(
      JSON.parse(await readFile(outputPath, "utf8")),
    );
    if (!parsed.success) {
      throw new AppError(
        502,
        "LOCAL_WHISPER_OUTPUT_INVALID",
        "本地 Whisper 返回结果不符合契约",
        parsed.error.issues,
      );
    }
    await report("transcription.local.completed", "本地 Whisper 转写完成", {
      model,
      characters: parsed.data.text.length,
      segments: parsed.data.segments.length,
    });
    return {
      title: prepared.title,
      source: input.source,
      transcriptPath: "local-whisper://bilibili",
      text: parsed.data.text,
      segments: parsed.data.segments.map((segment) => ({
        startMs: Math.round(segment.start * 1_000),
        endMs: Math.round(segment.end * 1_000),
        text: segment.text,
      })),
      provider: "videosummarize-local-whisper",
    };
  }

  private runLocalTranscriber(
    command: string,
    args: string[],
    report: ProgressReporter,
  ): Promise<void> {
    return new Promise((resolvePromise, reject) => {
      const child = spawn(command, args, {
        cwd: process.cwd(),
        env: { ...process.env, PYTHONUNBUFFERED: "1" },
        shell: false,
      });
      let stdoutBuffer = "";
      let stderr = "";
      child.stdout.on("data", (chunk: Buffer) => {
        stdoutBuffer += chunk.toString("utf8");
        const lines = stdoutBuffer.split(/\r?\n/);
        stdoutBuffer = lines.pop() ?? "";
        for (const line of lines) {
          try {
            const progress = JSON.parse(line) as {
              event?: string;
              done?: number;
              total?: number;
            };
            if (progress.event === "transcription.local.chunk.completed") {
              void report(
                progress.event,
                "本地 Whisper 音频分段转写完成",
                { done: progress.done, total: progress.total },
              );
            }
          } catch {
            // MLX and model download progress are diagnostic-only output.
          }
        }
      });
      child.stderr.on("data", (chunk: Buffer) => {
        stderr += chunk.toString("utf8");
      });
      child.on("error", (error) => {
        reject(new AppError(503, "LOCAL_WHISPER_UNAVAILABLE", error.message));
      });
      child.on("close", (code) => {
        if (code === 0) {
          resolvePromise();
          return;
        }
        const message =
          stderr
            .split(/\r?\n/)
            .map((line) => line.trim())
            .filter(Boolean)
            .at(-1)
            ?.slice(0, 600) ?? `本地 Whisper 退出码 ${code}`;
        reject(new AppError(502, "LOCAL_WHISPER_FAILED", message));
      });
    });
  }

  private async splitAudio(
    audioPath: string,
    durationSeconds: number,
    workspace: string,
  ): Promise<string[]> {
    // The current Ark audio model can silently truncate dense speech beyond one
    // minute even when the response succeeds. One-minute chunks are the longest
    // duration that retained stable transcript coverage in real-link probes.
    const chunkSeconds = 60;
    if (durationSeconds <= chunkSeconds) return [audioPath];
    const pattern = join(workspace, "chunk-%03d.mp3");
    await new Promise<void>((resolvePromise, reject) => {
      const child = spawn(
        "ffmpeg",
        [
          "-hide_banner",
          "-loglevel",
          "error",
          "-i",
          audioPath,
          "-f",
          "segment",
          "-segment_time",
          String(chunkSeconds),
          "-reset_timestamps",
          "1",
          "-c",
          "copy",
          "-y",
          pattern,
        ],
        { shell: false },
      );
      let stderr = "";
      child.stderr.on("data", (chunk: Buffer) => {
        stderr += chunk.toString("utf8");
      });
      child.on("error", (error) => reject(error));
      child.on("close", (code) => {
        if (code === 0) resolvePromise();
        else reject(new Error(stderr.trim() || `ffmpeg 退出码 ${code}`));
      });
    }).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : "未知错误";
      throw new AppError(
        502,
        "AUDIO_SPLIT_FAILED",
        `长音频分段失败：${message}`,
      );
    });
    const chunks = (await readdir(workspace))
      .filter((name) => /^chunk-\d+\.mp3$/.test(name))
      .sort()
      .map((name) => join(workspace, name));
    if (chunks.length === 0) {
      throw new AppError(502, "AUDIO_SPLIT_FAILED", "长音频分段没有生成文件");
    }
    return chunks;
  }
}
