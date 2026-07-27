import { lookup } from "node:dns/promises";
import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import { isIP } from "node:net";
import { dirname, extname, join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { AppConfig } from "../../config.js";
import { AppError } from "../../shared/errors/app-error.js";
import type { ResolvedMedia } from "./volc-asr-video.processor.js";

const allowedExtensions = new Set([
  ".aac",
  ".flac",
  ".m4a",
  ".mp3",
  ".mp4",
  ".ogg",
  ".wav",
  ".webm",
]);

function isPrivateAddress(address: string): boolean {
  if (address === "::1" || address.startsWith("fe80:") || address.startsWith("fc") || address.startsWith("fd")) {
    return true;
  }
  if (isIP(address) !== 4) return false;
  const [a = 0, b = 0] = address.split(".").map(Number);
  return (
    a === 10 ||
    a === 127 ||
    a === 0 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127)
  );
}

export type MaterializedMedia = {
  localPath: string;
  objectKey: string;
  format: string;
};

type PublicLookup = (
  hostname: string,
) => Promise<Array<{ address: string; family: number }>>;

type MediaFetch = (input: URL, init?: RequestInit) => Promise<Response>;
type MediaTranscode = (input: string, output: string) => Promise<void>;

export class MediaMaterializer {
  constructor(
    private readonly config: AppConfig,
    private readonly dependencies: {
      fetch?: MediaFetch;
      lookup?: PublicLookup;
      transcode?: MediaTranscode;
    } = {},
  ) {}

  async download(taskId: string, media: ResolvedMedia): Promise<MaterializedMedia> {
    if (
      media.durationSeconds > 0 &&
      media.durationSeconds > this.config.mediaMaxDurationSeconds
    ) {
      throw new AppError(
        422,
        "MEDIA_DURATION_EXCEEDED",
        `媒体时长超过 ${Math.floor(this.config.mediaMaxDurationSeconds / 60)} 分钟限制`,
      );
    }

    const extension = this.extension(media);
    const directory = join(this.config.tempAudioDir, taskId);
    const downloadedPath = join(directory, `source${extension}`);
    await mkdir(directory, { recursive: true });

    try {
      const response = await this.fetchFollowingRedirects(
        new URL(media.url),
        media.headers ?? {},
      );
      if (!response.ok || !response.body) {
        throw new AppError(
          502,
          "MEDIA_DOWNLOAD_FAILED",
          `音频下载失败：HTTP ${response.status}`,
        );
      }
      const announced = Number(response.headers.get("content-length") ?? "0");
      if (announced > this.config.mediaMaxBytes) {
        throw new AppError(413, "MEDIA_FILE_TOO_LARGE", "音频文件超过服务器限制");
      }

      let received = 0;
      const source = Readable.fromWeb(response.body as never);
      source.on("data", (chunk: Buffer) => {
        received += chunk.length;
        if (received > this.config.mediaMaxBytes) {
          source.destroy(
            new AppError(413, "MEDIA_FILE_TOO_LARGE", "音频文件超过服务器限制"),
          );
        }
      });
      await pipeline(source, createWriteStream(downloadedPath, { flags: "wx" }));
      if (received === 0) {
        throw new AppError(502, "MEDIA_DOWNLOAD_EMPTY", "平台返回了空音频文件");
      }

      const localPath =
        extension === ".mp4" ? join(directory, "audio.m4a") : downloadedPath;
      if (extension === ".mp4") {
        await (this.dependencies.transcode ?? this.transcodeWithFfmpeg.bind(this))(
          downloadedPath,
          localPath,
        );
        await rm(downloadedPath, { force: true });
      }
      const outputExtension = extname(localPath);
      const now = new Date();
      const month = String(now.getUTCMonth() + 1).padStart(2, "0");
      return {
        localPath,
        objectKey: `asr/${now.getUTCFullYear()}/${month}/${taskId}${outputExtension}`,
        format: outputExtension.slice(1),
      };
    } catch (error) {
      await rm(directory, { recursive: true, force: true });
      throw error;
    }
  }

  async cleanup(localPath: string): Promise<void> {
    await rm(dirname(localPath), { recursive: true, force: true });
  }

  private extension(media: ResolvedMedia): string {
    const fromFormat = `.${media.format.toLowerCase().replace(/[^a-z0-9]/g, "")}`;
    if (allowedExtensions.has(fromFormat)) return fromFormat;
    const fromUrl = extname(new URL(media.url).pathname).toLowerCase();
    return allowedExtensions.has(fromUrl) ? fromUrl : ".m4a";
  }

  private async fetchFollowingRedirects(
    initial: URL,
    headers: Record<string, string>,
  ): Promise<Response> {
    let current = initial;
    for (let redirect = 0; redirect <= 5; redirect += 1) {
      await this.assertPublicHttpUrl(current);
      const response = await (this.dependencies.fetch ?? fetch)(current, {
        headers,
        redirect: "manual",
        signal: AbortSignal.timeout(120_000),
      });
      if (![301, 302, 303, 307, 308].includes(response.status)) return response;
      const location = response.headers.get("location");
      await response.body?.cancel();
      if (!location) {
        throw new AppError(502, "MEDIA_REDIRECT_INVALID", "媒体重定向缺少地址");
      }
      current = new URL(location, current);
    }
    throw new AppError(502, "MEDIA_REDIRECT_LIMIT", "媒体重定向次数过多");
  }

  private async assertPublicHttpUrl(url: URL): Promise<void> {
    if (!["http:", "https:"].includes(url.protocol)) {
      throw new AppError(422, "MEDIA_URL_UNSAFE", "媒体地址协议不受支持");
    }
    const addresses = await (
      this.dependencies.lookup ??
      ((hostname: string) => lookup(hostname, { all: true }))
    )(url.hostname);
    if (
      addresses.length === 0 ||
      addresses.some(({ address }) => isPrivateAddress(address))
    ) {
      throw new AppError(422, "MEDIA_URL_UNSAFE", "媒体地址指向内网或保留地址");
    }
  }

  private transcodeWithFfmpeg(input: string, output: string): Promise<void> {
    return new Promise((resolvePromise, reject) => {
      const child = spawn(
        this.config.ffmpegBin,
        [
          "-nostdin",
          "-hide_banner",
          "-loglevel",
          "error",
          "-i",
          input,
          "-vn",
          "-c:a",
          "aac",
          "-b:a",
          "64k",
          "-y",
          output,
        ],
        { shell: false },
      );
      let stderr = "";
      child.stderr.on("data", (chunk: Buffer) => {
        if (stderr.length < 8_000) stderr += chunk.toString("utf8");
      });
      const timeout = setTimeout(() => child.kill("SIGKILL"), 180_000);
      timeout.unref();
      child.on("error", (error) => {
        clearTimeout(timeout);
        reject(new AppError(503, "FFMPEG_UNAVAILABLE", error.message));
      });
      child.on("close", (code) => {
        clearTimeout(timeout);
        if (code === 0) {
          resolvePromise();
          return;
        }
        reject(
          new AppError(
            502,
            "AUDIO_TRANSCODE_FAILED",
            stderr.trim() || `FFmpeg 退出码 ${code ?? "unknown"}`,
          ),
        );
      });
    });
  }
}
