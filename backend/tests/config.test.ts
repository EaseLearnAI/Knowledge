import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";

const productionBase = {
  NODE_ENV: "production",
  JWT_ACCESS_SECRET: "production-secret-with-at-least-thirty-two-characters",
  VIDEO_PROCESSOR: "volc_asr",
  COPYWRITER_PROVIDER: "ark",
  PUBLIC_BASE_URL: "https://api.example.com",
  WORKER_MODE: "api",
  TOS_ENABLED: "true",
  TOS_ACCESS_KEY: "tos-ak-test",
  TOS_SECRET_KEY: "tos-sk-test",
  TOS_TEMP_BUCKET: "memo-asr-temp-test",
  ARK_SUMMARY_MODEL: "ep-summary-test",
};

describe("production config", () => {
  it("缺少云端 ASR 凭据时启动失败", () => {
    expect(() =>
      loadConfig({
        ...productionBase,
        ARK_API_KEY: "ark-test",
      }),
    ).toThrow("VOLC_ASR_APP_ID");
  });

  it("生产环境拒绝依赖本机浏览器 Cookie", () => {
    expect(() =>
      loadConfig({
        ...productionBase,
        VOLC_ASR_APP_ID: "app-test",
        VOLC_ASR_ACCESS_TOKEN: "token-test",
        ARK_API_KEY: "ark-test",
        VIDEO_COOKIE_BROWSER: "chrome",
      }),
    ).toThrow("生产环境禁止读取本机浏览器 Cookie");
  });

  it("生产环境拒绝本地 Whisper 与模拟总结", () => {
    expect(() =>
      loadConfig({
        ...productionBase,
        VIDEO_PROCESSOR: "cli",
        VOLC_ASR_APP_ID: "app-test",
        VOLC_ASR_ACCESS_TOKEN: "token-test",
        ARK_API_KEY: "ark-test",
      }),
    ).toThrow("禁止依赖本地 Whisper");

    expect(() =>
      loadConfig({
        ...productionBase,
        COPYWRITER_PROVIDER: "local",
        VOLC_ASR_APP_ID: "app-test",
        VOLC_ASR_ACCESS_TOKEN: "token-test",
        ARK_API_KEY: "ark-test",
      }),
    ).toThrow("禁止回退到本地模拟总结");
  });

  it("云端凭据齐全时使用生产默认链路", () => {
    const config = loadConfig({
      ...productionBase,
      VOLC_ASR_APP_ID: "app-test",
      VOLC_ASR_ACCESS_TOKEN: "token-test",
      ARK_API_KEY: "ark-test",
    });
    expect(config.videoProcessor).toBe("volc_asr");
    expect(config.volcAsrMaxAttempts).toBe(3);
    expect(config.volcAsrTimeoutMs).toBe(10_800_000);
    expect(config.arkSummaryModel).toBe("ep-summary-test");
    expect(config.arkSummaryFallbackModels).toEqual([]);
  });

  it("生产环境拒绝 API 内嵌执行长任务", () => {
    expect(() =>
      loadConfig({
        ...productionBase,
        WORKER_MODE: "embedded",
        VOLC_ASR_APP_ID: "app-test",
        VOLC_ASR_ACCESS_TOKEN: "token-test",
        ARK_API_KEY: "ark-test",
      }),
    ).toThrow("禁止 API 进程执行长任务");
  });

  it("生产环境拒绝把模型目录 ID 当作推理接入点", () => {
    expect(() =>
      loadConfig({
        ...productionBase,
        ARK_SUMMARY_MODEL: "doubao-seed-1-6-flash-250828",
        VOLC_ASR_APP_ID: "app-test",
        VOLC_ASR_ACCESS_TOKEN: "token-test",
        ARK_API_KEY: "ark-test",
      }),
    ).toThrow("ep-");
  });

  it("M3 多模态生产链路要求 MiniMax Key 和对应总结器", () => {
    expect(() =>
      loadConfig({
        ...productionBase,
        MINIMAX_MULTIMODAL_ENABLED: "true",
        COPYWRITER_PROVIDER: "minimax",
        VOLC_ASR_APP_ID: "app-test",
        VOLC_ASR_ACCESS_TOKEN: "token-test",
      }),
    ).toThrow("MINIMAX_API_KEY");

    const config = loadConfig({
      ...productionBase,
      MINIMAX_MULTIMODAL_ENABLED: "true",
      COPYWRITER_PROVIDER: "minimax",
      MINIMAX_API_KEY: "minimax-test",
      VOLC_ASR_APP_ID: "app-test",
      VOLC_ASR_ACCESS_TOKEN: "token-test",
    });
    expect(config.minimaxMultimodalEnabled).toBe(true);
    expect(config.minimaxShortVideoMaxSeconds).toBe(180);
    expect(config.minimaxVideoFps).toBe(1);
  });
});
