import type { AppConfig } from "../../config.js";
import { AppError } from "../../shared/errors/app-error.js";
import { readFile } from "node:fs/promises";
import { basename } from "node:path";

type ArkResponsePayload = {
  id?: string;
  output?: Array<{
    type?: string;
    content?: Array<{
      type?: string;
      text?: string;
    }>;
  }>;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    total_tokens?: number;
    input_tokens_details?: {
      audio_tokens?: number;
    };
  };
  error?: {
    code?: string;
    message?: string;
    type?: string;
  };
};

export type ArkResponseResult = {
  id: string;
  text: string;
  usage: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    audioTokens: number;
  };
};

export interface ArkClient {
  create(body: Record<string, unknown>): Promise<ArkResponseResult>;
  uploadFile(path: string, mimeType: string): Promise<string>;
  deleteFile(fileId: string): Promise<void>;
}

type ArkFilePayload = {
  id?: string;
  error?: {
    code?: string;
    message?: string;
  };
};

function outputText(payload: ArkResponsePayload): string {
  return (payload.output ?? [])
    .flatMap((item) => item.content ?? [])
    .filter((item) => item.type === "output_text" || typeof item.text === "string")
    .map((item) => item.text ?? "")
    .join("")
    .trim();
}

function arkErrorCode(payload: ArkResponsePayload): string {
  const code = payload.error?.code;
  if (code === "ModelNotOpen") return "ARK_MODEL_NOT_OPEN";
  if (code === "AuthenticationError" || code === "InvalidAuthentication") {
    return "ARK_AUTHENTICATION_FAILED";
  }
  return "ARK_REQUEST_FAILED";
}

export class ArkResponseClient implements ArkClient {
  constructor(private readonly config: AppConfig) {}

  private apiKey(): string {
    if (!this.config.arkApiKey) {
      throw new AppError(
        503,
        "ARK_API_KEY_MISSING",
        "已选择火山方舟服务，但未配置 ARK_API_KEY",
      );
    }
    return this.config.arkApiKey;
  }

  async uploadFile(path: string, mimeType: string): Promise<string> {
    const apiKey = this.apiKey();
    const form = new FormData();
    form.append("purpose", "user_data");
    form.append(
      "file",
      new Blob([await readFile(path)], { type: mimeType }),
      basename(path),
    );

    let response: Response;
    try {
      response = await fetch(
        `${this.config.arkApiBase.replace(/\/$/, "")}/files`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${apiKey}` },
          body: form,
          signal: AbortSignal.timeout(this.config.arkRequestTimeoutMs),
        },
      );
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "未知网络错误";
      throw new AppError(
        502,
        "ARK_FILE_UPLOAD_NETWORK_ERROR",
        `上传音频到火山方舟失败：${message}`,
      );
    }
    const payload = (await response.json().catch(() => ({}))) as ArkFilePayload;
    if (!response.ok || payload.error || !payload.id) {
      throw new AppError(
        response.status === 401 ? 401 : 502,
        "ARK_FILE_UPLOAD_FAILED",
        payload.error?.message ?? `火山方舟文件上传返回 HTTP ${response.status}`,
      );
    }
    return payload.id;
  }

  async deleteFile(fileId: string): Promise<void> {
    await fetch(
      `${this.config.arkApiBase.replace(/\/$/, "")}/files/${encodeURIComponent(fileId)}`,
      {
        method: "DELETE",
        headers: { Authorization: `Bearer ${this.apiKey()}` },
        signal: AbortSignal.timeout(Math.min(this.config.arkRequestTimeoutMs, 30_000)),
      },
    ).catch(() => undefined);
  }

  async create(body: Record<string, unknown>): Promise<ArkResponseResult> {
    const apiKey = this.apiKey();
    let response: Response;
    try {
      response = await fetch(
        `${this.config.arkApiBase.replace(/\/$/, "")}/responses`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(this.config.arkRequestTimeoutMs),
        },
      );
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "未知网络错误";
      throw new AppError(
        502,
        "ARK_NETWORK_ERROR",
        `连接火山方舟失败：${message}`,
      );
    }

    const payload = (await response.json().catch(() => ({}))) as ArkResponsePayload;
    if (!response.ok || payload.error) {
      throw new AppError(
        response.status === 401 ? 401 : 502,
        arkErrorCode(payload),
        payload.error?.message ?? `火山方舟返回 HTTP ${response.status}`,
      );
    }

    const text = outputText(payload);
    if (!text) {
      throw new AppError(
        502,
        "ARK_EMPTY_RESPONSE",
        "火山方舟没有返回可用文本",
      );
    }

    return {
      id: payload.id ?? "unknown",
      text,
      usage: {
        inputTokens: payload.usage?.input_tokens ?? 0,
        outputTokens: payload.usage?.output_tokens ?? 0,
        totalTokens: payload.usage?.total_tokens ?? 0,
        audioTokens: payload.usage?.input_tokens_details?.audio_tokens ?? 0,
      },
    };
  }
}
