import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadConfig } from "../src/config.js";
import { DefaultModelMediaStager } from "../src/features/video/model-media-stager.js";
import type { TemporaryObjectStore } from "../src/features/video/tos-object-store.js";

const workspaces: string[] = [];

afterEach(async () => {
  await Promise.all(
    workspaces.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe("DefaultModelMediaStager", () => {
  it("未配置 TOS 时直接生成本地 Data URL", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "memo-m3-media-"));
    workspaces.push(workspace);
    const stager = new DefaultModelMediaStager(
      {
        ...loadConfig({ NODE_ENV: "test", TOS_ENABLED: "false" }),
        tempAudioDir: workspace,
      },
      {
        lookup: vi.fn(async () => [{ address: "203.0.113.10", family: 4 }]),
        fetch: vi.fn(
          async () =>
            new Response(new Uint8Array([1, 2, 3]), {
              status: 200,
              headers: { "Content-Type": "image/jpeg", "Content-Length": "3" },
            }),
        ),
      },
    );

    const staged = await stager.stage(
      "task-local-image",
      {
        kind: "image_post",
        platform: "xiaohongshu",
        title: "本地图文",
        text: "",
        durationSeconds: 0,
        assets: [
          {
            kind: "image",
            url: "https://img.example/post.jpg",
            format: "jpg",
          },
        ],
      },
      () => undefined,
    );

    expect(staged.transport).toBe("data_url");
    expect(staged.imageUrls).toEqual(["data:image/jpeg;base64,AQID"]);
    await staged.cleanup();
  });

  it("下载图文图片、上传签名并在完成后清理对象", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "memo-m3-media-"));
    workspaces.push(workspace);
    const uploadAndSign = vi.fn(
      async (_path: string, key: string) => `https://tos.example/${key}`,
    );
    const deleteObject = vi.fn(async () => undefined);
    const objectStore = {
      uploadAndSign,
      delete: deleteObject,
    } satisfies TemporaryObjectStore;
    const stager = new DefaultModelMediaStager(
      {
        ...loadConfig({ NODE_ENV: "test" }),
        tempAudioDir: workspace,
      },
      {
        objectStore,
        lookup: vi.fn(async () => [{ address: "203.0.113.10", family: 4 }]),
        fetch: vi.fn(
          async () =>
            new Response(new Uint8Array([1, 2, 3]), {
              status: 200,
              headers: { "Content-Type": "image/jpeg", "Content-Length": "3" },
            }),
        ),
      },
    );

    const staged = await stager.stage(
      "task-image",
      {
        kind: "image_post",
        platform: "xiaohongshu",
        title: "图文",
        text: "",
        durationSeconds: 0,
        assets: [
          {
            kind: "image",
            url: "https://img.example/post.jpg",
            format: "jpg",
          },
        ],
      },
      () => undefined,
    );

    expect(staged.imageUrls).toEqual([
      "https://tos.example/model/task-image/image-0.jpg",
    ]);
    expect(uploadAndSign).toHaveBeenCalledOnce();
    await staged.cleanup();
    expect(deleteObject).toHaveBeenCalledWith("model/task-image/image-0.jpg");
  });

  it("拒绝解析到内网地址的媒体", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "memo-m3-media-"));
    workspaces.push(workspace);
    const objectStore = {
      uploadAndSign: vi.fn(async () => "https://tos.example/object"),
      delete: vi.fn(async () => undefined),
    } satisfies TemporaryObjectStore;
    const stager = new DefaultModelMediaStager(
      {
        ...loadConfig({ NODE_ENV: "test" }),
        tempAudioDir: workspace,
      },
      {
        objectStore,
        lookup: vi.fn(async () => [{ address: "127.0.0.1", family: 4 }]),
      },
    );

    await expect(
      stager.stage(
        "task-private",
        {
          kind: "image_post",
          platform: "douyin",
          title: "图文",
          text: "",
          durationSeconds: 0,
          assets: [
            {
              kind: "image",
              url: "https://private.example/post.jpg",
              format: "jpg",
            },
          ],
        },
        () => undefined,
      ),
    ).rejects.toMatchObject({ code: "MEDIA_URL_UNSAFE" });
    expect(objectStore.uploadAndSign).not.toHaveBeenCalled();
  });

  it("将 B站 DASH 音视频合并成单个 M3 视频对象", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "memo-m3-media-"));
    workspaces.push(workspace);
    const uploadAndSign = vi.fn(
      async (_path: string, key: string) => `https://tos.example/${key}`,
    );
    const objectStore = {
      uploadAndSign,
      delete: vi.fn(async () => undefined),
    } satisfies TemporaryObjectStore;
    const transcode = vi.fn(
      async (_video: string, audio: string | undefined, output: string) => {
        expect(audio).toBeTruthy();
        await writeFile(output, new Uint8Array([1, 2, 3, 4]));
      },
    );
    const stager = new DefaultModelMediaStager(
      {
        ...loadConfig({ NODE_ENV: "test" }),
        tempAudioDir: workspace,
      },
      {
        objectStore,
        lookup: vi.fn(async () => [{ address: "203.0.113.10", family: 4 }]),
        fetch: vi.fn(
          async () =>
            new Response(new Uint8Array([1, 2, 3]), {
              status: 200,
              headers: { "Content-Length": "3" },
            }),
        ),
        transcode,
      },
    );

    const staged = await stager.stage(
      "task-video",
      {
        kind: "short_video",
        platform: "bilibili",
        title: "短视频",
        text: "",
        durationSeconds: 120,
        assets: [
          {
            kind: "video",
            url: "https://video.example/video.m4s",
            format: "mp4",
          },
          {
            kind: "audio",
            url: "https://video.example/audio.m4s",
            format: "m4a",
          },
        ],
      },
      () => undefined,
    );

    expect(staged.videoUrl).toBe(
      "https://tos.example/model/task-video/video.mp4",
    );
    expect(transcode).toHaveBeenCalledOnce();
    expect(uploadAndSign).toHaveBeenCalledOnce();
    await staged.cleanup();
  });

  it("未配置 TOS 时将转码视频编码成 Data URL", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "memo-m3-media-"));
    workspaces.push(workspace);
    const stager = new DefaultModelMediaStager(
      {
        ...loadConfig({ NODE_ENV: "test", TOS_ENABLED: "false" }),
        tempAudioDir: workspace,
      },
      {
        lookup: vi.fn(async () => [{ address: "203.0.113.10", family: 4 }]),
        fetch: vi.fn(
          async () =>
            new Response(new Uint8Array([1, 2, 3]), {
              status: 200,
              headers: { "Content-Length": "3" },
            }),
        ),
        transcode: vi.fn(async (_video, _audio, output) => {
          await writeFile(output, new Uint8Array([1, 2, 3, 4]));
        }),
      },
    );

    const staged = await stager.stage(
      "task-local-video",
      {
        kind: "short_video",
        platform: "douyin",
        title: "本地短视频",
        text: "",
        durationSeconds: 30,
        assets: [
          {
            kind: "video",
            url: "https://video.example/source.mp4",
            format: "mp4",
          },
        ],
      },
      () => undefined,
    );

    expect(staged.transport).toBe("data_url");
    expect(staged.videoUrl).toBe("data:video/mp4;base64,AQIDBA==");
    await staged.cleanup();
  });
});
