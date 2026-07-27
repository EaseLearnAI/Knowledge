import { z } from "zod";

const supportedHostPattern =
  /(^|\.)(bilibili\.com|b23\.tv|douyin\.com|iesdouyin\.com|xiaohongshu\.com|xhslink\.com)$/i;

export const createCaptureSchema = z.object({
  url: z
    .string()
    .url("请输入有效 URL")
    .refine((value: string) => {
      const parsed = new URL(value);
      return (
        ["http:", "https:"].includes(parsed.protocol) &&
        supportedHostPattern.test(parsed.hostname)
      );
    }, "当前仅支持 B站、抖音和小红书链接"),
  quality: z.enum(["fast", "balanced", "accurate"]).default("balanced"),
  language: z.enum(["zh", "en", "ja", "auto"]).default("zh"),
});

export const uploadOptionsSchema = z.object({
  quality: z.enum(["fast", "balanced", "accurate"]).default("balanced"),
  language: z.enum(["zh", "en", "ja", "auto"]).default("zh"),
});

export const mongoIdSchema = z.object({
  id: z.string().regex(/^[a-f\d]{24}$/i, "ID 格式不正确"),
});

export const listItemsQuerySchema = z.object({
  status: z.enum(["processing", "completed", "failed"]).optional(),
  q: z.string().trim().max(100).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});
