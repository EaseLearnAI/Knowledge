import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import type { AppConfig } from "../src/config.js";
import { MockVideoProcessor } from "../src/features/video/mock-video.processor.js";
import { disconnectDatabase, connectDatabase } from "../src/shared/db/mongoose.js";
import { createLogger } from "../src/shared/logger/logger.js";

let mongo: MongoMemoryServer;
let config: AppConfig;
let api: ReturnType<typeof request>;
let runner: ReturnType<typeof createApp>["runner"];

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  config = {
    nodeEnv: "test",
    port: 0,
    host: "127.0.0.1",
    mongodbUri: mongo.getUri("memo_knowledge_test"),
    jwtAccessSecret: "test-secret-with-at-least-thirty-two-characters",
    accessTokenTtl: "15m",
    refreshTokenTtlDays: 30,
    corsOrigins: ["http://127.0.0.1:4173"],
    videoSummarizeBin: "/tmp/videosummarize",
    videoWorkspace: "/tmp/memo-video-test",
    videoProcessor: "mock",
    copywriterProvider: "local",
    volcAsrApiBase: "https://openspeech.bytedance.com/api/v3/auc/bigmodel",
    volcAsrResourceId: "volc.bigasr.auc",
    volcAsrPollIntervalMs: 1_000,
    volcAsrTimeoutMs: 300_000,
    arkApiBase: "https://ark.cn-beijing.volces.com/api/v3",
    arkAudioModel: "doubao-seed-2-0-lite-260428",
    arkSummaryModel: "doubao-seed-2-0-lite-260428",
    arkRequestTimeoutMs: 300_000,
    minimaxApiBase: "https://api.minimaxi.com",
    minimaxModel: "MiniMax-M3",
    enableWebTerminal: true,
    webTerminalToken: "test-terminal-token-123456",
    logLevel: "silent",
  };
  const logger = createLogger(config);
  await connectDatabase(config.mongodbUri, logger);
  const created = createApp({
    config,
    logger,
    videoProcessor: new MockVideoProcessor(),
  });
  api = request(created.app);
  runner = created.runner;
});

beforeEach(async () => {
  for (const collection of Object.values(mongoose.connection.collections)) {
    await collection.deleteMany({});
  }
});

afterAll(async () => {
  await runner.whenIdle();
  await disconnectDatabase();
  await mongo.stop();
});

async function register(identifier = "tester@example.com") {
  const response = await api.post("/api/v1/auth/register").send({
    identifier,
    password: "Password123",
    nickname: "测试用户",
  });
  expect(response.status).toBe(201);
  return response.body.data as {
    accessToken: string;
    refreshToken: string;
    user: { id: string };
  };
}

describe("健康检查", () => {
  it("返回服务和数据库就绪状态", async () => {
    const health = await api.get("/health");
    expect(health.status).toBe(200);
    expect(health.body.data.status).toBe("ok");

    const ready = await api.get("/ready");
    expect(ready.status).toBe(200);
    expect(ready.body.data.database).toBe("connected");
  });
});

describe("注册、登录和令牌刷新", () => {
  it("同一 installationId 可无感获取同一个游客账号", async () => {
    const installationId = "67ee89ba-7050-4c04-a3d7-ac61a63499b3";
    const first = await api.post("/api/v1/auth/guest").send({ installationId });
    expect(first.status).toBe(201);
    expect(first.body.data.user.accountType).toBe("guest");
    expect(first.body.data.user.email).toBeNull();
    expect(first.body.data.accessToken).toBeTypeOf("string");

    const second = await api.post("/api/v1/auth/guest").send({ installationId });
    expect(second.status).toBe(201);
    expect(second.body.data.user.id).toBe(first.body.data.user.id);

    const me = await api
      .get("/api/v1/auth/me")
      .set("Authorization", `Bearer ${second.body.data.accessToken}`);
    expect(me.status).toBe(200);
    expect(me.body.data.accountType).toBe("guest");
  });

  it("拒绝非法 installationId", async () => {
    const response = await api
      .post("/api/v1/auth/guest")
      .send({ installationId: "not-a-uuid" });
    expect(response.status).toBe(422);
  });

  it("完整走通注册、当前用户、登录、刷新和退出", async () => {
    const registered = await register();
    expect(registered.accessToken).toBeTypeOf("string");
    expect(registered.refreshToken).toBeTypeOf("string");

    const me = await api
      .get("/api/v1/auth/me")
      .set("Authorization", `Bearer ${registered.accessToken}`);
    expect(me.status).toBe(200);
    expect(me.body.data.email).toBe("tester@example.com");
    expect(me.body.data).not.toHaveProperty("passwordHash");

    const login = await api.post("/api/v1/auth/login").send({
      identifier: "TESTER@example.com",
      password: "Password123",
    });
    expect(login.status).toBe(200);

    const refreshed = await api.post("/api/v1/auth/refresh").send({
      refreshToken: login.body.data.refreshToken,
    });
    expect(refreshed.status).toBe(200);
    expect(refreshed.body.data.refreshToken).not.toBe(login.body.data.refreshToken);

    const reused = await api.post("/api/v1/auth/refresh").send({
      refreshToken: login.body.data.refreshToken,
    });
    expect(reused.status).toBe(401);
    expect(reused.body.error.code).toBe("REFRESH_TOKEN_INVALID");

    const logout = await api.post("/api/v1/auth/logout").send({
      refreshToken: refreshed.body.data.refreshToken,
    });
    expect(logout.status).toBe(204);
  });

  it("拒绝弱密码、重复账号和错误密码", async () => {
    const weak = await api.post("/api/v1/auth/register").send({
      identifier: "tester@example.com",
      password: "123",
    });
    expect(weak.status).toBe(422);
    expect(weak.body.error.code).toBe("VALIDATION_ERROR");

    await register();
    const duplicate = await api.post("/api/v1/auth/register").send({
      identifier: "tester@example.com",
      password: "Password123",
    });
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.error.code).toBe("ACCOUNT_EXISTS");

    const wrong = await api.post("/api/v1/auth/login").send({
      identifier: "tester@example.com",
      password: "WrongPassword1",
    });
    expect(wrong.status).toBe(401);
    expect(wrong.body.error.code).toBe("INVALID_CREDENTIALS");
  });

  it("支持中国手机号注册、规范化、登录和重复校验", async () => {
    const registered = await register("138 0013 8000");
    expect(registered.accessToken).toBeTypeOf("string");

    const me = await api
      .get("/api/v1/auth/me")
      .set("Authorization", `Bearer ${registered.accessToken}`);
    expect(me.status).toBe(200);
    expect(me.body.data.phone).toBe("+8613800138000");
    expect(me.body.data.email).toBeNull();

    const login = await api.post("/api/v1/auth/login").send({
      identifier: "+86 138-0013-8000",
      password: "Password123",
    });
    expect(login.status).toBe(200);

    const duplicate = await api.post("/api/v1/auth/register").send({
      identifier: "8613800138000",
      password: "Password123",
    });
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.error.code).toBe("ACCOUNT_EXISTS");
  });

  it("拒绝无效手机号或邮箱", async () => {
    const invalidPhone = await api.post("/api/v1/auth/register").send({
      identifier: "12345",
      password: "Password123",
    });
    expect(invalidPhone.status).toBe(422);

    const invalidEmail = await api.post("/api/v1/auth/register").send({
      identifier: "not-an-email@",
      password: "Password123",
    });
    expect(invalidEmail.status).toBe(422);
  });
});

