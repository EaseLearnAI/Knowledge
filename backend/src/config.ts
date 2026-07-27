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
  WORKER_MODE: z.enum(["embedded", "api", "worker"]).default("embedded"),
  WORKER_POLL_INTERVAL_MS: z.coerce.number().int().min(250).max(60_000).default(2_000),
  WORKER_LEASE_SECONDS: z.coerce.number().int().min(30).max(900).default(120),
  WORKER_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(10).default(3),
  TEMP_AUDIO_DIR: z.string().min(1).default("./storage/tmp"),
  MEDIA_MAX_BYTES: z.coerce
    .number()
    .int()
    .min(1_048_576)
    .max(2_147_483_648)
    .default(536_870_912),
  MEDIA_MAX_DURATION_SECONDS: z.coerce
    .number()
    .int()
    .min(60)
    .max(18_000)
    .default(17_999),
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
  VIDEO_RESOLVER_PYTHON: z.string().trim().min(1).default("python3"),
  FFMPEG_BIN: z.string().trim().min(1).default("ffmpeg"),
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
  TOS_ENABLED: booleanString,
  TOS_ACCESS_KEY: z.string().trim().min(1).optional(),
  TOS_SECRET_KEY: z.string().trim().min(1).optional(),
  TOS_REGION: z.string().trim().min(1).default("cn-beijing"),
  TOS_ENDPOINT: z.string().trim().min(1).default("tos-cn-beijing.volces.com"),
  TOS_TEMP_BUCKET: z.string().trim().min(3).optional(),
  TOS_BACKUP_BUCKET: z.string().trim().min(3).optional(),
  TOS_SIGNED_URL_TTL_SECONDS: z.coerce
    .number()
    .int()
    .min(300)
    .max(86_400)
    .default(14_400),
  TOS_HELPER_PYTHON: z.string().trim().min(1).default("python3"),
  ARK_API_KEY: z.string().optional(),
  ARK_API_BASE: z.string().url().default("https://ark.cn-beijing.volces.com/api/v3"),
  ARK_AUDIO_MODEL: z.string().min(1).default("doubao-seed-2-0-lite-260428"),
  ARK_SUMMARY_MODEL: z.string().min(1).default("ep-replace-with-ark-endpoint-id"),
  ARK_SUMMARY_FALLBACK_MODELS: z.string().default(""),
  ARK_REQUEST_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .min(10_000)
    .max(900_000)
    .default(300_000),
  MINIMAX_API_KEY: z.string().optional(),
  MINIMAX_API_BASE: z.string().url().default("https://api.minimaxi.com"),
  MINIMAX_MODEL: z.string().min(1).default("MiniMax-M3"),
  MINIMAX_MULTIMODAL_ENABLED: booleanString,
  MINIMAX_SHORT_VIDEO_MAX_SECONDS: z.coerce
    .number()
    .int()
    .min(30)
    .max(3_600)
    .default(180),
  MINIMAX_VIDEO_DETAIL: z.enum(["low", "default", "high"]).default("default"),
  MINIMAX_VIDEO_FPS: z.coerce.number().min(0.2).max(5).default(1),
  MINIMAX_MEDIA_MAX_BYTES: z.coerce
    .number()
    .int()
    .min(1_048_576)
    .max(52_428_800)
    .default(49_000_000),
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
  workerMode: "embedded" | "api" | "worker";
  workerPollIntervalMs: number;
  workerLeaseSeconds: number;
  workerMaxAttempts: number;
  tempAudioDir: string;
  mediaMaxBytes: number;
  mediaMaxDurationSeconds: number;
  mediaProxyTtlSeconds: number;
  videoSummarizeBin: string;
  videoWorkspace: string;
  videoCookieBrowser?: string;
  videoCookieFile?: string;
  videoResolverPython: string;
  ffmpegBin: string;
  videoProcessor: "cli" | "ark" | "volc_asr" | "mock";
  copywriterProvider: "local" | "minimax" | "ark";
  volcAsrAppId?: string;
  volcAsrAccessToken?: string;
  volcAsrApiBase: string;
  volcAsrResourceId: string;
  volcAsrPollIntervalMs: number;
  volcAsrTimeoutMs: number;
  volcAsrMaxAttempts: number;
  tosEnabled: boolean;
  tosAccessKey?: string;
  tosSecretKey?: string;
  tosRegion: string;
  tosEndpoint: string;
  tosTempBucket?: string;
  tosBackupBucket?: string;
  tosSignedUrlTtlSeconds: number;
  tosHelperPython: string;
  arkApiKey?: string;
  arkApiBase: string;
  arkAudioModel: string;
  arkSummaryModel: string;
  arkSummaryFallbackModels?: string[];
  arkRequestTimeoutMs: number;
  minimaxApiKey?: string;
  minimaxApiBase: string;
  minimaxModel: string;
  minimaxMultimodalEnabled: boolean;
  minimaxShortVideoMaxSeconds: number;
  minimaxVideoDetail: "low" | "default" | "high";
  minimaxVideoFps: number;
  minimaxMediaMaxBytes: number;
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
  if (
    env.NODE_ENV === "production" &&
    env.COPYWRITER_PROVIDER === "ark" &&
    env.ARK_SUMMARY_FALLBACK_MODELS.split(",")
      .map((value) => value.trim())
      .filter(Boolean)
      .some((value) => !value.startsWith("ep-"))
  ) {
    throw new Error(
      "生产环境 ARK_SUMMARY_FALLBACK_MODELS 只能配置方舟推理接入点 ID（ep-...）",
    );
  }
  if (
    env.NODE_ENV === "production" &&
    env.MINIMAX_MULTIMODAL_ENABLED &&
    !env.MINIMAX_API_KEY
  ) {
    throw new Error(
      "生产环境启用 MiniMax M3 多模态解析时必须配置 MINIMAX_API_KEY",
    );
  }
  if (
    env.NODE_ENV === "production" &&
    env.MINIMAX_MULTIMODAL_ENABLED &&
    env.COPYWRITER_PROVIDER !== "minimax"
  ) {
    throw new Error(
      "生产环境启用 MiniMax M3 多模态解析时必须使用 COPYWRITER_PROVIDER=minimax",
    );
  }
  if (
    env.NODE_ENV === "production" &&
    (!env.TOS_ENABLED ||
      !env.TOS_ACCESS_KEY ||
      !env.TOS_SECRET_KEY ||
      !env.TOS_TEMP_BUCKET)
  ) {
    throw new Error(
      "生产环境必须启用 TOS，并配置 TOS_ACCESS_KEY、TOS_SECRET_KEY 和 TOS_TEMP_BUCKET",
    );
  }
  if (env.NODE_ENV === "production" && env.WORKER_MODE === "embedded") {
    throw new Error(
      "生产环境必须显式使用 WORKER_MODE=api 或 WORKER_MODE=worker，禁止 API 进程执行长任务",
    );
  }
  if (env.NODE_ENV === "production" && env.VIDEO_PROCESSOR !== "volc_asr") {
    throw new Error(
      "生产环境必须使用 VIDEO_PROCESSOR=volc_asr，禁止依赖本地 Whisper 或 Mock",
    );
  }
  if (
    env.NODE_ENV === "production" &&
    !env.MINIMAX_MULTIMODAL_ENABLED &&
    env.COPYWRITER_PROVIDER !== "ark"
  ) {
    throw new Error(
      "生产环境必须使用 COPYWRITER_PROVIDER=ark，禁止回退到本地模拟总结",
    );
  }
  if (
    env.NODE_ENV === "production" &&
    env.COPYWRITER_PROVIDER === "ark" &&
    !env.ARK_API_KEY
  ) {
    throw new Error("生产环境使用 ark 总结时必须配置 ARK_API_KEY");
  }
  if (
    env.NODE_ENV === "production" &&
    env.COPYWRITER_PROVIDER === "ark" &&
    (!env.ARK_SUMMARY_MODEL.startsWith("ep-") ||
      env.ARK_SUMMARY_MODEL.includes("replace"))
  ) {
    throw new Error(
      "生产环境必须将 ARK_SUMMARY_MODEL 配置为已开通的方舟推理接入点 ID（ep-...）",
    );
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
    workerMode: env.WORKER_MODE,
    workerPollIntervalMs: env.WORKER_POLL_INTERVAL_MS,
    workerLeaseSeconds: env.WORKER_LEASE_SECONDS,
    workerMaxAttempts: env.WORKER_MAX_ATTEMPTS,
    tempAudioDir: resolve(env.TEMP_AUDIO_DIR),
    mediaMaxBytes: env.MEDIA_MAX_BYTES,
    mediaMaxDurationSeconds: env.MEDIA_MAX_DURATION_SECONDS,
    mediaProxyTtlSeconds: env.MEDIA_PROXY_TTL_SECONDS,
    videoSummarizeBin: env.VIDEOSUMMARIZE_BIN,
    videoWorkspace: resolve(env.VIDEOSUMMARIZE_WORKSPACE),
    ...(env.VIDEO_COOKIE_BROWSER
      ? { videoCookieBrowser: env.VIDEO_COOKIE_BROWSER }
      : {}),
    ...(env.VIDEO_COOKIE_FILE
      ? { videoCookieFile: resolve(env.VIDEO_COOKIE_FILE) }
      : {}),
    videoResolverPython: env.VIDEO_RESOLVER_PYTHON,
    ffmpegBin: env.FFMPEG_BIN,
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
    tosEnabled: env.TOS_ENABLED,
    ...(env.TOS_ACCESS_KEY ? { tosAccessKey: env.TOS_ACCESS_KEY } : {}),
    ...(env.TOS_SECRET_KEY ? { tosSecretKey: env.TOS_SECRET_KEY } : {}),
    tosRegion: env.TOS_REGION,
    tosEndpoint: env.TOS_ENDPOINT,
    ...(env.TOS_TEMP_BUCKET ? { tosTempBucket: env.TOS_TEMP_BUCKET } : {}),
    ...(env.TOS_BACKUP_BUCKET ? { tosBackupBucket: env.TOS_BACKUP_BUCKET } : {}),
    tosSignedUrlTtlSeconds: env.TOS_SIGNED_URL_TTL_SECONDS,
    tosHelperPython: env.TOS_HELPER_PYTHON,
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
    minimaxMultimodalEnabled: env.MINIMAX_MULTIMODAL_ENABLED,
    minimaxShortVideoMaxSeconds: env.MINIMAX_SHORT_VIDEO_MAX_SECONDS,
    minimaxVideoDetail: env.MINIMAX_VIDEO_DETAIL,
    minimaxVideoFps: env.MINIMAX_VIDEO_FPS,
    minimaxMediaMaxBytes: env.MINIMAX_MEDIA_MAX_BYTES,
    enableWebTerminal: env.ENABLE_WEB_TERMINAL,
    webTerminalToken: env.WEB_TERMINAL_TOKEN,
    logLevel: env.LOG_LEVEL,
  };
}
