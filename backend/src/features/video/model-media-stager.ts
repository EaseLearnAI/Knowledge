import { spawn } from "node:child_process";
import { lookup } from "node:dns/promises";
import { createWriteStream } from "node:fs";
import { mkdir, rm, stat } from "node:fs/promises";
import { isIP } from "node:net";
import { extname, join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { AppConfig } from "../../config.js";
import { AppError } from "../../shared/errors/app-error.js";
import type {
  ProgressReporter,
  ResolvedContent,
  ResolvedContentAsset,
} from "./video.types.js";
import { LocalDataUrlObjectStore } from "./local-data-url-object-store.js";
import {
  TosTemporaryObjectStore,
  type TemporaryObjectStore,
} from "./tos-object-store.js";

export type StagedModelMedia = {
  imageUrls: string[];
  videoUrl?: string;
  transport?: "data_url" | "signed_url";
  cleanup(): Promise<void>;
};

export interface ModelMediaStager {
  stage(
    taskId: string,
    content: ResolvedContent,
    report: ProgressReporter,
  ): Promise<StagedModelMedia>;
}

type PublicLookup = (
  hostname: string,
) => Promise<Array<{ address: string; family: number }>>;

export class DefaultModelMediaStager implements ModelMediaStager {
  private readonly objectStore: TemporaryObjectStore;
  private readonly transport: "data_url" | "signed_url";

  constructor(
    private readonly config: AppConfig,
    private readonly dependencies: {
      objectStore?: TemporaryObjectStore;
      fetch?: typeof fetch;
      lookup?: PublicLookup;
      transcode?: (
        videoPath: string,
        audioPath: string | undefined,
        outputPath: string,
      ) => Promise<void>;
    } = {},
  ) {
    this.objectStore =
      dependencies.objectStore ??
      (config.tosEnabled
        ? new TosTemporaryObjectStore(config)
        : new LocalDataUrlObjectStore());
    this.transport =
      dependencies.objectStore || config.tosEnabled ? "signed_url" : "data_url";
  }

  async stage(
    taskId: string,
    content: ResolvedContent,
    report: ProgressReporter,
  ): Promise<StagedModelMedia> {
    const directory = join(this.config.tempAudioDir, `m3-${taskId}`);
    const objectKeys: string[] = [];
    await mkdir(directory, { recursive: true });
    const cleanup = async () => {
      await Promise.all(
        objectKeys.map((key) => this.objectStore.delete(key).catch(() => undefined)),
      );
      await rm(directory, { recursive: true, force: true });
    };
    try {
      await report("analysis.media.stage.started", "开始准备 M3 多模态媒体", {
        contentKind: content.kind,
        assets: content.assets.length,
        transport: this.transport,
      });
      const imageUrls: string[] = [];
      const imageAssets = content.assets.filter((asset) => asset.kind === "image");
      for (const [index, asset] of imageAssets.entries()) {
        const extension = this.extension(asset, ".jpg");
        const localPath = join(directory, `image-${index}${extension}`);
        await this.download(asset, localPath, 10 * 1024 * 1024);
        const objectKey = `model/${taskId}/image-${index}${extension}`;
        const url = await this.objectStore.uploadAndSign(localPath, objectKey);
        objectKeys.push(objectKey);
        imageUrls.push(url);
      }

      let videoUrl: string | undefined;
      const videoAsset = content.assets.find((asset) => asset.kind === "video");
      if (videoAsset) {
        const videoPath = join(
          directory,
          `video-source${this.extension(videoAsset, ".mp4")}`,
        );
        await this.download(videoAsset, videoPath, this.config.mediaMaxBytes);
        const audioAsset = content.assets.find((asset) => asset.kind === "audio");
        let audioPath: string | undefined;
        if (audioAsset) {
          audioPath = join(
            directory,
            `audio-source${this.extension(audioAsset, ".m4a")}`,
          );
          await this.download(audioAsset, audioPath, this.config.mediaMaxBytes);
        }
        const normalizedPath = join(directory, "model-video.mp4");
        await (
          this.dependencies.transcode ?? this.transcodeWithFfmpeg.bind(this)
        )(videoPath, audioPath, normalizedPath);
        const normalizedSize = (await stat(normalizedPath)).size;
        if (normalizedSize > this.config.minimaxMediaMaxBytes) {
          throw new AppError(
            413,
            "MINIMAX_MEDIA_TOO_LARGE",
            "短视频压缩后仍超过 MiniMax M3 的 50 MB 输入限制",
          );
        }
        const objectKey = `model/${taskId}/video.mp4`;
        videoUrl = await this.objectStore.uploadAndSign(normalizedPath, objectKey);
        objectKeys.push(objectKey);
      }
      await report("analysis.media.stage.completed", "M3 多模态媒体准备完成", {
        images: imageUrls.length,
        hasVideo: Boolean(videoUrl),
        transport: this.transport,
      });
      return {
        imageUrls,
        ...(videoUrl ? { videoUrl } : {}),
        transport: this.transport,
        cleanup,
      };
    } catch (error) {
      await cleanup();
      throw error;
    }
  }

  private extension(asset: ResolvedContentAsset, fallback: string): string {
    const fromFormat = `.${asset.format.toLowerCase().replace(/[^a-z0-9]/g, "")}`;
    if (/^\.[a-z0-9]{2,5}$/.test(fromFormat)) return fromFormat;
    const fromUrl = extname(new URL(asset.url).pathname).toLowerCase();
    return /^\.[a-z0-9]{2,5}$/.test(fromUrl) ? fromUrl : fallback;
  }

  private async download(
    asset: ResolvedContentAsset,
    destination: string,
    maxBytes: number,
  ): Promise<void> {
    let current = new URL(asset.url);
    for (let redirect = 0; redirect <= 5; redirect += 1) {
      await this.assertPublicHttpUrl(current);
      const response = await (this.dependencies.fetch ?? fetch)(current, {
        ...(asset.headers ? { headers: asset.headers } : {}),
        redirect: "manual",
        signal: AbortSignal.timeout(120_000),
      });
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get("location");
        await response.body?.cancel();
        if (!location) {
          throw new AppError(
            502,
            "MEDIA_REDIRECT_INVALID",
            "媒体重定向缺少地址",
          );
        }
        current = new URL(location, current);
        continue;
      }
      if (!response.ok || !response.body) {
        throw new AppError(
          502,
          "MEDIA_DOWNLOAD_FAILED",
          `媒体下载失败：HTTP ${response.status}`,
        );
      }
      const announced = Number(response.headers.get("content-length") ?? "0");
      if (announced > maxBytes) {
        throw new AppError(413, "MEDIA_FILE_TOO_LARGE", "媒体文件超过服务器限制");
      }
      let received = 0;
      const readable = Readable.fromWeb(response.body as never);
      readable.on("data", (chunk: Buffer) => {
        received += chunk.length;
        if (received > maxBytes) {
          readable.destroy(
            new AppError(413, "MEDIA_FILE_TOO_LARGE", "媒体文件超过服务器限制"),
          );
        }
      });
      await pipeline(readable, createWriteStream(destination, { flags: "wx" }));
      if (received === 0) {
        throw new AppError(502, "MEDIA_DOWNLOAD_EMPTY", "平台返回了空媒体文件");
      }
      return;
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
      addresses.some(({ address }) => this.isPrivateAddress(address))
    ) {
      throw new AppError(422, "MEDIA_URL_UNSAFE", "媒体地址指向内网或保留地址");
    }
  }

  private isPrivateAddress(address: string): boolean {
    if (
      address === "::1" ||
      address.startsWith("fe80:") ||
      address.startsWith("fc") ||
      address.startsWith("fd")
    ) {
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

  private transcodeWithFfmpeg(
    videoPath: string,
    audioPath: string | undefined,
    outputPath: string,
  ): Promise<void> {
    return new Promise((resolvePromise, reject) => {
      const args = [
        "-nostdin",
        "-hide_banner",
        "-loglevel",
        "error",
        "-i",
        videoPath,
        ...(audioPath ? ["-i", audioPath] : []),
        "-map",
        "0:v:0",
        "-map",
        audioPath ? "1:a:0?" : "0:a:0?",
        "-vf",
        "scale=640:-2:force_original_aspect_ratio=decrease",
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-crf",
        "30",
        "-maxrate",
        "900k",
        "-bufsize",
        "1800k",
        "-c:a",
        "aac",
        "-b:a",
        "64k",
        "-movflags",
        "+faststart",
        "-y",
        outputPath,
      ];
      const child = spawn(this.config.ffmpegBin, args, { shell: false });
      let stderr = "";
      child.stderr.on("data", (chunk: Buffer) => {
        if (stderr.length < 12_000) stderr += chunk.toString("utf8");
      });
      const timeout = setTimeout(() => child.kill("SIGKILL"), 300_000);
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
            "MODEL_MEDIA_TRANSCODE_FAILED",
            stderr.trim() || `FFmpeg 退出码 ${code ?? "unknown"}`,
          ),
        );
      });
    });
  }
}
