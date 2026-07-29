import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import { dirname, extname, join, resolve } from "node:path";
import type { AppConfig } from "../../../platform/config/app-config.js";
import { AppError } from "../../../platform/http/errors/app-error.js";
import type {
  ProgressReporter,
  TranscriptResult,
  VideoProcessInput,
  VideoProcessor,
} from "../../../modules/processing/domain/video.types.js";

type RawTranscript = {
  title: string;
  source?: string;
  text: string;
  segments?: Array<{ start: number; end: number; text: string }>;
};

type CommandResult = {
  stdout: string;
  stderr: string;
};

function modelFor(quality: VideoProcessInput["quality"]): string {
  if (quality === "fast") return "base";
  if (quality === "accurate") return "large-v3";
  return "small";
}

export function browserCookiesFor(
  source: string,
  configuredBrowser?: string,
): string | undefined {
  return /(bilibili\.com|b23\.tv|xiaohongshu\.com|xhslink\.com)/i.test(source)
    ? configuredBrowser ?? "chrome"
    : undefined;
}

export function videoSummarizeFailure(
  result: CommandResult,
): string | undefined {
  const output = `${result.stderr}\n${result.stdout}`;
  if (!/(?:^|\n)(?:ERROR:|Failed:\s*\d+\s+video)/im.test(output)) {
    return undefined;
  }
  if (/HTTP Error 412|Precondition Failed/i.test(output)) {
    return "B站拒绝了媒体请求（HTTP 412），请检查已配置的浏览器登录态后重试";
  }
  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => /^ERROR:/i.test(line))
    ?.replace(/^ERROR:\s*/i, "")
    ?? "videosummarize 未能下载或处理该视频";
}

function mapTranscript(raw: RawTranscript, path: string): TranscriptResult {
  return {
    title: raw.title,
    source: raw.source ?? "",
    transcriptPath: path,
    text: raw.text,
    segments: (raw.segments ?? []).map((segment) => ({
      startMs: Math.round(segment.start * 1_000),
      endMs: Math.round(segment.end * 1_000),
      text: segment.text,
    })),
    provider: "videosummarize-local-whisper",
  };
}

export class VideoSummarizeProcessor implements VideoProcessor {
  constructor(private readonly config: AppConfig) {}

  async doctor(report: ProgressReporter): Promise<void> {
    await this.run(this.config.videoSummarizeBin, ["doctor"], report);
  }

  async process(
    input: VideoProcessInput,
    report: ProgressReporter,
  ): Promise<TranscriptResult> {
    if (!existsSync(input.source)) {
      return this.processUrl(input, report);
    }
    return this.processLocalFile(input, report);
  }

  private async processUrl(
    input: VideoProcessInput,
    report: ProgressReporter,
  ): Promise<TranscriptResult> {
    await mkdir(this.config.videoWorkspace, { recursive: true });
    const args = [
      input.source,
      "-o",
      this.config.videoWorkspace,
      "-f",
      "json",
      "-m",
      modelFor(input.quality),
      "-l",
      input.language,
      "--no-keep-video",
      "--no-keep-audio",
      // MLX Whisper 在低可用内存下并行处理多个长音频分块可能异常退出。
      // 关闭分块可确保同一时间只有一个模型推理，任务队列仍负责跨任务串行。
      "--chunk-size",
      "0",
    ];
    const cookies = browserCookiesFor(
      input.source,
      this.config.videoCookieBrowser,
    );
    if (cookies) args.push("--cookies", cookies);

    await report("video.cli.started", "已发起 videosummarize 请求", {
      source: input.source,
      model: modelFor(input.quality),
      language: input.language,
      cookies: cookies ? `${cookies} 浏览器登录态` : "不需要",
      transcriptionMode: "single-worker",
    });
    const result = await this.run(this.config.videoSummarizeBin, args, report);
    const match = result.stdout.match(/transcript:\s+(.+\.json)\s*$/m);
    if (!match?.[1]) {
      const failure = videoSummarizeFailure(result);
      if (failure) {
        throw new AppError(502, "VIDEO_DOWNLOAD_FAILED", failure);
      }
      throw new AppError(
        502,
        "TRANSCRIPT_PATH_MISSING",
        "videosummarize 已结束，但未返回 transcript.json 路径",
      );
    }
    const transcriptPath = resolve(match[1].trim());
    const raw = JSON.parse(await readFile(transcriptPath, "utf8")) as RawTranscript;
    await report("video.cli.completed", "videosummarize 请求成功", {
      transcriptPath,
      characters: raw.text.length,
      segments: raw.segments?.length ?? 0,
    });
    return mapTranscript(raw, transcriptPath);
  }

