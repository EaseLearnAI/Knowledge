import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";
import type { AppConfig } from "../../config.js";
import { AppError } from "../../shared/errors/app-error.js";
import { buildSignedBilibiliMediaUrl } from "./bilibili-media-proxy.js";
import { MediaMaterializer } from "./media-materializer.js";
import {
  TosTemporaryObjectStore,
  type TemporaryObjectStore,
} from "./tos-object-store.js";
import type {
  ProgressReporter,
  ResolvedContent,
  TranscriptResult,
  TranscriptSegment,
  VideoProcessInput,
  VideoProcessor,
} from "./video.types.js";

const resolvedMediaSchema = z.object({
  url: z.string().url(),
  title: z.string().min(1),
  durationSeconds: z.number().nonnegative(),
  format: z.string().min(1),
  headers: z.record(z.string(), z.string()).optional(),
});

export type ResolvedMedia = z.infer<typeof resolvedMediaSchema>;

const bilibiliViewSchema = z.object({
  code: z.number(),
  message: z.string().optional(),
  data: z.object({
    cid: z.number().optional(),
    title: z.string().min(1),
    desc: z.string().optional(),
    duration: z.number().nonnegative(),
    pages: z.array(z.object({ cid: z.number() })).optional(),
  }),
});

const bilibiliPlaySchema = z.object({
  code: z.number(),
  message: z.string().optional(),
  data: z.object({
    dash: z.object({
      duration: z.number().nonnegative().optional(),
      video: z
        .array(
          z.object({
            bandwidth: z.number().int().nonnegative().optional(),
            baseUrl: z.string().url().optional(),
            base_url: z.string().url().optional(),
          }),
        )
        .optional(),
      audio: z.array(
        z.object({
          bandwidth: z.number().int().nonnegative().optional(),
          baseUrl: z.string().url().optional(),
          base_url: z.string().url().optional(),
        }),
      ),
    }),
  }),
});

const BILIBILI_BVID_PATTERN = /(BV[0-9A-Za-z]{10})/i;
const BILIBILI_USER_AGENT =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/131.0 Safari/537.36";

async function fetchBilibiliJson(
  url: URL,
  referer: string,
  attempts = 3,
): Promise<unknown> {
  let lastError = "未知网络错误";
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: {
          Accept: "application/json",
          Referer: referer,
          "User-Agent": BILIBILI_USER_AGENT,
        },
        signal: AbortSignal.timeout(30_000),
      });
      if (response.ok) return await response.json();
      lastError = `HTTP ${response.status}`;
      if (response.status < 500 && response.status !== 429) break;
    } catch (error: unknown) {
      lastError = error instanceof Error ? error.message : "未知网络错误";
    }
    if (attempt < attempts) {
      await new Promise((resolvePromise) =>
        setTimeout(resolvePromise, 500 * 2 ** (attempt - 1)),
      );
    }
  }
  throw new AppError(
    502,
    "BILIBILI_RESOLVE_FAILED",
    `B站公开接口请求失败：${lastError}`,
  );
}

