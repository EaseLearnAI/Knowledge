import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { loadConfig, type AppConfig } from "../src/config.js";
import { VideoSummarizeProcessor } from "../src/features/video/videosummarize.processor.js";

const enabled = process.env.RUN_REAL_VIDEO_TEST === "1";

describe.skipIf(!enabled)("真实本地音视频转录", () => {
  it("把系统合成语音经过 ffmpeg 和本地 Whisper 转成带时间戳文本", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "memo-real-video-"));
    const audio = join(workspace, "memo-sample.aiff");
    const say = spawnSync(
      "say",
      ["-v", "Tingting", "收藏以后能够找到，才是真正有用的知识。", "-o", audio],
      { encoding: "utf8" },
    );
    expect(say.status, say.stderr).toBe(0);

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
      videoWorkspace: workspace,
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
    try {
      const processor = new VideoSummarizeProcessor(config);
      const result = await processor.process(
        {
          source: audio,
          titleHint: "真实本地转录样例",
          quality: "fast",
          language: "zh",
        },
        () => undefined,
      );
      expect(result.title).toBe("真实本地转录样例");
      expect(result.text.length).toBeGreaterThan(0);
      expect(result.segments.length).toBeGreaterThan(0);
      expect(result.transcriptPath).toMatch(/transcript\.json$/);
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });
});
