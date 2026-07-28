import { createHash, randomBytes } from "node:crypto";
import { jwtVerify, SignJWT } from "jose";
import type { AppConfig } from "../config/app-config.js";
import { AppError } from "../http/errors/app-error.js";

export type AccessTokenPayload = {
  userId: string;
};

function secret(config: AppConfig): Uint8Array {
  return new TextEncoder().encode(config.jwtAccessSecret);
}

export async function createAccessToken(
  payload: AccessTokenPayload,
  config: AppConfig,
): Promise<string> {
  return new SignJWT()
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setSubject(payload.userId)
    .setIssuedAt()
    .setExpirationTime(config.accessTokenTtl)
    .sign(secret(config));
}

export async function verifyAccessToken(
  token: string,
  config: AppConfig,
): Promise<AccessTokenPayload> {
  try {
    const { payload } = await jwtVerify(token, secret(config), {
      algorithms: ["HS256"],
    });
    if (!payload.sub) {
      throw new Error("invalid payload");
    }
    return { userId: payload.sub };
  } catch {
    throw new AppError(401, "TOKEN_INVALID", "访问令牌无效或已过期");
  }
}

export function createRefreshToken(): string {
  return randomBytes(48).toString("base64url");
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
