import type { NextFunction, Request, Response } from "express";
import type { AppConfig } from "../config/app-config.js";
import { UserModel } from "../../modules/auth/adapters/mongo/user.model.js";
import { AppError } from "../http/errors/app-error.js";
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
      const userExists = await UserModel.exists({ _id: request.auth.userId });
      if (!userExists) {
        next(new AppError(401, "TOKEN_INVALID", "访问令牌无效或已过期"));
        return;
      }
      next();
    } catch (error) {
      next(error);
    }
  };
}