export async function resolvePublicBilibiliMedia(
  source: string,
): Promise<ResolvedMedia> {
  let bvid = BILIBILI_BVID_PATTERN.exec(source)?.[1];
  if (!bvid && /b23\.tv/i.test(source)) {
    try {
      const response = await fetch(source, {
        headers: { "User-Agent": BILIBILI_USER_AGENT },
        redirect: "follow",
        signal: AbortSignal.timeout(30_000),
      });
      bvid = BILIBILI_BVID_PATTERN.exec(response.url)?.[1];
      await response.body?.cancel();
    } catch {
      // Fall through to the same user-facing invalid-link error.
    }
  }
  if (!bvid) {
    throw new AppError(
      422,
      "BILIBILI_URL_INVALID",
      "无法从 B站链接中识别 BV 号",
    );
  }
  const referer = `https://www.bilibili.com/video/${bvid}/`;
  const viewUrl = new URL("https://api.bilibili.com/x/web-interface/view");
  viewUrl.searchParams.set("bvid", bvid);
  const view = bilibiliViewSchema.safeParse(
    await fetchBilibiliJson(viewUrl, referer),
  );
  if (!view.success || view.data.code !== 0) {
    throw new AppError(
      502,
      "BILIBILI_RESOLVE_FAILED",
      view.success
        ? `B站公开接口返回错误：${view.data.message ?? view.data.code}`
        : "B站视频详情返回格式异常",
    );
  }
  const cid = view.data.data.cid ?? view.data.data.pages?.[0]?.cid;
  if (!cid) {
    throw new AppError(
      502,
      "BILIBILI_RESOLVE_FAILED",
      "B站视频详情缺少 cid",
    );
  }
  if (view.data.data.duration >= 18_000) {
    throw new AppError(
      422,
      "MEDIA_DURATION_EXCEEDED",
      "B站视频达到或超过 5 小时，超出火山录音文件识别限制",
    );
  }

  const playUrl = new URL("https://api.bilibili.com/x/player/playurl");
  playUrl.searchParams.set("bvid", bvid);
  playUrl.searchParams.set("cid", String(cid));
  playUrl.searchParams.set("fnval", "16");
  playUrl.searchParams.set("qn", "16");
  const play = bilibiliPlaySchema.safeParse(
    await fetchBilibiliJson(playUrl, referer),
  );
  if (!play.success || play.data.code !== 0) {
    throw new AppError(
      502,
      "BILIBILI_RESOLVE_FAILED",
      play.success
        ? `B站播放器接口返回错误：${play.data.message ?? play.data.code}`
        : "B站播放器接口返回格式异常",
    );
  }
  const candidates = play.data.data.dash.audio
    .map((audio) => ({
      url: audio.baseUrl ?? audio.base_url,
      bandwidth: audio.bandwidth ?? Number.MAX_SAFE_INTEGER,
    }))
    .filter(
      (audio): audio is { url: string; bandwidth: number } =>
        typeof audio.url === "string",
    )
    .sort((left, right) => left.bandwidth - right.bandwidth);
  const audio = candidates[0];
  if (!audio) {
    throw new AppError(
      502,
      "BILIBILI_RESOLVE_FAILED",
      "B站公开视频没有可用的 DASH 音频流",
    );
  }
  return {
    url: audio.url,
    title: view.data.data.title,
    durationSeconds: view.data.data.duration,
    format: "m4a",
    headers: {
      Referer: referer,
      "User-Agent": BILIBILI_USER_AGENT,
    },
  };
}

export async function resolvePublicBilibiliContent(
  source: string,
): Promise<ResolvedContent> {
  let bvid = BILIBILI_BVID_PATTERN.exec(source)?.[1];
  if (!bvid && /b23\.tv/i.test(source)) {
    try {
      const response = await fetch(source, {
        headers: { "User-Agent": BILIBILI_USER_AGENT },
        redirect: "follow",
        signal: AbortSignal.timeout(30_000),
      });
      bvid = BILIBILI_BVID_PATTERN.exec(response.url)?.[1];
      await response.body?.cancel();
    } catch {
      // The validation error below is more useful than the redirect failure.
    }
  }
  if (!bvid) {
    throw new AppError(422, "BILIBILI_URL_INVALID", "无法从 B站链接中识别 BV 号");
  }
  const referer = `https://www.bilibili.com/video/${bvid}/`;
  const viewUrl = new URL("https://api.bilibili.com/x/web-interface/view");
  viewUrl.searchParams.set("bvid", bvid);
  const view = bilibiliViewSchema.safeParse(
    await fetchBilibiliJson(viewUrl, referer),
  );
  if (!view.success || view.data.code !== 0) {
    throw new AppError(
      502,
      "BILIBILI_RESOLVE_FAILED",
      view.success
        ? `B站公开接口返回错误：${view.data.message ?? view.data.code}`
        : "B站视频详情返回格式异常",
    );
  }
  const cid = view.data.data.cid ?? view.data.data.pages?.[0]?.cid;
  if (!cid) {
    throw new AppError(502, "BILIBILI_RESOLVE_FAILED", "B站视频详情缺少 cid");
  }
  const playUrl = new URL("https://api.bilibili.com/x/player/playurl");
  playUrl.searchParams.set("bvid", bvid);
  playUrl.searchParams.set("cid", String(cid));
  playUrl.searchParams.set("fnval", "16");
  playUrl.searchParams.set("qn", "16");
  const play = bilibiliPlaySchema.safeParse(
    await fetchBilibiliJson(playUrl, referer),
  );
  if (!play.success || play.data.code !== 0) {
    throw new AppError(
      502,
      "BILIBILI_RESOLVE_FAILED",
      play.success
        ? `B站播放器接口返回错误：${play.data.message ?? play.data.code}`
        : "B站播放器接口返回格式异常",
    );
  }
  const pickLowestBandwidth = (
    values:
      | Array<{
          bandwidth?: number | undefined;
          baseUrl?: string | undefined;
          base_url?: string | undefined;
        }>
      | undefined,
  ) =>
    values
      ?.map((value) => ({
        url: value.baseUrl ?? value.base_url,
        bandwidth: value.bandwidth ?? Number.MAX_SAFE_INTEGER,
      }))
      .filter(
        (value): value is { url: string; bandwidth: number } =>
          typeof value.url === "string",
      )
      .sort((left, right) => left.bandwidth - right.bandwidth)[0]?.url;
  const videoUrl = pickLowestBandwidth(play.data.data.dash.video);
  const audioUrl = pickLowestBandwidth(play.data.data.dash.audio);
  if (!videoUrl || !audioUrl) {
    throw new AppError(
      502,
      "BILIBILI_RESOLVE_FAILED",
      "B站公开视频没有可用的 DASH 音视频流",
    );
  }
  const headers = {
    Referer: referer,
    "User-Agent": BILIBILI_USER_AGENT,
  };
  const durationSeconds = view.data.data.duration;
  return {
    kind: durationSeconds <= 180 ? "short_video" : "long_video",
    platform: "bilibili",
    title: view.data.data.title,
    text: view.data.data.desc?.trim() ?? "",
    durationSeconds,
    assets: [
      { kind: "video", url: videoUrl, format: "mp4", headers },
      { kind: "audio", url: audioUrl, format: "m4a", headers },
    ],
  };
}

