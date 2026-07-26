import { afterEach, describe, expect, it, vi } from "vitest";
import type { AppConfig } from "../src/config.js";
import { MiniMaxCopywriter } from "../src/features/video/minimax-copywriter.js";
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
  videoWorkspace: "/tmp/memo-video-test",
  videoProcessor: "mock",
  copywriterProvider: "minimax",
  volcAsrApiBase: "https://openspeech.bytedance.com/api/v3/auc/bigmodel",
  volcAsrResourceId: "volc.bigasr.auc",
  volcAsrPollIntervalMs: 1_000,
  volcAsrTimeoutMs: 300_000,
  arkApiBase: "https://ark.cn-beijing.volces.com/api/v3",
  arkAudioModel: "doubao-seed-2-0-lite-260428",
  arkSummaryModel: "doubao-seed-2-0-lite-260428",
  arkRequestTimeoutMs: 300_000,
  minimaxApiKey: "test-api-key",
  minimaxApiBase: "https://api.minimaxi.com",
  minimaxModel: "MiniMax-M3",
  enableWebTerminal: false,
  webTerminalToken: "test-terminal-token-123456",
  logLevel: "silent",
};

const transcript: TranscriptResult = {
  title: "模型切换测试",
  source: "https://example.com/video",
  transcriptPath: "/tmp/transcript.json",
  text: "第一段介绍模型配置。第二段说明只需要修改环境变量。",
  segments: [
    { startMs: 0, endMs: 5_000, text: "第一段介绍模型配置。" },
    { startMs: 5_000, endMs: 10_000, text: "第二段说明只需要修改环境变量。" },
  ],
  provider: "test",
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("MiniMaxCopywriter", () => {
  it("通过 OpenAI 兼容接口调用配置中的 MiniMax-M3", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  oneSentenceSummary: "模型可以通过配置切换。",
                  whyWorthWatching: "理解模型与业务解耦方式。",
                  keyPoints: ["模型名来自环境变量。"],
                  chapters: [
                    {
                      title: "配置模型",
                      startMs: 0,
                      endMs: 10_000,
                      summary: "通过环境变量选择模型。",
                    },
                  ],
                  actionItems: ["修改 MINIMAX_MODEL 后重启服务。"],
                  tags: ["技术"],
                  markdown: "# 模型切换测试",
                }),
              },
            },
          ],
          usage: {
            prompt_tokens: 100,
            completion_tokens: 80,
            total_tokens: 180,
          },
          base_resp: { status_code: 0, status_msg: "" },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const events: Array<{ event: string; data?: Record<string, unknown> }> = [];

    const result = await new MiniMaxCopywriter(config).generate(
      transcript,
      (event, _message, data) => {
        events.push({ event, ...(data ? { data } : {}) });
      },
    );

    expect(result.model).toBe("MiniMax-M3");
    expect(result.provider).toBe("minimax-openai-compatible");
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, request] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.minimaxi.com/v1/chat/completions");
    expect(request.headers).toMatchObject({ Authorization: "Bearer test-api-key" });
    const body = JSON.parse(String(request.body));
    expect(body.model).toBe("MiniMax-M3");
    expect(body.reasoning_split).toBe(true);
    expect(body.messages[1].content).toContain("[0-5000]");
    expect(events.at(-1)?.data).toMatchObject({ totalTokens: 180 });
  });

  it("能从带思考标签和代码围栏的回复中提取 JSON", async () => {
    const content = `<think>内部推理不进入业务结果</think>\n\`\`\`json\n${JSON.stringify({
      oneSentenceSummary: "已提取 JSON。",
      whyWorthWatching: "兼容模型输出格式。",
      keyPoints: ["忽略思考文本。"],
      chapters: [],
      actionItems: [],
      tags: ["测试"],
      markdown: "# 结果",
    })}\n\`\`\``;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({ choices: [{ message: { content } }] }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      ),
    );

    const result = await new MiniMaxCopywriter(config).generate(
      transcript,
      () => undefined,
    );
    expect(result.oneSentenceSummary).toBe("已提取 JSON。");
  });
});
