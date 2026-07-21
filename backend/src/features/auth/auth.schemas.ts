import { z } from "zod";

const email = z.string().trim().toLowerCase().email("邮箱格式不正确");
const password = z
  .string()
  .min(8, "密码至少 8 位")
  .max(72, "密码最多 72 位")
  .regex(/[A-Za-z]/, "密码必须包含字母")
  .regex(/\d/, "密码必须包含数字");

export const registerSchema = z.object({
  email,
  password,
  nickname: z.string().trim().min(1, "昵称不能为空").max(40).optional(),
});

export const loginSchema = z.object({
  email,
  password: z.string().min(1, "密码不能为空").max(72),
});

export const refreshSchema = z.object({
  refreshToken: z.string().min(32),
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
