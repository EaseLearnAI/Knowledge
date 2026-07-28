import { z } from "zod";
import {
  extractHttpUrls,
  isSupportedVideoUrl,
} from "../../../../integrations/media/video-url.js";

export const createCaptureSchema = z.object({
  url: z
    .string()
    .trim()
    .min(1, "请输入有效 URL")
    .transform((value, context) => {
      const urls = extractHttpUrls(value);
      if (urls.length === 0) {
        context.addIssue({
          code: "custom",
          message: "请输入包含有效 http 或 https 链接的分享内容",
        });
        return z.NEVER;
      }
      const supported = urls.find(isSupportedVideoUrl);
      if (!supported) {
        context.addIssue({
          code: "custom",
          message: "当前仅支持 B站、抖音和小红书链接",
        });
        return z.NEVER;
      }
      return supported.toString();
    }),
  quality: z.enum(["fast", "balanced", "accurate"]).default("balanced"),
  language: z.enum(["zh", "en", "ja", "auto"]).default("zh"),
});

export const uploadOptionsSchema = z.object({
  quality: z.enum(["fast", "balanced", "accurate"]).default("balanced"),
  language: z.enum(["zh", "en", "ja", "auto"]).default("zh"),
});

export const taskIdSchema = z.object({
  id: z.string().regex(/^[a-f\d]{24}$/i, "ID 格式不正确"),
});
