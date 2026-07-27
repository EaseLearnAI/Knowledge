import { spawn } from "node:child_process";
import { resolve } from "node:path";
import type { AppConfig } from "../../config.js";
import { AppError } from "../../shared/errors/app-error.js";

type HelperResult = {
  ok?: boolean;
  url?: string;
  error?: string;
};

export type TosHelperRunner = (args: string[]) => Promise<HelperResult>;

export interface TemporaryObjectStore {
  uploadAndSign(localPath: string, objectKey: string): Promise<string>;
  delete(objectKey: string): Promise<void>;
}

export class TosTemporaryObjectStore implements TemporaryObjectStore {
  constructor(
    private readonly config: AppConfig,
    private readonly helperPath = resolve("scripts/tos-object-store.py"),
    private readonly helperRunner?: TosHelperRunner,
  ) {}

  async uploadAndSign(localPath: string, objectKey: string): Promise<string> {
    const bucket = this.bucket();
    await this.run([
      "upload",
      "--bucket",
      bucket,
      "--key",
      objectKey,
      "--file",
      localPath,
    ]);
    try {
      const result = await this.run([
        "presign",
        "--bucket",
        bucket,
        "--key",
        objectKey,
        "--expires",
        String(this.config.tosSignedUrlTtlSeconds),
      ]);
      if (!result.url) {
        throw new AppError(
          502,
          "TOS_PRESIGN_FAILED",
          "TOS 已上传音频，但没有返回预签名地址",
        );
      }
      return result.url;
    } catch (error) {
      await this.delete(objectKey).catch(() => undefined);
      throw error;
    }
  }

  async delete(objectKey: string): Promise<void> {
    await this.run([
      "delete",
      "--bucket",
      this.bucket(),
      "--key",
      objectKey,
    ]);
  }

  private bucket(): string {
    if (!this.config.tosEnabled || !this.config.tosTempBucket) {
      throw new AppError(
        503,
        "TOS_NOT_CONFIGURED",
        "尚未配置火山 TOS 临时音频桶",
      );
    }
    return this.config.tosTempBucket;
  }

  private run(args: string[]): Promise<HelperResult> {
    if (this.helperRunner) return this.helperRunner(args);
    return new Promise((resolvePromise, reject) => {
      const child = spawn(
        this.config.tosHelperPython,
        [this.helperPath, ...args],
        {
          cwd: process.cwd(),
          env: {
            ...process.env,
            ...(this.config.tosAccessKey
              ? { TOS_ACCESS_KEY: this.config.tosAccessKey }
              : {}),
            ...(this.config.tosSecretKey
              ? { TOS_SECRET_KEY: this.config.tosSecretKey }
              : {}),
            TOS_REGION: this.config.tosRegion,
            TOS_ENDPOINT: this.config.tosEndpoint,
            PYTHONUNBUFFERED: "1",
          },
          shell: false,
        },
      );
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (chunk: Buffer) => {
        stdout += chunk.toString("utf8");
      });
      child.stderr.on("data", (chunk: Buffer) => {
        stderr += chunk.toString("utf8");
      });
      child.on("error", (error) => {
        reject(new AppError(503, "TOS_HELPER_UNAVAILABLE", error.message));
      });
      child.on("close", (code) => {
        const lastJson = `${stdout}\n${stderr}`
          .split(/[\r\n]+/)
          .map((line) => line.trim())
          .filter((line) => line.startsWith("{") && line.endsWith("}"))
          .at(-1);
        let result: HelperResult = {};
        try {
          result = JSON.parse(lastJson ?? "{}") as HelperResult;
        } catch {
          // Use the safe generic error below. Never include credentials.
        }
        if (code === 0 && result.ok) {
          resolvePromise(result);
          return;
        }
        reject(
          new AppError(
            502,
            "TOS_OPERATION_FAILED",
            result.error ?? `TOS 辅助进程退出码 ${code ?? "unknown"}`,
          ),
        );
      });
    });
  }
}
