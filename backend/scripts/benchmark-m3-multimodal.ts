import "dotenv/config";
import { MongoMemoryServer } from "mongodb-memory-server";
import request from "supertest";
import { createApp } from "../src/bootstrap/create-http-app.js";
import { loadConfig } from "../src/platform/config/app-config.js";
import {
  MiniMaxMultimodalAnalyzer,
} from "../src/integrations/analysis/minimax/minimax-multimodal.processor.js";
import {
  DefaultModelMediaStager,
  type StagedModelMedia,
} from "../src/integrations/media/model-media-stager.js";
import { DefaultPlatformContentResolver } from "../src/integrations/media/platform-content-resolver.js";
import type {
  ResolvedContent,
  VideoProcessInput,
} from "../src/modules/processing/domain/video.types.js";
import {
  connectDatabase,
  disconnectDatabase,
} from "../src/platform/database/mongoose.js";
import { createLogger } from "../src/platform/observability/logger.js";

type CaseResult = {
  id: string;
  name: string;
  passed: boolean;
  durationMs: number;
  details: Record<string, unknown>;
};

const IMAGE_URL =
  "https://filecdn.minimax.chat/public/af4294a2-daa8-435a-b8c6-a8f6d5975844.png";
const SECOND_IMAGE_URL =
  "https://filecdn.minimax.chat/public/46a6af8f-eeef-462b-b4a3-0da2481ebd43.png";
const PUBLIC_VIDEO_URL =
  "https://www.w3schools.com/html/mov_bbb.mp4";
const BILIBILI_SHORT_URL =
  process.env.M3_BENCHMARK_BILIBILI_URL ??
  "https://www.bilibili.com/video/BV1i7411X7jE/";

const config = loadConfig({
  ...process.env,
  NODE_ENV: "development",
  TOS_ENABLED: "false",
  MINIMAX_MODEL: process.env.MINIMAX_MODEL ?? "MiniMax-M3",
});
const analyzer = new MiniMaxMultimodalAnalyzer(config);
const stager = new DefaultModelMediaStager(config);
const resolver = new DefaultPlatformContentResolver(config);

function safeError(error: unknown): Record<string, unknown> {
  return {
    code:
      typeof error === "object" && error !== null && "code" in error
        ? String(error.code)
        : "UNKNOWN",
    message: error instanceof Error ? error.message : String(error),
  };
}

async function runCase(
  id: string,
  name: string,
  execute: () => Promise<Record<string, unknown>>,
): Promise<CaseResult> {
  console.error(`[${id}] START ${name}`);
  const startedAt = Date.now();
  try {
    const details = await execute();
    const result = {
      id,
      name,
      passed: true,
      durationMs: Date.now() - startedAt,
      details,
    };
    console.error(`[${id}] PASS ${result.durationMs}ms`);
    return result;
  } catch (error) {
    const result = {
      id,
      name,
      passed: false,
      durationMs: Date.now() - startedAt,
      details: safeError(error),
    };
    console.error(
      `[${id}] FAIL ${result.durationMs}ms ${JSON.stringify(result.details)}`,
    );
    return result;
  }
}

function assertAnalysis(
  result: Awaited<ReturnType<MiniMaxMultimodalAnalyzer["analyze"]>>,
): Record<string, unknown> {
  const keyPoints = result.copywriting?.keyPoints.length ?? 0;
  const tags = result.copywriting?.tags.length ?? 0;
  if (
    result.provider !== "minimax-m3-multimodal" ||
    result.analysisMode !== "minimax_m3_multimodal" ||
    result.text.trim().length < 20 ||
    keyPoints < 1 ||
    tags < 1 ||
    tags > 3
  ) {
    throw new Error("M3 结果未达到结构化验收标准");
  }
  return {
    provider: result.provider,
    analysisMode: result.analysisMode,
    textChars: result.text.length,
    keyPoints,
    tags,
    summary: result.copywriting?.oneSentenceSummary,
  };
}