type VolcPayload = {
  code?: number | string;
  message?: string;
  status_code?: number | string;
  status_message?: string;
  result?: {
    text?: string;
    utterances?: Array<{
      start_time?: number;
      end_time?: number;
      startTime?: number;
      endTime?: number;
      text?: string;
    }>;
  };
};

export type VolcAsrResult = {
  requestId: string;
  text: string;
  segments: TranscriptSegment[];
};

export interface VolcAsrClientLike {
  transcribe(
    media: ResolvedMedia,
    report: ProgressReporter,
  ): Promise<VolcAsrResult>;
  resume?(
    requestId: string,
    report: ProgressReporter,
  ): Promise<VolcAsrResult>;
}

export interface CloudMediaResolver {
  resolve(input: VideoProcessInput, report: ProgressReporter): Promise<ResolvedMedia>;
}

function headerCode(response: Response, payload: VolcPayload): string {
  return String(
    response.headers.get("x-api-status-code") ??
      payload.status_code ??
      payload.code ??
      (response.ok ? "20000000" : response.status),
  );
}

function errorMessage(code: string, payload: VolcPayload): string {
  const providerMessage =
    payload.status_message ?? payload.message ?? `火山录音识别返回状态 ${code}`;
  if (code === "45000030") {
    return `当前账号未开通配置的 ASR 资源：${providerMessage}`;
  }
  return providerMessage;
}

export class VolcAsrClient implements VolcAsrClientLike {
  constructor(private readonly config: AppConfig) {}

  async transcribe(
    media: ResolvedMedia,
    report: ProgressReporter,
  ): Promise<VolcAsrResult> {
    const requestId = randomUUID();
    const base = this.config.volcAsrApiBase.replace(/\/$/, "");
    const headers = this.headers(requestId);
    const submit = await this.request(
      `${base}/submit`,
      {
        ...headers,
        "X-Api-Sequence": "-1",
      },
      {
        user: { uid: requestId },
        audio: {
          url: media.url,
          format: media.format,
        },
        request: {
          model_name: "bigmodel",
          enable_itn: true,
          enable_punc: true,
          enable_ddc: true,
          show_utterances: true,
        },
      },
    );
    const submitCode = headerCode(submit.response, submit.payload);
    if (submitCode !== "20000000") {
      throw new AppError(
        502,
        "VOLC_ASR_SUBMIT_FAILED",
        errorMessage(submitCode, submit.payload),
      );
    }
    await report("transcription.volc.submitted", "火山录音识别任务已提交", {
      requestId,
      resourceId: this.config.volcAsrResourceId,
      durationSeconds: Math.round(media.durationSeconds),
    });
    return await this.poll(base, headers, requestId);
  }

