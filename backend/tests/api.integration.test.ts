import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import type { AppConfig } from "../src/config.js";
import { RefreshTokenModel } from "../src/features/auth/refresh-token.model.js";
import { UserModel } from "../src/features/auth/user.model.js";
import { MockVideoProcessor } from "../src/features/video/mock-video.processor.js";
import { ProcessingTaskModel } from "../src/features/video/processing-task.model.js";
import { SourceItemModel } from "../src/features/video/source-item.model.js";
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

  it("修改密码后撤销旧会话并签发新会话", async () => {
    const registered = await register();

    const wrongCurrent = await api
      .patch("/api/v1/auth/me/password")
      .set("Authorization", `Bearer ${registered.accessToken}`)
      .send({
        currentPassword: "WrongPassword1",
        newPassword: "NewPassword123",
      });
    expect(wrongCurrent.status).toBe(401);
    expect(wrongCurrent.body.error.code).toBe("INVALID_CURRENT_PASSWORD");

    const unchanged = await api
      .patch("/api/v1/auth/me/password")
      .set("Authorization", `Bearer ${registered.accessToken}`)
      .send({
        currentPassword: "Password123",
        newPassword: "Password123",
      });
    expect(unchanged.status).toBe(409);
    expect(unchanged.body.error.code).toBe("PASSWORD_UNCHANGED");

    const weakPassword = await api
      .patch("/api/v1/auth/me/password")
      .set("Authorization", `Bearer ${registered.accessToken}`)
      .send({
        currentPassword: "Password123",
        newPassword: "passwordonly",
      });
    expect(weakPassword.status).toBe(422);
    expect(weakPassword.body.error.code).toBe("VALIDATION_ERROR");

    const changed = await api
      .patch("/api/v1/auth/me/password")
      .set("Authorization", `Bearer ${registered.accessToken}`)
      .send({
        currentPassword: "Password123",
        newPassword: "NewPassword123",
      });
    expect(changed.status).toBe(200);
    expect(changed.body.data.accessToken).toBeTypeOf("string");
    expect(changed.body.data.refreshToken).toBeTypeOf("string");

    const oldRefresh = await api.post("/api/v1/auth/refresh").send({
      refreshToken: registered.refreshToken,
    });
    expect(oldRefresh.status).toBe(401);

    const oldPassword = await api.post("/api/v1/auth/login").send({
      identifier: "tester@example.com",
      password: "Password123",
    });
    expect(oldPassword.status).toBe(401);

    const newPassword = await api.post("/api/v1/auth/login").send({
      identifier: "tester@example.com",
      password: "NewPassword123",
    });
    expect(newPassword.status).toBe(200);
  });

  it("删除账号、令牌、内容和任务，并立即拒绝旧访问令牌", async () => {
    const registered = await register();
    const item = await SourceItemModel.create({
      userId: registered.user.id,
      type: "video",
      platform: "B站",
      title: "待删除内容",
      status: "completed",
      tags: [],
      capturedAt: new Date(),
    });
    const task = await ProcessingTaskModel.create({
      userId: registered.user.id,
      sourceItemId: item._id,
      inputType: "url",
      source: "https://www.bilibili.com/video/BV1test",
      quality: "balanced",
      language: "zh",
      idempotencyKey: "delete-account-test",
      status: "completed",
      stage: "completed",
      progress: 100,
      logs: [],
    });
    item.taskId = task._id;
    await item.save();

    const wrongPassword = await api
      .delete("/api/v1/auth/me")
      .set("Authorization", `Bearer ${registered.accessToken}`)
      .send({ currentPassword: "WrongPassword1" });
    expect(wrongPassword.status).toBe(401);

    const deleted = await api
      .delete("/api/v1/auth/me")
      .set("Authorization", `Bearer ${registered.accessToken}`)
      .send({ currentPassword: "Password123" });
    expect(deleted.status).toBe(204);

    expect(await UserModel.countDocuments({ _id: registered.user.id })).toBe(0);
    expect(await RefreshTokenModel.countDocuments({ userId: registered.user.id })).toBe(0);
    expect(await SourceItemModel.countDocuments({ userId: registered.user.id })).toBe(0);
    expect(await ProcessingTaskModel.countDocuments({ userId: registered.user.id })).toBe(0);

    const oldAccess = await api
      .get("/api/v1/auth/me")
      .set("Authorization", `Bearer ${registered.accessToken}`);
    expect(oldAccess.status).toBe(401);

    const loginDeleted = await api.post("/api/v1/auth/login").send({
      identifier: "tester@example.com",
      password: "Password123",
    });
    expect(loginDeleted.status).toBe(401);
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