async function analyzeWithCleanup(
  content: ResolvedContent,
  staged: StagedModelMedia,
): Promise<Record<string, unknown>> {
  try {
    const result = await analyzer.analyze(content, staged, () => undefined);
    return {
      transport: staged.transport ?? "remote_url",
      embeddedMediaChars:
        staged.videoUrl?.length ??
        staged.imageUrls.reduce((total, url) => total + url.length, 0),
      ...assertAnalysis(result),
    };
  } finally {
    await staged.cleanup();
  }
}

const imageContent: ResolvedContent = {
  kind: "image_post",
  platform: "xiaohongshu",
  title: "MiniMax 官方文档图片",
  text: "用于验证图片理解、OCR 和结构化总结。",
  durationSeconds: 0,
  assets: [{ kind: "image", url: IMAGE_URL, format: "png" }],
};

const input = (source: string, taskId: string): VideoProcessInput => ({
  taskId,
  source,
  quality: "balanced",
  language: "auto",
});

const results: CaseResult[] = [];
const selectedCases = new Set(
  (process.env.M3_BENCHMARK_CASES ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean),
);
const shouldRun = (id: string) =>
  selectedCases.size === 0 || selectedCases.has(id);

if (shouldRun("REAL-01")) results.push(
  await runCase("REAL-01", "远程图片 URL 直接调用 M3", async () =>
    analyzeWithCleanup(imageContent, {
      imageUrls: [IMAGE_URL],
      transport: "signed_url",
      cleanup: async () => undefined,
    }),
  ),
);

if (shouldRun("REAL-02")) results.push(
  await runCase("REAL-02", "本地下载图片并以内嵌 Data URL 调用 M3", async () => {
    const staged = await stager.stage(
      "benchmark-local-image",
      imageContent,
      () => undefined,
    );
    if (staged.transport !== "data_url") {
      throw new Error("本地模式没有选择 Data URL");
    }
    return analyzeWithCleanup(imageContent, staged);
  }),
);

if (shouldRun("REAL-03")) results.push(
  await runCase("REAL-03", "公共短视频本地转码并以内嵌 Data URL 调用 M3", async () => {
    const content: ResolvedContent = {
      kind: "short_video",
      platform: "douyin",
      title: "Big Buck Bunny 公开视频片段",
      text: "用于验证视频画面与音频理解。",
      durationSeconds: 10,
      assets: [{ kind: "video", url: PUBLIC_VIDEO_URL, format: "mp4" }],
    };
    const staged = await stager.stage(
      "benchmark-public-video",
      content,
      () => undefined,
    );
    if (staged.transport !== "data_url" || !staged.videoUrl) {
      throw new Error("本地视频没有生成 Data URL");
    }
    return analyzeWithCleanup(content, staged);
  }),
);

if (shouldRun("REAL-04")) results.push(
  await runCase("REAL-04", "真实 B站短链接解析、DASH 合并并调用 M3", async () => {
    const content = await resolver.resolve(
      input(BILIBILI_SHORT_URL, "benchmark-bilibili"),
      () => undefined,
    );
    if (
      content.kind !== "short_video" ||
      content.durationSeconds > config.minimaxShortVideoMaxSeconds
    ) {
      throw new Error(
        `样本不是短视频：${content.durationSeconds} 秒 / ${content.kind}`,
      );
    }
    const staged = await stager.stage(
      "benchmark-bilibili",
      content,
      () => undefined,
    );
    if (staged.transport !== "data_url" || !staged.videoUrl) {
      throw new Error("B站短视频没有生成 Data URL");
    }
    return {
      source: BILIBILI_SHORT_URL,
      title: content.title,
      durationSeconds: content.durationSeconds,
      ...await analyzeWithCleanup(content, staged),
    };
  }),
);

