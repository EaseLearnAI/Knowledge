import { afterEach, describe, expect, it, vi } from "vitest";
import { loadConfig, type AppConfig } from "../src/config.js";
import {
  resolvePublicBilibiliMedia,
  VolcAsrClient,
  VolcAsrVideoProcessor,
  type CloudMediaResolver,
  type VolcAsrClientLike,
} from "../src/features/video/volc-asr-video.processor.js";

const config: AppConfig = {
  ...loadConfig({ NODE_ENV: "test" }),
  nodeEnv: "test",
  port: 0,
  host: "127.0.0.1",
  mongodbUri: "mongodb://localhost:27017/memo_knowledge_test",
  jwtAccessSecret: "test-secret-with-at-least-thirty-two-characters",
  accessTokenTtl: "15m",
  refreshTokenTtlDays: 30,
  corsOrigins: [],
  mediaProxyTtlSeconds: 14_400,
  videoSummarizeBin: "/tmp/videosummarize",
  videoWorkspace: "/tmp/memo-volc-test",
  videoProcessor: "volc_asr",
  copywriterProvider: "ark",
  volcAsrAppId: "test-app-id",
  volcAsrAccessToken: "test-access-token",
  volcAsrApiBase: "https://openspeech.example.com/api/v3/auc/bigmodel",
  volcAsrResourceId: "volc.bigasr.auc",
  volcAsrPollIntervalMs: 1,
  volcAsrTimeoutMs: 10_000,
  volcAsrMaxAttempts: 3,
  arkApiBase: "https://ark.example.com/api/v3",
  arkAudioModel: "doubao-seed-2-0-lite-260428",
  arkSummaryModel: "doubao-seed-2-0-lite-260428",
  arkRequestTimeoutMs: 300_000,
  minimaxApiBase: "https://api.minimaxi.com",
  minimaxModel: "MiniMax-M3",
  enableWebTerminal: false,
  webTerminalToken: "test-terminal-token-123456",
  logLevel: "silent",
};

