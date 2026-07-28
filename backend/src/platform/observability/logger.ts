import pino from "pino";
import type { AppConfig } from "../config/app-config.js";

export function createLogger(config: AppConfig) {
  return pino({
    level: config.logLevel,
    base: { service: "memo-knowledge-backend" },
    redact: {
      paths: [
        "req.headers.authorization",
        "req.headers.cookie",
        "req.body.password",
        "req.body.refreshToken",
        "*.password",
        "*.refreshToken",
        "*.accessToken",
        "*.token",
      ],
      censor: "[REDACTED]",
    },
  });
}

export type AppLogger = ReturnType<typeof createLogger>;