  async resume(
    requestId: string,
    report: ProgressReporter,
  ): Promise<VolcAsrResult> {
    const base = this.config.volcAsrApiBase.replace(/\/$/, "");
    const headers = this.headers(requestId);
    await report(
      "transcription.volc.resumed",
      "服务重启后继续查询原火山录音识别任务",
      { requestId, resourceId: this.config.volcAsrResourceId },
    );
    return await this.poll(base, headers, requestId);
  }

  private async poll(
    base: string,
    headers: Record<string, string>,
    requestId: string,
  ): Promise<VolcAsrResult> {
    const deadline = Date.now() + this.config.volcAsrTimeoutMs;
    while (Date.now() < deadline) {
      await new Promise((resolvePromise) =>
        setTimeout(resolvePromise, this.config.volcAsrPollIntervalMs),
      );
      // The query endpoint requires an empty JSON object rather than an empty
      // HTTP body, even though all task identifiers are carried in headers.
      const query = await this.request(`${base}/query`, headers, {});
      const queryCode = headerCode(query.response, query.payload);
      if (queryCode === "20000001" || queryCode === "20000002") {
        continue;
      }
      if (queryCode !== "20000000") {
        throw new AppError(
          502,
          "VOLC_ASR_QUERY_FAILED",
          errorMessage(queryCode, query.payload),
        );
      }
      const text = query.payload.result?.text?.trim() ?? "";
      if (!text) {
        throw new AppError(
          502,
          "VOLC_ASR_EMPTY_TRANSCRIPT",
          "火山录音识别完成，但没有返回转录文本",
        );
      }
      const segments = (query.payload.result?.utterances ?? [])
        .map((utterance) => ({
          startMs: Math.max(0, utterance.start_time ?? utterance.startTime ?? 0),
          endMs: Math.max(0, utterance.end_time ?? utterance.endTime ?? 0),
          text: utterance.text?.trim() ?? "",
        }))
        .filter((segment) => segment.text.length > 0);
      return { requestId, text, segments };
    }
    throw new AppError(
      504,
      "VOLC_ASR_TIMEOUT",
      `火山录音识别在 ${Math.round(this.config.volcAsrTimeoutMs / 1_000)} 秒内未完成`,
    );
  }

  private credentials(): { appId: string; accessToken: string } {
    const appId = this.config.volcAsrAppId;
    const accessToken = this.config.volcAsrAccessToken;
    if (!appId || !accessToken) {
      throw new AppError(
        503,
        "VOLC_ASR_CREDENTIALS_MISSING",
        "已选择火山录音识别，但未配置 VOLC_ASR_APP_ID 和 VOLC_ASR_ACCESS_TOKEN",
      );
    }
    return { appId, accessToken };
  }

  private headers(requestId: string): Record<string, string> {
    const { appId, accessToken } = this.credentials();
    return {
      "Content-Type": "application/json",
      "X-Api-App-Key": appId,
      "X-Api-Access-Key": accessToken,
      "X-Api-Resource-Id": this.config.volcAsrResourceId,
      "X-Api-Request-Id": requestId,
    };
  }

  private async request(
    url: string,
    headers: Record<string, string>,
    body?: Record<string, unknown>,
  ): Promise<{ response: Response; payload: VolcPayload }> {
    let lastNetworkError = "未知网络错误";
    for (let attempt = 1; attempt <= this.config.volcAsrMaxAttempts; attempt += 1) {
      let response: Response;
      try {
        response = await fetch(url, {
          method: "POST",
          headers,
          ...(body ? { body: JSON.stringify(body) } : {}),
          signal: AbortSignal.timeout(60_000),
        });
      } catch (error: unknown) {
        lastNetworkError =
          error instanceof Error ? error.message : "未知网络错误";
        if (attempt < this.config.volcAsrMaxAttempts) {
          await this.backoff(attempt);
          continue;
        }
        throw new AppError(
          502,
          "VOLC_ASR_NETWORK_ERROR",
          `连接火山录音识别失败：${lastNetworkError}`,
        );
      }
      const payload = (await response.json().catch(() => ({}))) as VolcPayload;
      const headerMessage = response.headers.get("x-api-message");
      if (headerMessage && !payload.status_message && !payload.message) {
        payload.status_message = headerMessage;
      }
      const code = headerCode(response, payload);
      const retryable =
        response.status === 429 ||
        response.status >= 500 ||
        code === "55000031" ||
        code.startsWith("55");
      if (retryable && attempt < this.config.volcAsrMaxAttempts) {
        await this.backoff(attempt);
        continue;
      }
      if (!response.ok && !response.headers.get("x-api-status-code")) {
        throw new AppError(
          response.status === 401 || response.status === 403 ? 401 : 502,
          "VOLC_ASR_REQUEST_FAILED",
          errorMessage(String(response.status), payload),
        );
      }
      return { response, payload };
    }
    throw new AppError(
      502,
      "VOLC_ASR_NETWORK_ERROR",
      `连接火山录音识别失败：${lastNetworkError}`,
    );
  }

