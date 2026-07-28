import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { z } from "zod";
import type { AppConfig } from "../../platform/config/app-config.js";
import { AppError } from "../../platform/http/errors/app-error.js";
import { resolvePublicBilibiliContent } from "../transcription/volc/volc-asr-video.processor.js";
import type {
  ProgressReporter,
  ResolvedContent,
  VideoProcessInput,
} from "../../modules/processing/domain/video.types.js";

const resolvedContentSchema = z.object({
  kind: z.enum(["image_post", "short_video", "long_video"]),
  platform: z.enum(["bilibili", "douyin", "xiaohongshu"]),
  title: z.string().min(1),
  text: z.string().default(""),
  durationSeconds: z.number().nonnegative(),
  assets: z
    .array(
      z.object({
        kind: z.enum(["image", "video", "audio"]),
        url: z.string().url(),
        format: z.string().min(1),
        headers: z.record(z.string(), z.string()).optional(),
      }),
    )
    .min(1),
});

export interface PlatformContentResolver {
  resolve(
    input: VideoProcessInput,
    report: ProgressReporter,
  ): Promise<ResolvedContent>;
}

export class DefaultPlatformContentResolver implements PlatformContentResolver {
  constructor(private readonly config: AppConfig) {}

  async resolve(
    input: VideoProcessInput,
    report: ProgressReporter,
  ): Promise<ResolvedContent> {
    await report("content.resolve.started", "开始识别平台内容类型");
    let content: ResolvedContent;
    if (/(?:bilibili\.com|b23\.tv)/i.test(input.source)) {
      content = await resolvePublicBilibiliContent(input.source);
    } else {
      const output = await this.run([
        resolve("scripts/resolve-cloud-media.py"),
        "--source",
        input.source,
        "--content",
        ...(this.config.videoCookieBrowser
          ? ["--cookies-browser", this.config.videoCookieBrowser]
          : []),
        ...(this.config.videoCookieFile
          ? ["--cookies-file", this.config.videoCookieFile]
          : []),
      ]);
      const jsonLine = output
        .split(/[\r\n]+/)
        .map((line) => line.trim())
        .filter((line) => line.startsWith("{") && line.endsWith("}"))
        .at(-1);
      let parsed: unknown;
      try {
        parsed = JSON.parse(jsonLine ?? "");
      } catch {
        throw new AppError(
          502,
          "CONTENT_RESOLVE_OUTPUT_INVALID",
          "内容解析器没有返回合法 JSON",
        );
      }
      const result = resolvedContentSchema.safeParse(parsed);
      if (!result.success) {
        throw new AppError(
          502,
          "CONTENT_RESOLVE_SCHEMA_INVALID",
          "内容解析结果不符合契约",
          result.error.issues,
        );
      }
      content = {
        ...result.data,
        assets: result.data.assets.map((asset) => ({
          kind: asset.kind,
          url: asset.url,
          format: asset.format,
          ...(asset.headers ? { headers: asset.headers } : {}),
        })),
      };
    }
    const kind =
      content.kind === "image_post"
        ? "image_post"
        : content.durationSeconds <= this.config.minimaxShortVideoMaxSeconds
          ? "short_video"
          : "long_video";
    const normalized = { ...content, kind } satisfies ResolvedContent;
    await report("content.resolve.completed", "平台内容识别完成", {
      platform: normalized.platform,
      contentKind: normalized.kind,
      durationSeconds: Math.round(normalized.durationSeconds),
      assets: normalized.assets.length,
    });
    return normalized;
  }

  private run(args: string[]): Promise<string> {
    return new Promise((resolvePromise, reject) => {
      const child = spawn(this.config.videoResolverPython, args, {
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
        if (stderr.length < 12_000) stderr += chunk.toString("utf8");
      });
      child.on("error", (error) => {
        reject(
          new AppError(503, "CONTENT_RESOLVER_UNAVAILABLE", error.message),
        );
      });
      child.on("close", (code) => {
        if (code === 0) {
          resolvePromise(stdout);
          return;
        }
        reject(
          new AppError(
            502,
            /cookie|login|sign in/i.test(stderr)
              ? "MEDIA_LOGIN_REQUIRED"
              : "CONTENT_RESOLVE_FAILED",
            stderr.trim() || `内容解析器退出码 ${code ?? "unknown"}`,
          ),
        );
      });
    });
  }
}
