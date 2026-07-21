import { resolve } from "node:path";
import cors from "cors";
import express, { type Express } from "express";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import type { AppConfig } from "./config.js";
import { createAuthRouter } from "./features/auth/auth.routes.js";
import { createHealthRouter } from "./features/health/health.routes.js";
import { createTerminalRouter } from "./features/terminal/terminal.routes.js";
import { LocalCopywriter } from "./features/video/local-copywriter.js";
import { MiniMaxCopywriter } from "./features/video/minimax-copywriter.js";
import { MockVideoProcessor } from "./features/video/mock-video.processor.js";
import { VideoTaskRunner } from "./features/video/task-runner.js";
import { createVideoRouter } from "./features/video/video.routes.js";
import type { Copywriter, VideoProcessor } from "./features/video/video.types.js";
import { VideoSummarizeProcessor } from "./features/video/videosummarize.processor.js";
import { errorHandler, notFoundHandler } from "./shared/errors/error-handler.js";
import type { AppLogger } from "./shared/logger/logger.js";
import { requestLogger } from "./shared/logger/request-logger.middleware.js";

export type AppDependencies = {
  config: AppConfig;
  logger: AppLogger;
  videoProcessor?: VideoProcessor;
  copywriter?: Copywriter;
};

export type CreatedApp = {
  app: Express;
  runner: VideoTaskRunner;
};

export function createApp(dependencies: AppDependencies): CreatedApp {
  const { config, logger } = dependencies;
  const processor =
    dependencies.videoProcessor ??
    (config.videoProcessor === "mock"
      ? new MockVideoProcessor()
      : new VideoSummarizeProcessor(config));
  const copywriter =
    dependencies.copywriter ??
    (config.copywriterProvider === "minimax"
      ? new MiniMaxCopywriter(config)
      : new LocalCopywriter());
  const runner = new VideoTaskRunner(processor, copywriter, logger);
  const app = express();

  app.disable("x-powered-by");
  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(
    cors({
      origin(origin, callback) {
        if (!origin || config.corsOrigins.includes(origin)) callback(null, true);
        else callback(new Error("CORS origin not allowed"));
      },
      credentials: true,
      allowedHeaders: ["Authorization", "Content-Type", "Idempotency-Key", "X-Request-Id"],
      exposedHeaders: ["X-Request-Id"],
    }),
  );
  app.use(express.json({ limit: "1mb", strict: true }));
  app.use(requestLogger(logger));
  app.use(
    "/api",
    rateLimit({
      windowMs: 60_000,
      limit: config.nodeEnv === "test" ? 10_000 : 120,
      standardHeaders: "draft-8",
      legacyHeaders: false,
    }),
  );

  app.use(createHealthRouter());
  app.use("/api/v1/auth", createAuthRouter(config));
  app.use("/api/v1", createTerminalRouter(config));
  app.use("/api/v1", createVideoRouter(config, runner));
  app.use("/docs", express.static(resolve("docs")));
  if (config.enableWebTerminal) {
    app.use("/terminal", express.static(resolve("public"), { index: "terminal.html" }));
  }

  app.use(notFoundHandler());
  app.use(errorHandler(logger));
  return { app, runner };
}
