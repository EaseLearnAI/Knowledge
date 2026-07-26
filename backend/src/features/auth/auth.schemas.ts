import { z } from "zod";

export type AccountIdentifier = {
  type: "email" | "phone";
  value: string;
};

function normalizedPhone(rawValue: string): string | null {
  let value = rawValue.replace(/[\s\-().]/g, "");
  if (value.startsWith("0086")) value = `+86${value.slice(4)}`;
  else if (/^86\d{11}$/.test(value)) value = `+${value}`;
  else if (/^1[3-9]\d{9}$/.test(value)) value = `+86${value}`;
  if (!/^\+[1-9]\d{7,14}$/.test(value)) return null;
  return value;
}

export function normalizeIdentifier(rawValue: string): AccountIdentifier | null {
  const value = rawValue.trim();
  if (value.includes("@")) {
    const email = value.toLowerCase();
    if (!z.string().email().safeParse(email).success || email.length > 254) return null;
    return { type: "email", value: email };
  }
  const phone = normalizedPhone(value);
  return phone ? { type: "phone", value: phone } : null;
}

const identifier = z
  .string()
  .trim()
  .min(1, "请输入手机号或邮箱")
  .transform((value, context) => {
    const normalized = normalizeIdentifier(value);
    if (!normalized) {
      context.addIssue({
        code: "custom",
        message: "请输入有效的手机号或邮箱",
      });
      return z.NEVER;
    }
    return normalized;
  });

const password = z
  .string()
  .min(8, "密码至少 8 位")
  .max(72, "密码最多 72 位")
  .regex(/[A-Za-z]/, "密码必须包含字母")
  .regex(/\d/, "密码必须包含数字");

export const registerSchema = z.object({
  identifier,
  password,
  nickname: z.string().trim().min(1, "昵称不能为空").max(40).optional(),
});

export const loginSchema = z.object({
  identifier,
  password: z.string().min(1, "密码不能为空").max(72),
});

export const refreshSchema = z.object({
  refreshToken: z.string().min(32),
});

export const guestSchema = z.object({
  installationId: z.string().uuid("installationId 必须是 UUID"),
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type GuestInput = z.infer<typeof guestSchema>;