  private async processLocalFile(
    input: VideoProcessInput,
    report: ProgressReporter,
  ): Promise<TranscriptResult> {
    const taskWorkspace = join(
      this.config.videoWorkspace,
      `upload-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    );
    await mkdir(taskWorkspace, { recursive: true });
    const python = join(dirname(this.config.videoSummarizeBin), "python3.12");
    const bridge = resolve("scripts/transcribe-local.py");
    const outputPath = join(taskWorkspace, "transcript.json");

    await report("video.local.started", "开始处理本地上传文件", {
      filename: input.titleHint ?? `upload${extname(input.source)}`,
      model: modelFor(input.quality),
    });
    await this.run(
      python,
      [
        bridge,
        "--input",
        input.source,
        "--output",
        outputPath,
        "--model",
        modelFor(input.quality),
        "--language",
        input.language,
        "--title",
        input.titleHint ?? "本地上传音视频",
      ],
      report,
    );
    const raw = JSON.parse(await readFile(outputPath, "utf8")) as RawTranscript;
    await report("video.local.completed", "本地文件转录完成", {
      transcriptPath: outputPath,
      characters: raw.text.length,
      segments: raw.segments?.length ?? 0,
    });
    return mapTranscript(raw, outputPath);
  }

  private run(
    command: string,
    args: string[],
    report: ProgressReporter,
  ): Promise<CommandResult> {
    return new Promise((resolvePromise, reject) => {
      const child = spawn(command, args, {
        cwd: process.cwd(),
        env: { ...process.env, PYTHONUNBUFFERED: "1" },
        shell: false,
      });
      let stdout = "";
      let stderr = "";
      let stdoutBuffer = "";
      let stderrBuffer = "";

      const publishLines = (
        chunk: Buffer,
        level: "info" | "error",
        currentBuffer: string,
      ): string => {
        const value = currentBuffer + chunk.toString("utf8");
        const lines = value.split(/\r?\n/);
        const remainder = lines.pop() ?? "";
        for (const line of lines) {
          if (line.trim()) {
            void report(
              level === "info" ? "video.cli.stdout" : "video.cli.stderr",
              line.trim(),
            );
          }
        }
        return remainder;
      };

      child.stdout.on("data", (chunk: Buffer) => {
        stdout += chunk.toString("utf8");
        stdoutBuffer = publishLines(chunk, "info", stdoutBuffer);
      });
      child.stderr.on("data", (chunk: Buffer) => {
        stderr += chunk.toString("utf8");
        stderrBuffer = publishLines(chunk, "error", stderrBuffer);
      });
      child.on("error", (error) => {
        reject(new AppError(502, "VIDEO_PROCESSOR_UNAVAILABLE", error.message));
      });
      child.on("close", (code) => {
        if (stdoutBuffer.trim()) void report("video.cli.stdout", stdoutBuffer.trim());
        if (stderrBuffer.trim()) void report("video.cli.stderr", stderrBuffer.trim());
        if (code === 0) {
          resolvePromise({ stdout, stderr });
          return;
        }
        reject(
          new AppError(
            502,
            "VIDEO_PROCESSING_FAILED",
            stderr.trim() || stdout.trim() || `videosummarize 退出码 ${code}`,
          ),
        );
      });
    });
  }
}
