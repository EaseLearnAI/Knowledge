import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { extname, resolve } from "node:path";
import { Router } from "express";
import multer from "multer";
import type { AppConfig } from "../../../../platform/config/app-config.js";
import { AppError } from "../../../../platform/http/errors/app-error.js";
import { sendSuccess } from "../../../../platform/http/response.js";
import { validate } from "../../../../platform/http/validate.js";
import { terminalEventBus } from "../../../../platform/observability/event-bus.js";
import { requireAuth } from "../../../../platform/security/auth.middleware.js";
import type { VideoTaskRunner } from "../../../processing/application/task-runner.js";
import {
  createCaptureTask,
  getCaptureTask,
} from "../../application/capture.service.js";
import {
  createCaptureSchema,
  taskIdSchema,
  uploadOptionsSchema,
} from "./capture.schemas.js";

const allowedExtensions = new Set([".mp4", ".mov", ".m4a", ".mp3", ".wav", ".webm"]);

export function createCaptureRouter(
  config: AppConfig,
  runner: VideoTaskRunner,
): Router {
  const router = Router();
  const uploadDir = resolve("storage/uploads");
  mkdirSync(uploadDir, { recursive: true });
  const upload = multer({
    dest: uploadDir,
    limits: { fileSize: 512 * 1024 * 1024, files: 1 },
    fileFilter: (_request, file, callback) => {
      const extension = extname(file.originalname).toLowerCase();
      if (!allowedExtensions.has(extension)) {
        callback(new AppError(415, "UNSUPPORTED_MEDIA_TYPE", "仅支持常见音视频文件"));
        return;
      }
      callback(null, true);
    },
  });

  router.use(requireAuth(config));

  router.post(
    "/captures",
    validate(createCaptureSchema),
    async (request, response) => {
      const task = await createCaptureTask(
        {
          userId: request.auth!.userId,
          inputType: "url",
          source: request.body.url,
          url: request.body.url,
          quality: request.body.quality,
          language: request.body.language,
          idempotencyKey:
            request.header("Idempotency-Key") ?? request.requestId ?? randomUUID(),
        },
        runner,
      );
      sendSuccess(response, task, 202);
    },
  );

  router.post(
    "/captures/upload",
    upload.single("file"),
    async (request, response) => {
      if (!request.file) {
        throw new AppError(422, "FILE_REQUIRED", "请上传 file 字段");
      }
      const options = uploadOptionsSchema.safeParse(request.body);
      if (!options.success) {
        throw new AppError(
          422,
          "VALIDATION_ERROR",
          "上传参数不符合要求",
          options.error.issues,
        );
      }
      const task = await createCaptureTask(
        {
          userId: request.auth!.userId,
          inputType: "upload",
          source: request.file.path,
          originalFilename: request.file.originalname,
          quality: options.data.quality,
          language: options.data.language,
          idempotencyKey:
            request.header("Idempotency-Key") ?? request.requestId ?? randomUUID(),
        },
        runner,
      );
      sendSuccess(response, task, 202);
    },
  );

  router.get(
    "/tasks/:id",
    validate(taskIdSchema, "params"),
    async (request, response) => {
      sendSuccess(
        response,
        await getCaptureTask(request.auth!.userId, String(request.params.id)),
      );
    },
  );

  router.get(
    "/tasks/:id/events",
    validate(taskIdSchema, "params"),
    async (request, response) => {
      await getCaptureTask(request.auth!.userId, String(request.params.id));
      response.setHeader("Content-Type", "text/event-stream");
      response.setHeader("Cache-Control", "no-cache");
      response.setHeader("Connection", "keep-alive");
      response.flushHeaders();
      const taskId = String(request.params.id);
      for (const event of terminalEventBus.recent(100).filter((item) => item.taskId === taskId)) {
        response.write(`id: ${event.id}\ndata: ${JSON.stringify(event)}\n\n`);
      }
      const listener = (event: { taskId?: string; id: number }) => {
        if (event.taskId === taskId) {
          response.write(`id: ${event.id}\ndata: ${JSON.stringify(event)}\n\n`);
        }
      };
      terminalEventBus.on("terminal-event", listener);
      request.on("close", () => terminalEventBus.off("terminal-event", listener));
    },
  );

  return router;
}
