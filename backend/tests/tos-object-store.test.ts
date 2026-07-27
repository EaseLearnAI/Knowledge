import { describe, expect, it, vi } from "vitest";
import { loadConfig } from "../src/config.js";
import { TosTemporaryObjectStore } from "../src/features/video/tos-object-store.js";

const config = {
  ...loadConfig({ NODE_ENV: "test" }),
  tosEnabled: true,
  tosTempBucket: "memo-asr-temp-test",
  tosSignedUrlTtlSeconds: 14_400,
};

describe("TosTemporaryObjectStore", () => {
  it("按上传、签名、删除顺序调用 TOS 辅助程序", async () => {
    const helper = vi.fn(async (args: string[]) =>
      args[0] === "presign"
        ? { ok: true, url: "https://tos.example.com/signed" }
        : { ok: true },
    );
    const store = new TosTemporaryObjectStore(
      config,
      "/tmp/tos-object-store.py",
      helper,
    );

    await expect(
      store.uploadAndSign("/tmp/audio.m4a", "asr/2026/07/task.m4a"),
    ).resolves.toBe("https://tos.example.com/signed");
    await store.delete("asr/2026/07/task.m4a");

    expect(helper.mock.calls.map(([args]) => args[0])).toEqual([
      "upload",
      "presign",
      "delete",
    ]);
    expect(helper.mock.calls[1]?.[0]).toContain("14400");
  });

  it("没有私有桶配置时拒绝运行", async () => {
    const { tosTempBucket: _tosTempBucket, ...withoutBucket } = config;
    const store = new TosTemporaryObjectStore(
      withoutBucket,
      "/tmp/tos-object-store.py",
      vi.fn(),
    );
    await expect(
      store.uploadAndSign("/tmp/audio.m4a", "asr/task.m4a"),
    ).rejects.toMatchObject({ code: "TOS_NOT_CONFIGURED" });
  });

  it("预签名失败时回收已经上传的对象", async () => {
    const helper = vi.fn(async (args: string[]) => {
      if (args[0] === "presign") return { ok: true };
      return { ok: true };
    });
    const store = new TosTemporaryObjectStore(
      config,
      "/tmp/tos-object-store.py",
      helper,
    );

    await expect(
      store.uploadAndSign("/tmp/audio.m4a", "asr/task.m4a"),
    ).rejects.toMatchObject({ code: "TOS_PRESIGN_FAILED" });
    expect(helper.mock.calls.map(([args]) => args[0])).toEqual([
      "upload",
      "presign",
      "delete",
    ]);
  });
});
