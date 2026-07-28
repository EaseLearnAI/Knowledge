import { resolve } from "node:path";
import cors from "cors";
import express, { type Express } from "express";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import type { AppConfig } from "../platform/config/app-config.js";
import { createAuthRouter } from "../modules/auth/adapters/http/auth.routes.js";
import { createHealthRouter } from "../modules/operations/health.routes.js";
import { createTerminalRouter } from "../modules/operations/terminal.routes.js";
import { createBilibiliMediaProxyRouter } from "../integrations/media/bilibili-media-proxy.js";
import { VideoTaskRunner } from "../modules/processing/application/task-runner.js";
import {
  resolvePublicBilibiliMedia,
} from "../integrations/transcription/volc/volc-asr-video.processor.js";
import { createCaptureRouter } from "../modules/capture/adapters/http/capture.routes.js";
import { createLibraryRouter } from "../modules/library/adapters/http/library.routes.js";
import { errorHandler, notFoundHandler } from "../platform/http/errors/error-handler.js";
import type { AppLogger } from "../platform/observability/logger.js";
import { requestLogger } from "../platform/http/request-logger.middleware.js";
import {
  createProcessingContainer,
  type ProcessingOverrides,
} from "./create-container.js";

export type AppDependencies = ProcessingOverrides & {
  config: AppConfig;
  logger: AppLogger;
};

export type CreatedApp = {
  app: Express;
  runner: VideoTaskRunner;
};

export function createApp(dependencies: AppDependencies): CreatedApp {
  const { config, logger } = dependencies;
  const { processor, copywriter } = createProcessingContainer(
    config,
    dependencies,
  );
  const runner = new VideoTaskRunner(
    processor,
    copywriter,
    logger,
    {
      enabled: config.workerMode !== "api",
      leaseSeconds: config.workerLeaseSeconds,
      maxAttempts: config.workerMaxAttempts,
    },
  );
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
  app.use(
    "/api/v1/internal",
    createBilibiliMediaProxyRouter(config, resolvePublicBilibiliMedia),
  );
  app.use("/api/v1/auth", createAuthRouter(config));
  app.use("/api/v1", createTerminalRouter(config));
  app.use("/api/v1", createCaptureRouter(config, runner));
  app.use("/api/v1", createLibraryRouter(config));
  app.get("/docs/openapi.yaml", (_request, response) => {
    response.sendFile(resolve("../contracts/openapi/memo-v1.yaml"));
  });
  app.use("/docs", express.static(resolve("docs")));
  if (config.enableWebTerminal) {
    app.use("/terminal", express.static(resolve("public"), { index: "terminal.html" }));
  }

  app.use(notFoundHandler());
  app.use(errorHandler(logger));
  return { app, runner };
}
