import type { ErrorRequestHandler, RequestHandler } from "express";
import multer from "multer";
import { AppError } from "./app-error.js";
import type { AppLogger } from "../../observability/logger.js";

export function notFoundHandler(): RequestHandler {
  return (request, _response, next) => {
    next(new AppError(404, "ROUTE_NOT_FOUND", `接口不存在：${request.method} ${request.path}`));
  };
}

export function errorHandler(logger: AppLogger): ErrorRequestHandler {
  return (error: unknown, request, response, next) => {
    if (response.headersSent) {
      next(error);
      return;
    }

    let appError: AppError;
    if (error instanceof AppError) {
      appError = error;
    } else if (error instanceof multer.MulterError) {
      appError = new AppError(
        error.code === "LIMIT_FILE_SIZE" ? 413 : 422,
        error.code,
        error.code === "LIMIT_FILE_SIZE"
          ? "上传文件不能超过 512 MB"
          : `上传失败：${error.message}`,
      );
    } else if (
      error instanceof SyntaxError &&
      "status" in error &&
      error.status === 400
    ) {
      appError = new AppError(400, "INVALID_JSON", "请求体不是有效 JSON");
    } else {
      appError = new AppError(500, "INTERNAL_ERROR", "服务器内部错误");
    }

    const logData = {
      event: "request.failed",
      requestId: request.requestId,
      method: request.method,
      path: request.path,
      statusCode: appError.statusCode,
      code: appError.code,
      error,
    };
    if (appError.statusCode >= 500) logger.error(logData, appError.message);
    else logger.warn(logData, appError.message);

    response.status(appError.statusCode).json({
      success: false,
      error: {
        code: appError.code,
        message: appError.message,
        ...(appError.details === undefined ? {} : { details: appError.details }),
        requestId: request.requestId,
      },
    });
  };
}
