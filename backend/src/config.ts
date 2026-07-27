import { resolve } from "node:path";
import { z } from "zod";

const booleanString = z
  .enum(["true", "false"])
  .default("false")
  .transform((value: string) => value === "true");

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().min(1).max(65_535).default(3100),
  HOST: z.string().min(1).default("127.0.0.1"),
  MONGODB_URI: z
    .string()
    .min(1)
    .default("mongodb://localhost:27017/memo_knowledge"),
  JWT_ACCESS_SECRET: z
    .string()
    .min(32)
    .default("development-only-secret-change-before-production"),
  ACCESS_TOKEN_TTL: z.string().default("15m"),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().min(1).max(365).default(30),
  CORS_ORIGINS: z.string().default("http://127.0.0.1:4173,http://localhost:4173"),
  PUBLIC_BASE_URL: z.string().url().optional(),
  MEDIA_PROXY_TTL_SECONDS: z.coerce
    .number()
    .int()
    .min(300)
    .max(86_400)
    .default(14_400),
  VIDEOSUMMARIZE_BIN: z.string().default(
    "/Users/mac/Desktop/03_学习与研究/study/视频解析学习/skill方案/cliskill/.venv/bin/videosummarize",
  ),
  VIDEOSUMMARIZE_WORKSPACE: z.string().default("./storage/workspaces"),
  VIDEO_COOKIE_BROWSER: z.string().trim().min(1).optional(),
  VIDEO_COOKIE_FILE: z.string().trim().min(1).optional(),
  VIDEO_PROCESSOR: z
    .enum(["cli", "ark", "volc_asr", "mock"])
    .default("volc_asr"),
  COPYWRITER_PROVIDER: z.enum(["local", "minimax", "ark"]).default("local"),
  VOLC_ASR_APP_ID: z.string().optional(),
  VOLC_ASR_ACCESS_TOKEN: z.string().optional(),
  VOLC_ASR_API_BASE: z
    .string()
    .url()
    .default("https://openspeech.bytedance.com/api/v3/auc/bigmodel"),
  VOLC_ASR_RESOURCE_ID: z.string().min(1).default("volc.bigasr.auc"),
  VOLC_ASR_POLL_INTERVAL_MS: z.coerce
    .number()
    .int()
    .min(200)
    .max(10_000)
    .default(5_000),
  VOLC_ASR_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .min(10_000)
    .max(10_800_000)
    .default(10_800_000),
  VOLC_ASR_MAX_ATTEMPTS: z.coerce
    .number()
    .int()
    .min(1)
    .max(5)
    .default(3),
  ARK_API_KEY: z.string().optional(),
  ARK_API_BASE: z.string().url().default("https://ark.cn-beijing.volces.com/api/v3"),
  ARK_AUDIO_MODEL: z.string().min(1).default("doubao-seed-2-0-lite-260428"),
  ARK_SUMMARY_MODEL: z.string().min(1).default("doubao-seed-2-0-mini-260428"),
  ARK_SUMMARY_FALLBACK_MODELS: z.string().default(
    "doubao-seed-2-0-lite-260428",
  ),
  ARK_REQUEST_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .min(10_000)
    .max(900_000)
    .default(300_000),
  MINIMAX_API_KEY: z.string().optional(),
  MINIMAX_API_BASE: z.string().url().default("https://api.minimaxi.com"),
  MINIMAX_MODEL: z.string().min(1).default("MiniMax-M3"),
  ENABLE_WEB_TERMINAL: booleanString,
  WEB_TERMINAL_TOKEN: z.string().min(16).default("dev-terminal-token-change-me"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
});

export type AppConfig = {
  nodeEnv: "development" | "test" | "production";
  port: number;
  host: string;
  mongodbUri: string;
  jwtAccessSecret: string;
  accessTokenTtl: string;
  refreshTokenTtlDays: number;
  corsOrigins: string[];
  publicBaseUrl?: string;
  mediaProxyTtlSeconds: number;
  videoSummarizeBin: string;
  videoWorkspace: string;
  videoCookieBrowser?: string;
  videoCookieFile?: string;
  videoProcessor: "cli" | "ark" | "volc_asr" | "mock";
  copywriterProvider: "local" | "minimax" | "ark";
  volcAsrAppId?: string;
  volcAsrAccessToken?: string;
  volcAsrApiBase: string;
  volcAsrResourceId: string;
  volcAsrPollIntervalMs: number;
  volcAsrTimeoutMs: number;
  volcAsrMaxAttempts: number;
  arkApiKey?: string;
  arkApiBase: string;
  arkAudioModel: string;
  arkSummaryModel: string;
  arkSummaryFallbackModels?: string[];
  arkRequestTimeoutMs: number;
  minimaxApiKey?: string;
  minimaxApiBase: string;
  minimaxModel: string;
  enableWebTerminal: boolean;
  webTerminalToken: string;
  logLevel: string;
};

