import { createHmac, timingSafeEqual } from "node:crypto";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { Router, type Request, type Response } from "express";
import { z } from "zod";
import type { AppConfig } from "../../config.js";
import { AppError } from "../../shared/errors/app-error.js";

type ProxyConfig = Pick<
  AppConfig,
  "jwtAccessSecret" | "publicBaseUrl" | "mediaProxyTtlSeconds"
>;

type ResolvedBilibiliMedia = {
  url: string;
};

const proxyQuerySchema = z.object({
  source: z.string().url(),
  expires: z.coerce.number().int().positive(),
  signature: z.string().regex(/^[0-9a-f]{64}$/),
});

function signatureFor(
  secret: string,
  source: string,
  expires: number,
): string {
  return createHmac("sha256", secret)
    .update(`${expires}\n${source}`)
    .digest("hex");
}

function signaturesMatch(expected: string, actual: string): boolean {
  const expectedBuffer = Buffer.from(expected, "hex");
  const actualBuffer = Buffer.from(actual, "hex");
  return (
    expectedBuffer.length === actualBuffer.length &&
    timingSafeEqual(expectedBuffer, actualBuffer)
  );
}

export function buildSignedBilibiliMediaUrl(
  config: ProxyConfig,
  source: string,
  now = Date.now(),
): string | undefined {
  if (!config.publicBaseUrl) return undefined;
  const expires = Math.floor(now / 1_000) + config.mediaProxyTtlSeconds;
  const url = new URL(
    "/api/v1/internal/asr-media/bilibili",
    config.publicBaseUrl,
  );
  url.searchParams.set("source", source);
  url.searchParams.set("expires", String(expires));
  url.searchParams.set(
    "signature",
    signatureFor(config.jwtAccessSecret, source, expires),
  );
  return url.toString();
}

export function createBilibiliMediaProxyRouter(
  config: ProxyConfig,
  resolveMedia: (source: string) => Promise<ResolvedBilibiliMedia>,
): Router {
  const router = Router();
  const handle = async (request: Request, response: Response) => {
    const parsed = proxyQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      throw new AppError(401, "MEDIA_PROXY_UNAUTHORIZED", "音频代理签名无效");
    }
    const { source, expires, signature } = parsed.data;
    const expected = signatureFor(config.jwtAccessSecret, source, expires);
    if (
      expires < Math.floor(Date.now() / 1_000) ||
      !signaturesMatch(expected, signature)
    ) {
      throw new AppError(
        401,
        "MEDIA_PROXY_UNAUTHORIZED",
        "音频代理签名已过期或无效",
      );
    }

    const media = await resolveMedia(source);
    let upstream: globalThis.Response | undefined;
    let lastError = "未知网络错误";
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        upstream = await fetch(media.url, {
          method: request.method === "HEAD" ? "HEAD" : "GET",
          headers: {
            ...(request.headers.range ? { Range: request.headers.range } : {}),
            Referer: "https://www.bilibili.com/",
            "User-Agent":
              "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 " +
              "(KHTML, like Gecko) Chrome/131.0 Safari/537.36",
          },
          redirect: "follow",
          signal: AbortSignal.timeout(60_000),
        });
        if (
          upstream.ok ||
          upstream.status === 206 ||
          (upstream.status < 500 && upstream.status !== 429)
        ) {
          break;
        }
        lastError = `HTTP ${upstream.status}`;
      } catch (error: unknown) {
        lastError = error instanceof Error ? error.message : "未知网络错误";
      }
      upstream = undefined;
      if (attempt < 3) {
        await new Promise((resolvePromise) =>
          setTimeout(resolvePromise, 500 * 2 ** (attempt - 1)),
        );
      }
    }
    if (!upstream) {
      throw new AppError(
        502,
        "MEDIA_PROXY_UPSTREAM_FAILED",
        `连接 B站音频流失败：${lastError}`,
      );
    }
    if (!upstream.ok && upstream.status !== 206) {
      throw new AppError(
        502,
        "MEDIA_PROXY_UPSTREAM_FAILED",
        `B站音频流返回 HTTP ${upstream.status}`,
      );
    }
    for (const name of [
      "accept-ranges",
      "content-length",
      "content-range",
      "content-type",
      "etag",
      "last-modified",
    ]) {
      const value = upstream.headers.get(name);
      if (value) response.setHeader(name, value);
    }
    response.status(upstream.status);
    if (request.method === "HEAD" || !upstream.body) {
      response.end();
      return;
    }
    await pipeline(
      Readable.fromWeb(upstream.body as import("node:stream/web").ReadableStream),
      response,
    );
  };

  router.get("/asr-media/bilibili", handle);
  router.head("/asr-media/bilibili", handle);
  return router;
}
