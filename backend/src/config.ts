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
  VIDEOSUMMARIZE_BIN: z.string().default(
    "/Users/mac/Desktop/03_学习与研究/study/视频解析学习/skill方案/cliskill/.venv/bin/videosummarize",
  ),
  VIDEOSUMMARIZE_WORKSPACE: z.string().default("./storage/workspaces"),
  VIDEO_PROCESSOR: z.enum(["cli", "ark", "volc_asr", "mock"]).default("cli"),
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
    .default(1_000),
  VOLC_ASR_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .min(10_000)
    .max(900_000)
    .default(300_000),
  ARK_API_KEY: z.string().optional(),
  ARK_API_BASE: z.string().url().default("https://ark.cn-beijing.volces.com/api/v3"),
  ARK_AUDIO_MODEL: z.string().min(1).default("doubao-seed-2-0-lite-260428"),
  ARK_SUMMARY_MODEL: z.string().min(1).default("doubao-seed-2-0-lite-260428"),
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
  videoSummarizeBin: string;
  videoWorkspace: string;
  videoProcessor: "cli" | "ark" | "volc_asr" | "mock";
  copywriterProvider: "local" | "minimax" | "ark";
  volcAsrAppId?: string;
  volcAsrAccessToken?: string;
  volcAsrApiBase: string;
  volcAsrResourceId: string;
  volcAsrPollIntervalMs: number;
  volcAsrTimeoutMs: number;
  arkApiKey?: string;
  arkApiBase: string;
  arkAudioModel: string;
  arkSummaryModel: string;
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
    videoSummarizeBin: env.VIDEOSUMMARIZE_BIN,
    videoWorkspace: resolve(env.VIDEOSUMMARIZE_WORKSPACE),
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
    ...(env.ARK_API_KEY ? { arkApiKey: env.ARK_API_KEY } : {}),
    arkApiBase: env.ARK_API_BASE,
    arkAudioModel: env.ARK_AUDIO_MODEL,
    arkSummaryModel: env.ARK_SUMMARY_MODEL,
    arkRequestTimeoutMs: env.ARK_REQUEST_TIMEOUT_MS,
    ...(env.MINIMAX_API_KEY ? { minimaxApiKey: env.MINIMAX_API_KEY } : {}),
    minimaxApiBase: env.MINIMAX_API_BASE,
    minimaxModel: env.MINIMAX_MODEL,
    enableWebTerminal: env.ENABLE_WEB_TERMINAL,
    webTerminalToken: env.WEB_TERMINAL_TOKEN,
    logLevel: env.LOG_LEVEL,
  };
}
