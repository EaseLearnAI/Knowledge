import { afterEach, describe, expect, it, vi } from "vitest";
import type { AppConfig } from "../src/config.js";
import {
  VolcAsrClient,
  VolcAsrVideoProcessor,
  type CloudMediaResolver,
  type VolcAsrClientLike,
} from "../src/features/video/volc-asr-video.processor.js";

const config: AppConfig = {
  nodeEnv: "test",
  port: 0,
  host: "127.0.0.1",
  mongodbUri: "mongodb://localhost:27017/memo_knowledge_test",
  jwtAccessSecret: "test-secret-with-at-least-thirty-two-characters",
  accessTokenTtl: "15m",
  refreshTokenTtlDays: 30,
  corsOrigins: [],
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
        source: "https://www.youtube.com/watch?v=test",
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
});
