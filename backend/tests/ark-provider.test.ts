import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AppConfig } from "../src/config.js";
import { AppError } from "../src/shared/errors/app-error.js";
import { ArkCopywriter } from "../src/features/video/ark-copywriter.js";
import {
  ArkResponseClient,
  type ArkClient,
  type ArkResponseResult,
} from "../src/features/video/ark-response.client.js";
import {
  ArkVideoProcessor,
  type AudioPreparer,
} from "../src/features/video/ark-video.processor.js";
import type { TranscriptResult } from "../src/features/video/video.types.js";

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
  videoWorkspace: "/tmp/memo-ark-test",
  videoProcessor: "ark",
  copywriterProvider: "ark",
  volcAsrApiBase: "https://openspeech.bytedance.com/api/v3/auc/bigmodel",
  volcAsrResourceId: "volc.bigasr.auc",
  volcAsrPollIntervalMs: 1_000,
  volcAsrTimeoutMs: 300_000,
  arkApiKey: "test-ark-api-key",
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

function responseResult(text: string): ArkResponseResult {
  return {
    id: "resp-test",
    text,
    usage: {
      inputTokens: 100,
      outputTokens: 50,
      totalTokens: 150,
      audioTokens: 40,
    },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ArkResponseClient", () => {
  it("通过 Files API 上传音频并解析 Responses API 文本", async () => {
    const audioPath = join(tmpdir(), `memo-ark-${Date.now()}.mp3`);
    await writeFile(audioPath, Buffer.from("fake-mp3"));
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: "file-test" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: "resp-test",
            output: [
              {
                type: "message",
                content: [{ type: "output_text", text: "{\"text\":\"测试\"}" }],
              },
            ],
            usage: {
              input_tokens: 10,
              output_tokens: 5,
              total_tokens: 15,
              input_tokens_details: { audio_tokens: 8 },
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      )
      .mockResolvedValueOnce(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const client = new ArkResponseClient(config);
    const fileId = await client.uploadFile(audioPath, "audio/mpeg");
    const result = await client.create({ model: config.arkAudioModel });
    await client.deleteFile(fileId);

    expect(fileId).toBe("file-test");
    expect(result.text).toBe('{"text":"测试"}');
    expect(result.usage).toMatchObject({ totalTokens: 15, audioTokens: 8 });
    const [uploadUrl, uploadRequest] = fetchMock.mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect(uploadUrl).toBe("https://ark.example.com/api/v3/files");
    expect(uploadRequest.headers).toMatchObject({
      Authorization: "Bearer test-ark-api-key",
    });
    expect(uploadRequest.body).toBeInstanceOf(FormData);
  });

  it("把未开通模型映射成明确错误", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            error: {
              code: "ModelNotOpen",
              message: "model is not activated",
            },
          }),
          { status: 404, headers: { "Content-Type": "application/json" } },
        ),
      ),
    );
    await expect(
      new ArkResponseClient(config).create({ model: config.arkAudioModel }),
    ).rejects.toMatchObject({
      code: "ARK_MODEL_NOT_OPEN",
      message: "model is not activated",
    });
  });

  it("没有密钥时在发请求前失败", async () => {
    const withoutKey = { ...config };
    delete withoutKey.arkApiKey;
    await expect(
      new ArkResponseClient(withoutKey).create({ model: config.arkAudioModel }),
    ).rejects.toMatchObject({ code: "ARK_API_KEY_MISSING" });
  });
});

describe("ArkVideoProcessor", () => {
  it("完成音频准备、上传、转写并清理远端文件", async () => {
    const preparer: AudioPreparer = {
      prepare: vi.fn().mockResolvedValue({
        audioPath: "/tmp/audio.mp3",
        title: "下载标题",
        durationSeconds: 12.3,
        sizeBytes: 12_000,
      }),
    };
    const client: ArkClient = {
      uploadFile: vi.fn().mockResolvedValue("file-test"),
      create: vi.fn().mockResolvedValue(responseResult("这是完整转录。")),
      deleteFile: vi.fn().mockResolvedValue(undefined),
    };
    const events: string[] = [];
    const processor = new ArkVideoProcessor(config, { client, preparer });
    const result = await processor.process(
      {
        source: "https://www.bilibili.com/video/BVtest",
        quality: "balanced",
        language: "zh",
      },
      (event) => {
        events.push(event);
      },
    );

    expect(result).toMatchObject({
      title: "下载标题",
      text: "这是完整转录。",
      segments: [],
      provider: "volcengine-ark-audio-chunked",
      transcriptPath: "ark://responses/resp-test",
    });
    expect(client.uploadFile).toHaveBeenCalledWith("/tmp/audio.mp3", "audio/mpeg");
    expect(client.deleteFile).toHaveBeenCalledWith("file-test");
    expect(events).toContain("transcription.ark.completed");
  });

  it("转写失败时仍删除方舟临时文件", async () => {
    const preparer: AudioPreparer = {
      prepare: vi.fn().mockResolvedValue({
        audioPath: "/tmp/audio.mp3",
        title: "测试",
        durationSeconds: 1,
        sizeBytes: 100,
      }),
    };
    const client: ArkClient = {
      uploadFile: vi.fn().mockResolvedValue("file-test"),
      create: vi
        .fn()
        .mockRejectedValue(new AppError(502, "ARK_REQUEST_FAILED", "失败")),
      deleteFile: vi.fn().mockResolvedValue(undefined),
    };

    await expect(
      new ArkVideoProcessor(config, { client, preparer }).process(
        {
          source: "/tmp/input.mp3",
          quality: "fast",
          language: "auto",
        },
        () => undefined,
      ),
    ).rejects.toMatchObject({ code: "ARK_REQUEST_FAILED" });
    expect(client.deleteFile).toHaveBeenCalledWith("file-test");
  });
});

describe("ArkCopywriter", () => {
  it("把转录生成结构化总结", async () => {
    const client: ArkClient = {
      uploadFile: vi.fn(),
      deleteFile: vi.fn(),
      create: vi.fn().mockResolvedValue(
        responseResult(
          JSON.stringify({
            oneSentenceSummary: "视频解释了最小上线方案。",
            whyWorthWatching: "可以直接用于个人开发者上线。",
            keyPoints: ["使用单机部署。", "先验证真实用户需求。", "外部 ASR 按量付费。"],
            chapters: [
              {
                title: "架构",
                startMs: 0,
                endMs: 5_000,
                summary: "介绍单机架构。",
              },
            ],
            actionItems: ["先跑通一条真实视频。"],
            tags: ["技术", "产品"],
            markdown: "# 最小上线方案",
          }),
        ),
      ),
    };
    const transcript: TranscriptResult = {
      title: "最小上线",
      source: "https://example.com/video",
      transcriptPath: "ark://responses/transcript",
      text: "使用单机部署，先验证真实用户需求。",
      segments: [
        {
          startMs: 0,
          endMs: 5_000,
          text: "使用单机部署，先验证真实用户需求。",
        },
      ],
      provider: "test",
    };
    const result = await new ArkCopywriter(config, client).generate(
      transcript,
      () => undefined,
    );

    expect(result.oneSentenceSummary).toBe("视频解释了最小上线方案。");
    expect(result.provider).toBe("volcengine-ark-responses");
    expect(result.model).toBe(config.arkSummaryModel);
  });
});
