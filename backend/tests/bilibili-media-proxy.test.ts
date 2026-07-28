import express from "express";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildSignedBilibiliMediaUrl,
  createBilibiliMediaProxyRouter,
} from "../src/integrations/media/bilibili-media-proxy.js";
import { AppError } from "../src/platform/http/errors/app-error.js";

const config = {
  jwtAccessSecret: "test-secret-with-at-least-thirty-two-characters",
  publicBaseUrl: "https://api.example.com",
  mediaProxyTtlSeconds: 14_400,
};

afterEach(() => {
  vi.unstubAllGlobals();
});

function createTestApp() {
  const app = express();
  app.use(
    "/api/v1/internal",
    createBilibiliMediaProxyRouter(config, async () => ({
      url: "https://cdn.example.com/audio.m4s",
    })),
  );
  app.use(
    (
      error: unknown,
      _request: express.Request,
      response: express.Response,
      _next: express.NextFunction,
    ) => {
      const appError =
        error instanceof AppError
          ? error
          : new AppError(500, "INTERNAL_ERROR", "服务器内部错误");
      response
        .status(appError.statusCode)
        .json({ error: { code: appError.code, message: appError.message } });
    },
  );
  return app;
}

describe("Bilibili signed media proxy", () => {
  it("验证签名后转发 Range 请求和音频响应", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(Buffer.from("audio"), {
        status: 206,
        headers: {
          "Accept-Ranges": "bytes",
          "Content-Length": "5",
          "Content-Range": "bytes 0-4/100",
          "Content-Type": "audio/mp4",
        },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const signed = buildSignedBilibiliMediaUrl(
      config,
      "https://www.bilibili.com/video/BV1nB3u6tERu/",
    );
    expect(signed).toBeTypeOf("string");
    const url = new URL(signed!);

    const response = await request(createTestApp())
      .get(`${url.pathname}${url.search}`)
      .set("Range", "bytes=0-4");

    expect(response.status).toBe(206);
    expect(response.headers["content-range"]).toBe("bytes 0-4/100");
    expect(response.body).toEqual(Buffer.from("audio"));
    expect(fetchMock).toHaveBeenCalledWith(
      "https://cdn.example.com/audio.m4s",
      expect.objectContaining({
        method: "GET",
        headers: expect.objectContaining({ Range: "bytes=0-4" }),
      }),
    );
  });

  it("拒绝被篡改或过期的代理 URL", async () => {
    const signed = buildSignedBilibiliMediaUrl(
      config,
      "https://www.bilibili.com/video/BV1nB3u6tERu/",
    );
    const url = new URL(signed!);
    url.searchParams.set("signature", "0".repeat(64));

    const response = await request(createTestApp()).get(
      `${url.pathname}${url.search}`,
    );

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe("MEDIA_PROXY_UNAUTHORIZED");
  });

  it("上游网络短暂失败时自动重试 Range 请求", async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("fetch failed"))
      .mockResolvedValueOnce(
        new Response(Buffer.from("ok"), {
          status: 206,
          headers: {
            "Content-Length": "2",
            "Content-Range": "bytes 0-1/100",
            "Content-Type": "application/octet-stream",
          },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);
    const signed = buildSignedBilibiliMediaUrl(
      config,
      "https://www.bilibili.com/video/BV1nB3u6tERu/",
    );
    const url = new URL(signed!);

    const response = await request(createTestApp())
      .get(`${url.pathname}${url.search}`)
      .set("Range", "bytes=0-1");

    expect(response.status).toBe(206);
    expect(response.body).toEqual(Buffer.from("ok"));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
