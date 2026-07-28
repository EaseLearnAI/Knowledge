import { describe, expect, it } from "vitest";
import { loadConfig, type AppConfig } from "../src/platform/config/app-config.js";
import { VideoSummarizeProcessor } from "../src/integrations/transcription/local/videosummarize.processor.js";

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
  videoSummarizeBin:
    "/Users/mac/Desktop/03_学习与研究/study/视频解析学习/skill方案/cliskill/.venv/bin/videosummarize",
  videoWorkspace: "/tmp/memo-videosummarize-doctor",
  videoProcessor: "cli",
  copywriterProvider: "local",
  volcAsrApiBase: "https://openspeech.bytedance.com/api/v3/auc/bigmodel",
  volcAsrResourceId: "volc.bigasr.auc",
  volcAsrPollIntervalMs: 1_000,
  volcAsrTimeoutMs: 300_000,
  volcAsrMaxAttempts: 3,
  arkApiBase: "https://ark.cn-beijing.volces.com/api/v3",
  arkAudioModel: "doubao-seed-2-0-lite-260428",
  arkSummaryModel: "doubao-seed-2-0-lite-260428",
  arkRequestTimeoutMs: 300_000,
  minimaxApiBase: "https://api.minimaxi.com",
  minimaxModel: "MiniMax-M3",
  enableWebTerminal: false,
  webTerminalToken: "test-terminal-token-123456",
  logLevel: "silent",
};

describe("真实 videosummarize 内核", () => {
  it("doctor 确认 ffmpeg、yt-dlp 和 Whisper 可用", async () => {
    const messages: string[] = [];
    const processor = new VideoSummarizeProcessor(config);
    await processor.doctor?.((_event, message) => {
      messages.push(message);
    });
    const output = messages.join("\n");
    expect(output).toContain("Status: Ready to use!");
    expect(output).toContain("ffmpeg:");
    expect(output).toContain("mlx-whisper:");
  });
});
