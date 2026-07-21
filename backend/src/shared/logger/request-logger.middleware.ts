import { randomUUID } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import type { AppLogger } from "./logger.js";
import { terminalEventBus } from "./event-bus.js";

export function requestLogger(logger: AppLogger) {
  return (request: Request, response: Response, next: NextFunction): void => {
    request.requestId = request.header("X-Request-Id") ?? randomUUID();
    response.setHeader("X-Request-Id", request.requestId);
    const startedAt = performance.now();
    const originalPath = request.originalUrl.split("?")[0] ?? request.path;
    const safeData = {
      method: request.method,
      path: originalPath,
      contentType: request.header("content-type") ?? null,
    };
    logger.info({ event: "request.started", requestId: request.requestId, ...safeData }, "收到请求");
    terminalEventBus.publish({
      level: "info",
      event: "request.started",
      message: `发起请求 ${request.method} ${request.path}`,
      requestId: request.requestId,
      data: safeData,
    });

    response.on("finish", () => {
      const durationMs = Math.round((performance.now() - startedAt) * 100) / 100;
      const data = {
        method: request.method,
        path: originalPath,
        statusCode: response.statusCode,
        durationMs,
      };
      logger.info(
        { event: "request.completed", requestId: request.requestId, ...data },
        "请求响应完成",
      );
      terminalEventBus.publish({
        level: response.statusCode >= 400 ? "warn" : "info",
        event: "request.completed",
        message: `请求响应 ${response.statusCode} ${request.method} ${request.path}`,
        requestId: request.requestId,
        data,
      });
    });
    next();
  };
}
