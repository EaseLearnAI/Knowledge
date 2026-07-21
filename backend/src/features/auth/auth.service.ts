import bcrypt from "bcryptjs";
import type { AppConfig } from "../../config.js";
import { AppError } from "../../shared/errors/app-error.js";
import {
  createAccessToken,
  createRefreshToken,
  hashToken,
} from "../../shared/security/tokens.js";
import type { LoginInput, RegisterInput } from "./auth.schemas.js";
import { RefreshTokenModel } from "./refresh-token.model.js";
import { UserModel } from "./user.model.js";

type PublicUser = {
  id: string;
  email: string;
  nickname: string;
  createdAt: Date;
};

type AuthResult = {
  user: PublicUser;
  accessToken: string;
  refreshToken: string;
  tokenType: "Bearer";
};

function publicUser(user: {
  _id: unknown;
  email: string;
  nickname: string;
  createdAt: Date;
}): PublicUser {
  return {
    id: String(user._id),
    email: user.email,
    nickname: user.nickname,
    createdAt: user.createdAt,
  };
}

async function issueTokens(
  user: { _id: unknown; email: string; nickname: string; createdAt: Date },
  config: AppConfig,
): Promise<AuthResult> {
  const accessToken = await createAccessToken(
    { userId: String(user._id), email: user.email },
    config,
  );
  const refreshToken = createRefreshToken();
  const expiresAt = new Date(
    Date.now() + config.refreshTokenTtlDays * 24 * 60 * 60 * 1_000,
  );

  await RefreshTokenModel.create({
    userId: user._id,
    tokenHash: hashToken(refreshToken),
    expiresAt,
  });

  return {
    user: publicUser(user),
    accessToken,
    refreshToken,
    tokenType: "Bearer",
  };
}

export async function register(input: RegisterInput, config: AppConfig): Promise<AuthResult> {
  const existing = await UserModel.exists({ email: input.email });
  if (existing) {
    throw new AppError(409, "EMAIL_EXISTS", "该邮箱已注册");
  }

  const passwordHash = await bcrypt.hash(input.password, 12);
  try {
    const user = await UserModel.create({
      email: input.email,
      passwordHash,
      nickname: input.nickname ?? input.email.split("@")[0] ?? "Memo 用户",
    });
    return issueTokens(user, config);
  } catch (error: unknown) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === 11000
    ) {
      throw new AppError(409, "EMAIL_EXISTS", "该邮箱已注册");
    }
    throw error;
  }
}

export async function login(input: LoginInput, config: AppConfig): Promise<AuthResult> {
  const user = await UserModel.findOne({ email: input.email }).select("+passwordHash");
  if (!user || !(await bcrypt.compare(input.password, user.passwordHash))) {
    throw new AppError(401, "INVALID_CREDENTIALS", "邮箱或密码错误");
  }
  return issueTokens(user, config);
}

export async function refreshSession(
  token: string,
  config: AppConfig,
): Promise<AuthResult> {
  const record = await RefreshTokenModel.findOne({
    tokenHash: hashToken(token),
    revokedAt: { $exists: false },
    expiresAt: { $gt: new Date() },
  });
  if (!record) {
    throw new AppError(401, "REFRESH_TOKEN_INVALID", "刷新令牌无效或已过期");
  }

  const user = await UserModel.findById(record.userId);
  if (!user) {
    throw new AppError(401, "REFRESH_TOKEN_INVALID", "刷新令牌对应用户不存在");
  }

  record.revokedAt = new Date();
  await record.save();
  return issueTokens(user, config);
}

export async function logout(token: string): Promise<void> {
  await RefreshTokenModel.updateOne(
    { tokenHash: hashToken(token), revokedAt: { $exists: false } },
    { $set: { revokedAt: new Date() } },
  );
}

export async function getCurrentUser(userId: string): Promise<PublicUser> {
  const user = await UserModel.findById(userId).lean();
  if (!user) throw new AppError(404, "USER_NOT_FOUND", "用户不存在");
  return publicUser(user);
}
