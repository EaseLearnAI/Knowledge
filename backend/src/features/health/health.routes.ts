import { Router } from "express";
import { databaseReady } from "../../shared/db/mongoose.js";
import { sendSuccess } from "../../shared/http/response.js";

export function createHealthRouter(): Router {
  const router = Router();

  router.get("/health", (_request, response) => {
    sendSuccess(response, {
      status: "ok",
      service: "memo-knowledge-backend",
      timestamp: new Date().toISOString(),
    });
  });

  router.get("/ready", (_request, response) => {
    if (!databaseReady()) {
      response.status(503).json({
        success: false,
        error: { code: "DATABASE_NOT_READY", message: "MongoDB 尚未连接" },
      });
      return;
    }
    sendSuccess(response, { status: "ready", database: "connected" });
  });

  return router;
}