  private async backoff(attempt: number): Promise<void> {
    await new Promise((resolvePromise) =>
      setTimeout(resolvePromise, Math.min(4_000, 500 * 2 ** (attempt - 1))),
    );
  }
}

export class PythonCloudMediaResolver implements CloudMediaResolver {
  constructor(private readonly config: AppConfig) {}

  async resolve(
    input: VideoProcessInput,
    report: ProgressReporter,
  ): Promise<ResolvedMedia> {
    if (existsSync(input.source)) {
      throw new AppError(
        422,
        "VOLC_ASR_PUBLIC_URL_REQUIRED",
        "火山录音识别模式暂不支持本地文件，请提交公开视频链接",
      );
    }
    if (/(?:bilibili\.com|b23\.tv)/i.test(input.source)) {
      await report(
        "media.resolve.started",
        "开始通过 B站公开播放器接口解析音频",
      );
      const media = await resolvePublicBilibiliMedia(input.source);
      const proxyUrl = this.config.tosEnabled
        ? undefined
        : buildSignedBilibiliMediaUrl(this.config, input.source);
      const resolved = proxyUrl ? { ...media, url: proxyUrl } : media;
      await report("media.resolve.completed", "B站公开音频地址解析完成", {
        title: resolved.title,
        durationSeconds: Math.round(resolved.durationSeconds),
        format: resolved.format,
        requiresPlatformLogin: false,
        delivery: proxyUrl ? "signed-server-proxy" : "direct-cdn",
      });
      return resolved;
    }
    await report("media.resolve.started", "开始解析社交平台音频地址");
    const output = await this.run(
      this.python(),
      [
        resolve("scripts/resolve-cloud-media.py"),
        "--source",
        input.source,
        ...(this.config.videoCookieBrowser
          ? ["--cookies-browser", this.config.videoCookieBrowser]
          : []),
        ...(this.config.videoCookieFile
          ? ["--cookies-file", this.config.videoCookieFile]
          : []),
      ],
    );
    const jsonLine = output
      .split(/[\r\n]+/)
      .map((line) => line.trim())
      .filter((line) => line.startsWith("{") && line.endsWith("}"))
      .at(-1);
    let parsed: unknown;
    try {
      parsed = JSON.parse(jsonLine ?? "");
    } catch {
      throw new AppError(
        502,
        "MEDIA_RESOLVE_OUTPUT_INVALID",
        "媒体链接解析器没有返回合法 JSON",
      );
    }
    const result = resolvedMediaSchema.safeParse(parsed);
    if (!result.success) {
      throw new AppError(
        502,
        "MEDIA_RESOLVE_SCHEMA_INVALID",
        "媒体链接解析结果不符合契约",
        result.error.issues,
      );
    }
    await report("media.resolve.completed", "社交平台音频地址解析完成", {
      title: result.data.title,
      durationSeconds: Math.round(result.data.durationSeconds),
      format: result.data.format,
    });
    return result.data;
  }

  private run(command: string, args: string[]): Promise<string> {
    return new Promise((resolvePromise, reject) => {
      const child = spawn(command, args, {
        cwd: process.cwd(),
        env: { ...process.env, PYTHONUNBUFFERED: "1" },
        shell: false,
      });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (chunk: Buffer) => {
        stdout += chunk.toString("utf8");
      });
      child.stderr.on("data", (chunk: Buffer) => {
        stderr += chunk.toString("utf8");
      });
      child.on("error", (error) => {
        reject(new AppError(503, "VIDEO_RESOLVER_UNAVAILABLE", error.message));
      });
      child.on("close", (code) => {
        if (code === 0) {
          resolvePromise(stdout);
          return;
        }
        reject(
          new AppError(
            502,
            /cookie|login|sign in/i.test(stderr)
              ? "MEDIA_LOGIN_REQUIRED"
              : "MEDIA_RESOLVE_FAILED",
            stderr.trim() || `媒体链接解析器退出码 ${code}`,
          ),
        );
      });
    });
  }

  private python(): string {
    const projectPython = resolve(".venv/bin/python");
    if (
      this.config.nodeEnv !== "production" &&
      this.config.videoResolverPython === "python3" &&
      existsSync(projectPython)
    ) {
      return projectPython;
    }
    return this.config.videoResolverPython;
  }
}

