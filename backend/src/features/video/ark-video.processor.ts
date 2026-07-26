import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readdir, rm } from "node:fs/promises";
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
        const value = chunk.toString("utf8");
        stderr += value;
        const message = value.trim();
        if (message) void report("audio.prepare.stderr", message);
      });
      child.on("error", (error) => {
        reject(new AppError(503, "VIDEO_PREPARER_UNAVAILABLE", error.message));
      });
      child.on("close", (code) => {
        if (code === 0) {
          resolvePromise(stdout);
          return;
        }
        const providerMessage = stderr.trim();
        if (/video unavailable/i.test(providerMessage)) {
          reject(
            new AppError(
              422,
              "MEDIA_NOT_FOUND",
              "这个 YouTube 视频不存在或不可访问，请检查视频 ID（例如字母 O 和数字 0）以及公开视频权限",
            ),
          );
          return;
        }
        if (/sign in|cookies|login required/i.test(providerMessage)) {
          reject(
            new AppError(
              422,
              "MEDIA_LOGIN_REQUIRED",
              "这个视频需要登录平台账号后才能访问，当前只支持公开链接",
            ),
          );
          return;
        }
        reject(
          new AppError(
            502,
            "AUDIO_PREPARE_FAILED",
            providerMessage || `音频准备脚本退出码 ${code}`,
          ),
        );
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
      const audioPaths = await this.splitAudio(
        prepared.audioPath,
        prepared.durationSeconds,
        workspace,
      );
      await report("transcription.ark.upload.started", "开始分段转写音频", {
        model: this.config.arkAudioModel,
        sizeBytes: prepared.sizeBytes,
        chunks: audioPaths.length,
      });
      const texts: string[] = [];
      const responseIds: string[] = [];
      let totalInputTokens = 0;
      let totalOutputTokens = 0;
      let totalTokens = 0;
      let totalAudioTokens = 0;
      for (const [index, audioPath] of audioPaths.entries()) {
        const fileId = await this.client.uploadFile(audioPath, "audio/mpeg");
        fileIds.push(fileId);
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
        texts.push(text);
        responseIds.push(response.id);
        totalInputTokens += response.usage.inputTokens;
        totalOutputTokens += response.usage.outputTokens;
        totalTokens += response.usage.totalTokens;
        totalAudioTokens += response.usage.audioTokens;
        await this.client.deleteFile(fileId);
        fileIds.splice(fileIds.indexOf(fileId), 1);
        await report("transcription.ark.chunk.completed", "音频分段转写完成", {
          chunk: index + 1,
          chunks: audioPaths.length,
          characters: text.length,
        });
      }
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

  private async splitAudio(
    audioPath: string,
    durationSeconds: number,
    workspace: string,
  ): Promise<string[]> {
    const chunkSeconds = 240;
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
