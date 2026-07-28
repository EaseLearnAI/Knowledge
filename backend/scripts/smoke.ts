import { createServer } from "node:http";
import { MongoMemoryServer } from "mongodb-memory-server";
import { createApp } from "../src/bootstrap/create-http-app.js";
import { loadConfig, type AppConfig } from "../src/platform/config/app-config.js";
import { MockVideoProcessor } from "../src/integrations/analysis/local/mock-video.processor.js";
import { connectDatabase, disconnectDatabase } from "../src/platform/database/mongoose.js";
import { createLogger } from "../src/platform/observability/logger.js";

const mongo = await MongoMemoryServer.create();
const config: AppConfig = {
  ...loadConfig({ NODE_ENV: "test" }),
  nodeEnv: "test",
  port: 0,
  host: "127.0.0.1",
  mongodbUri: mongo.getUri("memo_smoke"),
  jwtAccessSecret: "smoke-secret-with-at-least-thirty-two-characters",
  accessTokenTtl: "15m",
  refreshTokenTtlDays: 30,
  corsOrigins: [],
  mediaProxyTtlSeconds: 14_400,
  videoSummarizeBin: "/tmp/videosummarize",
  videoWorkspace: "/tmp/memo-smoke",
  videoProcessor: "mock",
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
  enableWebTerminal: true,
  webTerminalToken: "smoke-terminal-token-123",
  logLevel: "info",
};
const logger = createLogger(config);
await connectDatabase(config.mongodbUri, logger);
const { app, runner } = createApp({
  config,
  logger,
  videoProcessor: new MockVideoProcessor(),
});
const server = createServer(app);
await new Promise<void>((resolvePromise) => server.listen(0, "127.0.0.1", resolvePromise));
const address = server.address();
if (!address || typeof address === "string") throw new Error("无法获取测试端口");
const base = `http://127.0.0.1:${address.port}`;

async function call(path: string, init?: RequestInit) {
  console.log(`\n>>> 发起请求 ${init?.method ?? "GET"} ${path}`);
  if (init?.body) console.log(`请求体: ${redactJson(String(init.body))}`);
  const response = await fetch(`${base}${path}`, init);
  const text = await response.text();
  console.log(`<<< 响应状态 ${response.status}`);
  console.log(`响应内容: ${redactJson(text)}`);
  if (!response.ok) throw new Error(`接口调用失败：${path}`);
  return text ? JSON.parse(text) : null;
}

function redactJson(text: string): string {
  try {
    const value = JSON.parse(text);
    const walk = (input: unknown): unknown => {
      if (Array.isArray(input)) return input.map(walk);
      if (typeof input !== "object" || input === null) return input;
      return Object.fromEntries(
        Object.entries(input).map(([key, item]) => [
          key,
          /password|accessToken|refreshToken|authorization|token/i.test(key)
            ? "[REDACTED]"
            : walk(item),
        ]),
      );
    };
    return JSON.stringify(walk(value));
  } catch {
    return text;
  }
}

try {
  await call("/health");
  await call("/ready");
  const registered = await call("/api/v1/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      identifier: `smoke-${Date.now()}@example.com`,
      password: "Password123",
      nickname: "接口冒烟测试",
    }),
  });
  const authorization = `Bearer ${registered.data.accessToken}`;
  const capture = await call("/api/v1/captures", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: authorization,
      "Idempotency-Key": "smoke-video-001",
    },
    body: JSON.stringify({
      url: "https://www.bilibili.com/video/BV1nB3u6tERu/",
      quality: "balanced",
      language: "zh",
    }),
  });
  await runner.whenIdle();
  const task = await call(`/api/v1/tasks/${capture.data._id}`, {
    headers: { Authorization: authorization },
  });
  await call(`/api/v1/items/${task.data.sourceItemId}`, {
    headers: { Authorization: authorization },
  });
  console.log("\n✅ 注册、鉴权、视频任务、转录、文案、查询全链路冒烟通过");
} finally {
  await runner.whenIdle();
  await new Promise<void>((resolvePromise) => server.close(() => resolvePromise()));
  await disconnectDatabase(logger);
  await mongo.stop();
}