function providerResponse(code: string, body: Record<string, unknown> = {}) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "X-Api-Status-Code": code,
    },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("VolcAsrClient", () => {
  it("提交任务、轮询并映射逐字稿和分句", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(providerResponse("20000000"))
      .mockResolvedValueOnce(providerResponse("20000002"))
      .mockResolvedValueOnce(
        providerResponse("20000000", {
          result: {
            text: "第一句。第二句。",
            utterances: [
              { start_time: 0, end_time: 1_200, text: "第一句。" },
              { start_time: 1_200, end_time: 2_500, text: "第二句。" },
            ],
          },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const result = await new VolcAsrClient(config).transcribe(
      {
        url: "https://media.example.com/audio.m4a",
        title: "测试视频",
        durationSeconds: 2.5,
        format: "m4a",
      },
      () => undefined,
    );

    expect(result.text).toBe("第一句。第二句。");
    expect(result.segments).toHaveLength(2);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    const [submitUrl, submitRequest] = fetchMock.mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect(submitUrl).toBe(
      "https://openspeech.example.com/api/v3/auc/bigmodel/submit",
    );
    expect(submitRequest.headers).toMatchObject({
      "X-Api-App-Key": "test-app-id",
      "X-Api-Access-Key": "test-access-token",
      "X-Api-Resource-Id": "volc.bigasr.auc",
      "X-Api-Sequence": "-1",
    });
  });

  it("把未授权资源映射成清晰错误", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        providerResponse("45000030", {
          message: "requested resource is not granted",
        }),
      ),
    );
    await expect(
      new VolcAsrClient(config).transcribe(
        {
          url: "https://media.example.com/audio.m4a",
          title: "测试",
          durationSeconds: 1,
          format: "m4a",
        },
        () => undefined,
      ),
    ).rejects.toMatchObject({
      code: "VOLC_ASR_SUBMIT_FAILED",
      message: expect.stringContaining("未开通"),
    });
  });

  it("网络抖动后自动重试提交请求", async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("fetch failed"))
      .mockResolvedValueOnce(providerResponse("20000000"))
      .mockResolvedValueOnce(
        providerResponse("20000000", {
          result: { text: "重试成功。", utterances: [] },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const result = await new VolcAsrClient(config).transcribe(
      {
        url: "https://media.example.com/audio.m4a",
        title: "测试",
        durationSeconds: 1,
        format: "m4a",
      },
      () => undefined,
    );

    expect(result.text).toBe("重试成功。");
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("服务恢复时只查询原任务，不重复提交和计费", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      providerResponse("20000000", {
        result: { text: "恢复后的结果。", utterances: [] },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const events: string[] = [];

    const result = await new VolcAsrClient(config).resume(
      "existing-request-id",
      (event) => {
        events.push(event);
      },
    );

    expect(result).toMatchObject({
      requestId: "existing-request-id",
      text: "恢复后的结果。",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "https://openspeech.example.com/api/v3/auc/bigmodel/query",
    );
    expect(events).toContain("transcription.volc.resumed");
  });
});

describe("resolvePublicBilibiliMedia", () => {
  it("不读取 Chrome/Cookie，使用公开接口选择最低码率音频", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            code: 0,
            message: "OK",
            data: {
              cid: 42,
              title: "公开 B站视频",
              duration: 3_600,
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            code: 0,
            message: "OK",
            data: {
              dash: {
                duration: 3_600,
                audio: [
                  {
                    bandwidth: 96_000,
                    baseUrl: "https://cdn.example.com/high.m4s",
                  },
                  {
                    bandwidth: 64_000,
                    baseUrl: "https://cdn.example.com/low.m4s",
                  },
                ],
              },
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);

    const media = await resolvePublicBilibiliMedia(
      "https://www.bilibili.com/video/BV1nB3u6tERu/",
    );

    expect(media).toEqual({
      url: "https://cdn.example.com/low.m4s",
      title: "公开 B站视频",
      durationSeconds: 3_600,
      format: "m4a",
      headers: {
        Referer: "https://www.bilibili.com/video/BV1nB3u6tERu/",
        "User-Agent": expect.stringContaining("Mozilla/5.0"),
      },
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [, firstRequest] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(firstRequest.headers).toMatchObject({
      Referer: "https://www.bilibili.com/video/BV1nB3u6tERu/",
    });
  });

  it("在提交 ASR 前拒绝达到 5 小时的平台内容", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            code: 0,
            message: "OK",
            data: { cid: 42, title: "超长视频", duration: 18_000 },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      ),
    );

    await expect(
      resolvePublicBilibiliMedia(
        "https://www.bilibili.com/video/BV1nB3u6tERu/",
      ),
    ).rejects.toMatchObject({ code: "MEDIA_DURATION_EXCEEDED" });
  });

  it("先展开 b23 短链再调用公开播放器接口", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response("", {
          status: 200,
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            code: 0,
            message: "OK",
            data: { cid: 42, title: "短链视频", duration: 60 },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            code: 0,
            message: "OK",
            data: {
              dash: {
                duration: 60,
                audio: [
                  {
                    bandwidth: 64_000,
                    baseUrl: "https://cdn.example.com/audio.m4s",
                  },
                ],
              },
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      );
    vi.stubGlobal("fetch", async (...args: Parameters<typeof fetch>) => {
      const response = await fetchMock(...args);
      if (fetchMock.mock.calls.length === 1) {
        Object.defineProperty(response, "url", {
          value: "https://www.bilibili.com/video/BV1nB3u6tERu/",
        });
      }
      return response;
    });

    const media = await resolvePublicBilibiliMedia("https://b23.tv/abcd");

    expect(media.title).toBe("短链视频");
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});

describe("VolcAsrVideoProcessor", () => {
  it("组合链接解析器和专用 ASR", async () => {
    const resolver: CloudMediaResolver = {
      resolve: vi.fn().mockResolvedValue({
        url: "https://media.example.com/audio.m4a",
        title: "公开视频",
        durationSeconds: 3,
        format: "m4a",
      }),
    };
    const client: VolcAsrClientLike = {
      transcribe: vi.fn().mockResolvedValue({
        requestId: "request-test",
        text: "真实逐字稿",
        segments: [{ startMs: 0, endMs: 3_000, text: "真实逐字稿" }],
      }),
    };
    const result = await new VolcAsrVideoProcessor(config, {
      resolver,
      client,
    }).process(
      {
        source: "https://www.xiaohongshu.com/explore/test",
        quality: "balanced",
        language: "auto",
      },
      () => undefined,
    );

    expect(result).toMatchObject({
      title: "公开视频",
      text: "真实逐字稿",
      provider: "volcengine-bigasr",
      transcriptPath: "volc-asr://request-test",
    });
  });

  it("恢复已有任务时跳过平台解析，避免重复提交", async () => {
    const resolver: CloudMediaResolver = {
      resolve: vi.fn(),
    };
    const client: VolcAsrClientLike = {
      transcribe: vi.fn(),
      resume: vi.fn().mockResolvedValue({
        requestId: "existing-request-id",
        text: "恢复后的真实逐字稿",
        segments: [],
      }),
    };

    const result = await new VolcAsrVideoProcessor(config, {
      resolver,
      client,
    }).process(
      {
        source: "https://www.bilibili.com/video/BV1nB3u6tERu/",
        titleHint: "已解析标题",
        providerTaskId: "existing-request-id",
        quality: "balanced",
        language: "zh",
      },
      () => undefined,
    );

    expect(resolver.resolve).not.toHaveBeenCalled();
    expect(client.transcribe).not.toHaveBeenCalled();
    expect(client.resume).toHaveBeenCalledWith(
      "existing-request-id",
      expect.any(Function),
    );
    expect(result.title).toBe("已解析标题");
  });
});
