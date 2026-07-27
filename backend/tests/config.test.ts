import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";

const productionBase = {
  NODE_ENV: "production",
  JWT_ACCESS_SECRET: "production-secret-with-at-least-thirty-two-characters",
  VIDEO_PROCESSOR: "volc_asr",
  COPYWRITER_PROVIDER: "ark",
  PUBLIC_BASE_URL: "https://api.example.com",
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
    expect(config.arkSummaryModel).toBe("doubao-seed-2-0-mini-260428");
    expect(config.arkSummaryFallbackModels).toEqual([
      "doubao-seed-1-8-251228",
    ]);
  });

  it("生产音频代理只接受公网 HTTPS 基础地址", () => {
    expect(() =>
      loadConfig({
        ...productionBase,
        PUBLIC_BASE_URL: "http://127.0.0.1:3100",
        VOLC_ASR_APP_ID: "app-test",
        VOLC_ASR_ACCESS_TOKEN: "token-test",
        ARK_API_KEY: "ark-test",
      }),
    ).toThrow("公网 HTTPS");
  });
});