if (shouldRun("REAL-05")) results.push(
  await runCase("REAL-05", "多图内容本地编码并调用 M3", async () => {
    const content: ResolvedContent = {
      ...imageContent,
      title: "MiniMax 官方多图内容",
      assets: [
        { kind: "image", url: IMAGE_URL, format: "png" },
        { kind: "image", url: SECOND_IMAGE_URL, format: "png" },
      ],
    };
    const staged = await stager.stage(
      "benchmark-local-multi-image",
      content,
      () => undefined,
    );
    if (
      staged.transport !== "data_url" ||
      staged.imageUrls.length !== content.assets.length
    ) {
      throw new Error("多图没有完整转换为 Data URL");
    }
    return {
      imageCount: staged.imageUrls.length,
      ...await analyzeWithCleanup(content, staged),
    };
  }),
);

if (shouldRun("REAL-06")) results.push(
  await runCase("REAL-06", "完整 HTTP 任务、队列、持久化与 M3 链路", async () => {
    const mongo = await MongoMemoryServer.create();
    const httpConfig = loadConfig({
      ...process.env,
      NODE_ENV: "development",
      MONGODB_URI: mongo.getUri("memo_m3_http_benchmark"),
      WORKER_MODE: "embedded",
      VIDEO_PROCESSOR: "cli",
      COPYWRITER_PROVIDER: "minimax",
      MINIMAX_MULTIMODAL_ENABLED: "true",
      TOS_ENABLED: "false",
      VIDEO_RESOLVER_PYTHON: "python3",
    });
    const logger = createLogger(httpConfig);
    await connectDatabase(httpConfig.mongodbUri, logger);
    const { app, runner } = createApp({ config: httpConfig, logger });
    const api = request(app);
    try {
      const registered = await api.post("/api/v1/auth/register").send({
        identifier: `m3-benchmark-${Date.now()}@example.com`,
        password: "LocalTest123",
      });
      if (registered.status !== 201) {
        throw new Error(`注册失败：HTTP ${registered.status}`);
      }
      const authorization = `Bearer ${registered.body.data.accessToken}`;
      const capture = await api
        .post("/api/v1/captures")
        .set("Authorization", authorization)
        .set("Idempotency-Key", `m3-http-${Date.now()}`)
        .send({
          url: BILIBILI_SHORT_URL,
          quality: "balanced",
          language: "zh",
        });
      if (capture.status !== 202) {
        throw new Error(`创建任务失败：HTTP ${capture.status}`);
      }
      await runner.whenIdle();
      const task = await api
        .get(`/api/v1/tasks/${capture.body.data._id}`)
        .set("Authorization", authorization);
      const item = await api
        .get(`/api/v1/items/${task.body.data.sourceItemId}`)
        .set("Authorization", authorization);
      if (
        task.status !== 200 ||
        task.body.data.status !== "completed" ||
        task.body.data.contentKind !== "short_video" ||
        task.body.data.analysisMode !== "minimax_m3_multimodal" ||
        item.status !== 200 ||
        item.body.data.analysis?.mode !== "minimax_m3_multimodal"
      ) {
        throw new Error("HTTP 任务没有按 M3 多模态链路完成");
      }
      return {
        taskStatus: task.body.data.status,
        progress: task.body.data.progress,
        contentKind: task.body.data.contentKind,
        analysisMode: task.body.data.analysisMode,
        logs: task.body.data.logs?.length ?? 0,
        contentChars: item.body.data.content?.text?.length ?? 0,
        keyPoints: item.body.data.copywriting?.keyPoints?.length ?? 0,
        tags: item.body.data.tags?.length ?? 0,
        summary: item.body.data.copywriting?.oneSentenceSummary,
      };
    } finally {
      runner.stopPolling();
      await runner.whenIdle();
      await disconnectDatabase(logger);
      await mongo.stop();
    }
  }),
);

const passed = results.filter((result) => result.passed).length;
const report = {
  generatedAt: new Date().toISOString(),
  model: config.minimaxModel,
  mode: "local_data_url_without_tos",
  passed,
  failed: results.length - passed,
  total: results.length,
  results,
};

console.log(JSON.stringify(report, null, 2));
if (passed !== results.length) process.exitCode = 1;