export class VolcAsrVideoProcessor implements VideoProcessor {
  private readonly client: VolcAsrClientLike;
  private readonly resolver: CloudMediaResolver;
  private readonly objectStore: TemporaryObjectStore | undefined;
  private readonly materializer: MediaMaterializer;

  constructor(
    private readonly config: AppConfig,
    dependencies: {
      client?: VolcAsrClientLike;
      resolver?: CloudMediaResolver;
      objectStore?: TemporaryObjectStore;
      materializer?: MediaMaterializer;
    } = {},
  ) {
    this.client = dependencies.client ?? new VolcAsrClient(config);
    this.resolver = dependencies.resolver ?? new PythonCloudMediaResolver(config);
    this.objectStore =
      dependencies.objectStore ??
      (config.tosEnabled ? new TosTemporaryObjectStore(config) : undefined);
    this.materializer = dependencies.materializer ?? new MediaMaterializer(config);
  }

  async process(
    input: VideoProcessInput,
    report: ProgressReporter,
  ): Promise<TranscriptResult> {
    let media: ResolvedMedia | undefined;
    let stagedObjectKey = input.stagedObjectKey;
    let providerSubmitted = Boolean(input.providerTaskId);
    const trackedReport: ProgressReporter = async (event, message, data) => {
      if (event === "transcription.volc.submitted") providerSubmitted = true;
      await report(event, message, data);
    };
    let result: VolcAsrResult;
    if (input.providerTaskId && this.client.resume) {
      result = await this.client.resume(input.providerTaskId, trackedReport);
    } else {
      media = await this.resolver.resolve(input, report);
      if (this.objectStore) {
        if (!input.taskId) {
          throw new AppError(
            500,
            "TASK_ID_REQUIRED",
            "服务端暂存音频时缺少任务 ID",
          );
        }
        await report("media.download.started", "开始将平台音频下载到云服务器临时目录");
        const staged = await this.materializer.download(input.taskId, media);
        await report("media.download.completed", "平台音频已下载到临时目录", {
          format: staged.format,
        });
        try {
          const signedUrl = await this.objectStore.uploadAndSign(
            staged.localPath,
            staged.objectKey,
          );
          await report("media.tos.uploaded", "临时音频已进入私有 TOS", {
            objectKey: staged.objectKey,
          });
          stagedObjectKey = staged.objectKey;
          media = {
            ...media,
            url: signedUrl,
            format: staged.format,
            headers: undefined,
          };
        } finally {
          await this.materializer.cleanup(staged.localPath);
        }
      }
      try {
        result = await this.client.transcribe(media, trackedReport);
      } catch (error) {
        if (stagedObjectKey && this.objectStore && !providerSubmitted) {
          try {
            await this.objectStore.delete(stagedObjectKey);
            await report(
              "media.tos.deleted",
              "ASR 提交失败，TOS 临时音频已回收",
              { objectKey: stagedObjectKey },
            );
          } catch {
            await report(
              "media.tos.cleanup_failed",
              "ASR 提交失败，TOS 临时音频等待生命周期规则清理",
              { objectKey: stagedObjectKey },
            );
          }
        }
        throw error;
      }
    }
    await report("transcription.volc.completed", "火山录音识别转写完成", {
      requestId: result.requestId,
      characters: result.text.length,
      segments: result.segments.length,
    });
    if (stagedObjectKey && this.objectStore) {
      await this.objectStore.delete(stagedObjectKey);
      await report("media.tos.deleted", "ASR 完成，TOS 临时音频已删除", {
        objectKey: stagedObjectKey,
      });
    }
    return {
      title: input.titleHint?.trim() || media?.title || "视频内容",
      source: input.source,
      transcriptPath: `volc-asr://${result.requestId}`,
      text: result.text,
      segments: result.segments,
      provider: "volcengine-bigasr",
    };
  }
}
