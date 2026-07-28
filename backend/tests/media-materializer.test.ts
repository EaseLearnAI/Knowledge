import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadConfig } from "../src/platform/config/app-config.js";
import { MediaMaterializer } from "../src/integrations/media/media-materializer.js";

const directories: string[] = [];

async function config() {
  const tempAudioDir = await mkdtemp(join(tmpdir(), "memo-media-"));
  directories.push(tempAudioDir);
  return {
    ...loadConfig({ NODE_ENV: "test" }),
    tempAudioDir,
    mediaMaxBytes: 16,
    mediaMaxDurationSeconds: 60,
  };
}

afterEach(async () => {
  const { rm } = await import("node:fs/promises");
  await Promise.all(
    directories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("MediaMaterializer", () => {
  it("下载公开音频并生成稳定的 TOS 对象路径", async () => {
    const materializer = new MediaMaterializer(await config(), {
      lookup: async () => [{ address: "93.184.216.34", family: 4 }],
      fetch: async (_input, _init) =>
        new Response("audio-data", {
          status: 200,
          headers: { "content-length": "10" },
        }),
    });

    const result = await materializer.download("task-123", {
      url: "https://cdn.example.com/audio.m4a",
      title: "测试",
      durationSeconds: 10,
      format: "m4a",
      headers: { Referer: "https://example.com/" },
    });

    expect(await readFile(result.localPath, "utf8")).toBe("audio-data");
    expect(result.objectKey).toMatch(/^asr\/\d{4}\/\d{2}\/task-123\.m4a$/);
    await materializer.cleanup(result.localPath);
  });

  it("阻断内网媒体地址", async () => {
    const materializer = new MediaMaterializer(await config(), {
      lookup: async () => [{ address: "169.254.169.254", family: 4 }],
      fetch: async (_input, _init) => new Response("should-not-run"),
    });

    await expect(
      materializer.download("task-private", {
        url: "http://metadata.internal/audio.m4a",
        title: "危险地址",
        durationSeconds: 10,
        format: "m4a",
      }),
    ).rejects.toMatchObject({ code: "MEDIA_URL_UNSAFE" });
  });

  it("流式下载超过限制时立即失败并清理文件", async () => {
    const materializer = new MediaMaterializer(await config(), {
      lookup: async () => [{ address: "93.184.216.34", family: 4 }],
      fetch: async (_input, _init) =>
        new Response("0123456789abcdefghij", { status: 200 }),
    });

    await expect(
      materializer.download("task-large", {
        url: "https://cdn.example.com/audio.m4a",
        title: "过大音频",
        durationSeconds: 10,
        format: "m4a",
      }),
    ).rejects.toMatchObject({ code: "MEDIA_FILE_TOO_LARGE" });
  });

  it("MP4 只抽取音轨后再生成 TOS 对象路径", async () => {
    const materializer = new MediaMaterializer(await config(), {
      lookup: async () => [{ address: "93.184.216.34", family: 4 }],
      fetch: async (_input, _init) => new Response("video-data"),
      transcode: async (_input, output) => writeFile(output, "audio-only"),
    });

    const result = await materializer.download("task-video", {
      url: "https://cdn.example.com/video.mp4",
      title: "短视频",
      durationSeconds: 10,
      format: "mp4",
    });

    expect(result.format).toBe("m4a");
    expect(result.objectKey).toMatch(/task-video\.m4a$/);
    expect(await readFile(result.localPath, "utf8")).toBe("audio-only");
    await materializer.cleanup(result.localPath);
  });
});
