import type { NextFunction, Request, Response } from "express";
import type { AppConfig } from "../../config.js";
import { AppError } from "../errors/app-error.js";
import { verifyAccessToken } from "./tokens.js";

export function requireAuth(config: AppConfig) {
  return async (request: Request, _response: Response, next: NextFunction): Promise<void> => {
    const authorization = request.headers.authorization;
    if (!authorization?.startsWith("Bearer ")) {
      next(new AppError(401, "AUTH_REQUIRED", "请先登录"));
      return;
    }
    try {
      request.auth = await verifyAccessToken(authorization.slice(7), config);
      next();
    } catch (error) {
      next(error);
    }
  };
}