describe("视频解析和承接文案", () => {
  it("创建任务、完成转录文案、查询详情并幂等返回同一任务", async () => {
    const session = await register();
    const authorization = `Bearer ${session.accessToken}`;
    const idempotencyKey = "capture-e2e-001";
    const capture = await api
      .post("/api/v1/captures")
      .set("Authorization", authorization)
      .set("Idempotency-Key", idempotencyKey)
      .send({
        url: "https://www.youtube.com/watch?v=test-video",
        quality: "balanced",
        language: "zh",
      });
    expect(capture.status).toBe(202);
    expect(capture.body.data.status).toBe("queued");
    const taskId = String(capture.body.data._id);

    const repeated = await api
      .post("/api/v1/captures")
      .set("Authorization", authorization)
      .set("Idempotency-Key", idempotencyKey)
      .send({
        url: "https://www.youtube.com/watch?v=test-video",
        quality: "balanced",
        language: "zh",
      });
    expect(String(repeated.body.data._id)).toBe(taskId);

    await runner.whenIdle();
    const task = await api
      .get(`/api/v1/tasks/${taskId}`)
      .set("Authorization", authorization);
    expect(task.status).toBe(200);
    expect(task.body.data.status).toBe("completed");
    expect(task.body.data.progress).toBe(100);
    expect(task.body.data.logs.length).toBeGreaterThan(3);

    const itemId = String(task.body.data.sourceItemId);
    const item = await api
      .get(`/api/v1/items/${itemId}`)
      .set("Authorization", authorization);
    expect(item.status).toBe(200);
    expect(item.body.data.transcript.segments.length).toBe(5);
    expect(item.body.data.copywriting.oneSentenceSummary).toBeTruthy();
    expect(item.body.data.copywriting.keyPoints.length).toBeGreaterThan(0);
    expect(item.body.data.copywriting.markdown).toContain("## 关键观点");

    const list = await api
      .get("/api/v1/items?page=1&pageSize=20")
      .set("Authorization", authorization);
    expect(list.status).toBe(200);
    expect(list.body.meta.total).toBe(1);
    expect(list.body.data[0].transcript).not.toHaveProperty("text");

    const removed = await api
      .delete(`/api/v1/items/${itemId}`)
      .set("Authorization", authorization);
    expect(removed.status).toBe(204);
    const missing = await api
      .get(`/api/v1/items/${itemId}`)
      .set("Authorization", authorization);
    expect(missing.status).toBe(404);
  });

  it("拒绝未登录、非法平台和错误 ID", async () => {
    const unauthorized = await api.post("/api/v1/captures").send({
      url: "https://www.youtube.com/watch?v=x",
    });
    expect(unauthorized.status).toBe(401);

    const session = await register();
    const authorization = `Bearer ${session.accessToken}`;
    const unsupported = await api
      .post("/api/v1/captures")
      .set("Authorization", authorization)
      .send({ url: "https://127.0.0.1/private.mp4" });
    expect(unsupported.status).toBe(422);

    const invalidId = await api
      .get("/api/v1/tasks/not-an-id")
      .set("Authorization", authorization);
    expect(invalidId.status).toBe(422);
  });
});
