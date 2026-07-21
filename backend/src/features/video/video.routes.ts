import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { extname, resolve } from "node:path";
import { Router } from "express";
import multer from "multer";
import type { AppConfig } from "../../config.js";
import { AppError } from "../../shared/errors/app-error.js";
import { sendSuccess } from "../../shared/http/response.js";
import { validate } from "../../shared/http/validate.js";
import { terminalEventBus } from "../../shared/logger/event-bus.js";
import { requireAuth } from "../../shared/security/auth.middleware.js";
import type { VideoTaskRunner } from "./task-runner.js";
import {
  createCaptureSchema,
  listItemsQuerySchema,
  mongoIdSchema,
  uploadOptionsSchema,
} from "./video.schemas.js";
import {
  createVideoTask,
  deleteItem,
  getItem,
  getTask,
  listItems,
} from "./video.service.js";

const allowedExtensions = new Set([".mp4", ".mov", ".m4a", ".mp3", ".wav", ".webm"]);

export function createVideoRouter(
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
      const task = await createVideoTask(
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
      const task = await createVideoTask(
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

  router.get("/tasks/:id", validate(mongoIdSchema, "params"), async (request, response) => {
    sendSuccess(response, await getTask(request.auth!.userId, String(request.params.id)));
  });

  router.get(
    "/tasks/:id/events",
    validate(mongoIdSchema, "params"),
    async (request, response) => {
      await getTask(request.auth!.userId, String(request.params.id));
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

  router.get("/items", validate(listItemsQuerySchema, "query"), async (request, response) => {
    const result = await listItems(request.auth!.userId, request.query as never);
    sendSuccess(response, result.items, 200, {
      page: Number(request.query.page),
      pageSize: Number(request.query.pageSize),
      total: result.total,
    });
  });

  router.get("/items/:id", validate(mongoIdSchema, "params"), async (request, response) => {
    sendSuccess(response, await getItem(request.auth!.userId, String(request.params.id)));
  });

  router.delete(
    "/items/:id",
    validate(mongoIdSchema, "params"),
    async (request, response) => {
      await deleteItem(request.auth!.userId, String(request.params.id));
      response.status(204).send();
    },
  );

  return router;
}
