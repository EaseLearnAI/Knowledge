import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { z } from "zod";
import type { AppConfig } from "../../config.js";
import { AppError } from "../../shared/errors/app-error.js";
import type {
  ProgressReporter,
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
});

type ResolvedMedia = z.infer<typeof resolvedMediaSchema>;

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
    if (!this.config.volcAsrAppId || !this.config.volcAsrAccessToken) {
      throw new AppError(
        503,
        "VOLC_ASR_CREDENTIALS_MISSING",
        "已选择火山录音识别，但未配置 VOLC_ASR_APP_ID 和 VOLC_ASR_ACCESS_TOKEN",
      );
    }

    const requestId = randomUUID();
    const base = this.config.volcAsrApiBase.replace(/\/$/, "");
    const headers = {
      "Content-Type": "application/json",
      "X-Api-App-Key": this.config.volcAsrAppId,
      "X-Api-Access-Key": this.config.volcAsrAccessToken,
      "X-Api-Resource-Id": this.config.volcAsrResourceId,
      "X-Api-Request-Id": requestId,
    };
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

  private async request(
    url: string,
    headers: Record<string, string>,
    body?: Record<string, unknown>,
  ): Promise<{ response: Response; payload: VolcPayload }> {
    let response: Response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers,
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(Math.min(this.config.volcAsrTimeoutMs, 60_000)),
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "未知网络错误";
      throw new AppError(
        502,
        "VOLC_ASR_NETWORK_ERROR",
        `连接火山录音识别失败：${message}`,
      );
    }
    const payload = (await response.json().catch(() => ({}))) as VolcPayload;
    const headerMessage = response.headers.get("x-api-message");
    if (headerMessage && !payload.status_message && !payload.message) {
      payload.status_message = headerMessage;
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
    const binDirectory = dirname(this.config.videoSummarizeBin);
    const python = [
      join(binDirectory, "python3.12"),
      join(binDirectory, "python3"),
      join(binDirectory, "python"),
    ].find(existsSync);
    if (!python) {
      throw new AppError(
        503,
        "VIDEO_RESOLVER_UNAVAILABLE",
        "找不到 videosummarize 虚拟环境中的 Python",
      );
    }
    await report("media.resolve.started", "开始解析社交平台音频地址");
    const output = await this.run(python, [
      resolve("scripts/resolve-cloud-media.py"),
      "--source",
      input.source,
    ]);
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
}

export class VolcAsrVideoProcessor implements VideoProcessor {
  private readonly client: VolcAsrClientLike;
  private readonly resolver: CloudMediaResolver;

  constructor(
    private readonly config: AppConfig,
    dependencies: {
      client?: VolcAsrClientLike;
      resolver?: CloudMediaResolver;
    } = {},
  ) {
    this.client = dependencies.client ?? new VolcAsrClient(config);
    this.resolver = dependencies.resolver ?? new PythonCloudMediaResolver(config);
  }

  async process(
    input: VideoProcessInput,
    report: ProgressReporter,
  ): Promise<TranscriptResult> {
    const media = await this.resolver.resolve(input, report);
    const result = await this.client.transcribe(media, report);
    await report("transcription.volc.completed", "火山录音识别转写完成", {
      requestId: result.requestId,
      characters: result.text.length,
      segments: result.segments.length,
    });
    return {
      title: input.titleHint?.trim() || media.title,
      source: input.source,
      transcriptPath: `volc-asr://${result.requestId}`,
      text: result.text,
      segments: result.segments,
      provider: "volcengine-bigasr",
    };
  }
}
