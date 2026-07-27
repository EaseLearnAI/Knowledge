import bcrypt from "bcryptjs";
import { unlink } from "node:fs/promises";
import type { AppConfig } from "../../config.js";
import { AppError } from "../../shared/errors/app-error.js";
import { ProcessingTaskModel } from "../video/processing-task.model.js";
import { SourceItemModel } from "../video/source-item.model.js";
import {
  createAccessToken,
  createRefreshToken,
  hashToken,
} from "../../shared/security/tokens.js";
import type {
  ChangePasswordInput,
  DeleteAccountInput,
  LoginInput,
  RegisterInput,
} from "./auth.schemas.js";
import { RefreshTokenModel } from "./refresh-token.model.js";
import { UserModel } from "./user.model.js";

type PublicUser = {
  id: string;
  email: string | null;
  phone: string | null;
  nickname: string;
  createdAt: Date;
};

type AuthResult = {
  user: PublicUser;
  accessToken: string;
  refreshToken: string;
  tokenType: "Bearer";
};

type AuthUserRecord = {
  _id: unknown;
  email?: string | null;
  phone?: string | null;
  nickname: string;
  createdAt: Date;
};

function publicUser(user: AuthUserRecord): PublicUser {
  return {
    id: String(user._id),
    email: user.email ?? null,
    phone: user.phone ?? null,
    nickname: user.nickname,
    createdAt: user.createdAt,
  };
}

async function issueTokens(
  user: AuthUserRecord,
  config: AppConfig,
): Promise<AuthResult> {
  const accessToken = await createAccessToken(
    { userId: String(user._id) },
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

function identityFilter(identifier: RegisterInput["identifier"] | LoginInput["identifier"]) {
  return identifier.type === "email"
    ? { email: identifier.value }
    : { phone: identifier.value };
}

function defaultNickname(identifier: RegisterInput["identifier"]): string {
  if (identifier.type === "email") {
    return identifier.value.split("@")[0] || "Memo 用户";
  }
  return `用户${identifier.value.slice(-4)}`;
}

export async function register(input: RegisterInput, config: AppConfig): Promise<AuthResult> {
  const filter = identityFilter(input.identifier);
  const existing = await UserModel.exists(filter);
  if (existing) {
    throw new AppError(409, "ACCOUNT_EXISTS", "该手机号或邮箱已注册");
  }

  const passwordHash = await bcrypt.hash(input.password, 12);
  try {
    const user = await UserModel.create({
      ...filter,
      passwordHash,
      nickname: input.nickname ?? defaultNickname(input.identifier),
    });
    return issueTokens(user, config);
  } catch (error: unknown) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === 11000
    ) {
      throw new AppError(409, "ACCOUNT_EXISTS", "该手机号或邮箱已注册");
    }
    throw error;
  }
}

export async function login(input: LoginInput, config: AppConfig): Promise<AuthResult> {
  const user = await UserModel.findOne(identityFilter(input.identifier)).select(
    "+passwordHash",
  );
  if (!user || !(await bcrypt.compare(input.password, user.passwordHash))) {
    throw new AppError(401, "INVALID_CREDENTIALS", "手机号、邮箱或密码错误");
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

export async function changePassword(
  userId: string,
  input: ChangePasswordInput,
  config: AppConfig,
): Promise<AuthResult> {
  const user = await UserModel.findById(userId).select("+passwordHash");
  if (!user) throw new AppError(404, "USER_NOT_FOUND", "用户不存在");

  const currentMatches = await bcrypt.compare(
    input.currentPassword,
    user.passwordHash,
  );
  if (!currentMatches) {
    throw new AppError(401, "INVALID_CURRENT_PASSWORD", "当前密码不正确");
  }
  if (await bcrypt.compare(input.newPassword, user.passwordHash)) {
    throw new AppError(409, "PASSWORD_UNCHANGED", "新密码不能与当前密码相同");
  }

  user.passwordHash = await bcrypt.hash(input.newPassword, 12);
  await user.save();
  await RefreshTokenModel.deleteMany({ userId: user._id });
  return issueTokens(user, config);
}

export async function deleteAccount(
  userId: string,
  input: DeleteAccountInput,
): Promise<void> {
  const user = await UserModel.findById(userId).select("+passwordHash");
  if (!user) throw new AppError(404, "USER_NOT_FOUND", "用户不存在");
  if (!(await bcrypt.compare(input.currentPassword, user.passwordHash))) {
    throw new AppError(401, "INVALID_CURRENT_PASSWORD", "当前密码不正确");
  }

  const [tasks, items] = await Promise.all([
    ProcessingTaskModel.find({ userId })
      .select("inputType source")
      .lean(),
    SourceItemModel.find({ userId })
      .select("transcript.path")
      .lean(),
  ]);
  const ownedFiles = new Set<string>();
  for (const task of tasks) {
    if (task.inputType === "upload" && task.source) ownedFiles.add(task.source);
  }
  for (const item of items) {
    if (item.transcript?.path) ownedFiles.add(item.transcript.path);
  }

  await Promise.all([
    RefreshTokenModel.deleteMany({ userId }),
    ProcessingTaskModel.deleteMany({ userId }),
    SourceItemModel.deleteMany({ userId }),
  ]);
  await UserModel.deleteOne({ _id: userId });
  await Promise.all(
    [...ownedFiles].map((path) => unlink(path).catch(() => undefined)),
  );
}