export function loadConfig(environment: NodeJS.ProcessEnv = process.env): AppConfig {
  const result = envSchema.safeParse(environment);
  if (!result.success) {
    throw new Error(`环境变量校验失败：${z.prettifyError(result.error)}`);
  }

  const env = result.data;
  if (
    env.NODE_ENV === "production" &&
    env.VIDEO_PROCESSOR === "volc_asr" &&
    (!env.VOLC_ASR_APP_ID || !env.VOLC_ASR_ACCESS_TOKEN)
  ) {
    throw new Error(
      "生产环境使用 volc_asr 时必须配置 VOLC_ASR_APP_ID 和 VOLC_ASR_ACCESS_TOKEN",
    );
  }
  if (env.NODE_ENV === "production" && env.VIDEO_PROCESSOR !== "volc_asr") {
    throw new Error(
      "生产环境必须使用 VIDEO_PROCESSOR=volc_asr，禁止依赖本地 Whisper 或 Mock",
    );
  }
  if (env.NODE_ENV === "production" && env.COPYWRITER_PROVIDER !== "ark") {
    throw new Error(
      "生产环境必须使用 COPYWRITER_PROVIDER=ark，禁止回退到本地模拟总结",
    );
  }
  if (
    env.NODE_ENV === "production" &&
    env.VIDEO_PROCESSOR === "volc_asr" &&
    (!env.PUBLIC_BASE_URL || new URL(env.PUBLIC_BASE_URL).protocol !== "https:")
  ) {
    throw new Error(
      "生产环境使用 volc_asr 时必须配置公网 HTTPS 的 PUBLIC_BASE_URL",
    );
  }
  if (
    env.NODE_ENV === "production" &&
    env.COPYWRITER_PROVIDER === "ark" &&
    !env.ARK_API_KEY
  ) {
    throw new Error("生产环境使用 ark 总结时必须配置 ARK_API_KEY");
  }
  if (env.NODE_ENV === "production" && env.VIDEO_COOKIE_BROWSER) {
    throw new Error(
      "生产环境禁止读取本机浏览器 Cookie，请使用 VIDEO_COOKIE_FILE 挂载服务端密钥",
    );
  }
  return {
    nodeEnv: env.NODE_ENV,
    port: env.PORT,
    host: env.HOST,
    mongodbUri: env.MONGODB_URI,
    jwtAccessSecret: env.JWT_ACCESS_SECRET,
    accessTokenTtl: env.ACCESS_TOKEN_TTL,
    refreshTokenTtlDays: env.REFRESH_TOKEN_TTL_DAYS,
    corsOrigins: env.CORS_ORIGINS.split(",")
      .map((value: string) => value.trim())
      .filter(Boolean),
    ...(env.PUBLIC_BASE_URL ? { publicBaseUrl: env.PUBLIC_BASE_URL } : {}),
    mediaProxyTtlSeconds: env.MEDIA_PROXY_TTL_SECONDS,
    videoSummarizeBin: env.VIDEOSUMMARIZE_BIN,
    videoWorkspace: resolve(env.VIDEOSUMMARIZE_WORKSPACE),
    ...(env.VIDEO_COOKIE_BROWSER
      ? { videoCookieBrowser: env.VIDEO_COOKIE_BROWSER }
      : {}),
    ...(env.VIDEO_COOKIE_FILE
      ? { videoCookieFile: resolve(env.VIDEO_COOKIE_FILE) }
      : {}),
    videoProcessor: env.VIDEO_PROCESSOR,
    copywriterProvider: env.COPYWRITER_PROVIDER,
    ...(env.VOLC_ASR_APP_ID ? { volcAsrAppId: env.VOLC_ASR_APP_ID } : {}),
    ...(env.VOLC_ASR_ACCESS_TOKEN
      ? { volcAsrAccessToken: env.VOLC_ASR_ACCESS_TOKEN }
      : {}),
    volcAsrApiBase: env.VOLC_ASR_API_BASE,
    volcAsrResourceId: env.VOLC_ASR_RESOURCE_ID,
    volcAsrPollIntervalMs: env.VOLC_ASR_POLL_INTERVAL_MS,
    volcAsrTimeoutMs: env.VOLC_ASR_TIMEOUT_MS,
    volcAsrMaxAttempts: env.VOLC_ASR_MAX_ATTEMPTS,
    ...(env.ARK_API_KEY ? { arkApiKey: env.ARK_API_KEY } : {}),
    arkApiBase: env.ARK_API_BASE,
    arkAudioModel: env.ARK_AUDIO_MODEL,
    arkSummaryModel: env.ARK_SUMMARY_MODEL,
    arkSummaryFallbackModels: env.ARK_SUMMARY_FALLBACK_MODELS.split(",")
      .map((value: string) => value.trim())
      .filter(
        (value: string, index: number, values: string[]) =>
          Boolean(value) &&
          value !== env.ARK_SUMMARY_MODEL &&
          values.indexOf(value) === index,
      ),
    arkRequestTimeoutMs: env.ARK_REQUEST_TIMEOUT_MS,
    ...(env.MINIMAX_API_KEY ? { minimaxApiKey: env.MINIMAX_API_KEY } : {}),
    minimaxApiBase: env.MINIMAX_API_BASE,
    minimaxModel: env.MINIMAX_MODEL,
    enableWebTerminal: env.ENABLE_WEB_TERMINAL,
    webTerminalToken: env.WEB_TERMINAL_TOKEN,
    logLevel: env.LOG_LEVEL,
  };
}
