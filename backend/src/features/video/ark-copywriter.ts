import { z } from "zod";
import type { AppConfig } from "../../config.js";
import { AppError } from "../../shared/errors/app-error.js";
import {
  ArkResponseClient,
  type ArkClient,
} from "./ark-response.client.js";
import type {
  Copywriter,
  CopywritingResult,
  ProgressReporter,
  TranscriptResult,
} from "./video.types.js";

const resultSchema = z.object({
  oneSentenceSummary: z.string().min(1),
  whyWorthWatching: z.string().min(1),
  keyPoints: z.array(z.string()).min(1).max(7),
  chapters: z.array(
    z.object({
      title: z.string().min(1),
      startMs: z.number().nonnegative(),
      endMs: z.number().nonnegative(),
      summary: z.string().min(1),
    }),
  ),
  actionItems: z.array(z.string()).max(10),
  tags: z.array(z.string()).min(1).max(3),
  markdown: z.string().min(1),
});

function extractJson(value: string): unknown {
  const withoutFence = value
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();
  const firstBrace = withoutFence.indexOf("{");
  const lastBrace = withoutFence.lastIndexOf("}");
  return JSON.parse(
    firstBrace >= 0 && lastBrace > firstBrace
      ? withoutFence.slice(firstBrace, lastBrace + 1)
      : withoutFence,
  );
}

function timedTranscriptForSummary(transcript: TranscriptResult): string {
  if (transcript.segments.length === 0) return transcript.text;
  const windowMs = 5 * 60 * 1_000;
  const windows = new Map<
    number,
    { startMs: number; endMs: number; texts: string[] }
  >();
  for (const segment of transcript.segments) {
    const key = Math.floor(segment.startMs / windowMs);
    const existing = windows.get(key) ?? {
      startMs: segment.startMs,
      endMs: segment.endMs,
      texts: [],
    };
    existing.startMs = Math.min(existing.startMs, segment.startMs);
    existing.endMs = Math.max(existing.endMs, segment.endMs);
    existing.texts.push(segment.text);
    windows.set(key, existing);
  }
  return [...windows.entries()]
    .sort(([left], [right]) => left - right)
    .map(
      ([, window]) =>
        `[${Math.round(window.startMs)}-${Math.round(window.endMs)}] ${window.texts.join(" ")}`,
    )
    .join("\n");
}

export class ArkCopywriter implements Copywriter {
  private readonly client: ArkClient;

  constructor(
    private readonly config: AppConfig,
    client?: ArkClient,
  ) {
    this.client = client ?? new ArkResponseClient(config);
  }

  async generate(
    transcript: TranscriptResult,
    report: ProgressReporter,
  ): Promise<CopywritingResult> {
    const timedTranscript = timedTranscriptForSummary(transcript);

    await report("copywriting.ark.started", "已向火山方舟发起总结请求", {
      model: this.config.arkSummaryModel,
      characters: transcript.text.length,
      promptCharacters: timedTranscript.length,
    });
    const request = {
      model: this.config.arkSummaryModel,
      max_output_tokens: 8_192,
      instructions:
        "你是内容总结编辑。只能根据用户提供的转录生成结果，不得编造。只输出一个合法 JSON 对象，不要代码围栏、思考过程或额外说明。",
      input: [
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: [
                `标题：${transcript.title}`,
                "输出 JSON 字段：oneSentenceSummary、whyWorthWatching、keyPoints（3-7条字符串）、chapters（对象数组，每项 title/startMs/endMs/summary）、actionItems（字符串数组）、tags（1-3个字符串）、markdown（完整 Markdown）。",
                "章节时间必须来自转录行首的毫秒区间；没有时间戳时 chapters 返回空数组。",
                "带时间戳转录：",
                timedTranscript.slice(0, 900_000),
              ].join("\n"),
            },
          ],
        },
      ],
    };
    let response: Awaited<ReturnType<ArkClient["create"]>> | undefined;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        response = await this.client.create(request);
        break;
      } catch (error: unknown) {
        const retryable =
          error instanceof AppError && error.code === "ARK_NETWORK_ERROR";
        if (!retryable || attempt === 3) throw error;
        await report(
          "copywriting.ark.retrying",
          "火山方舟总结连接失败，正在自动重试",
          { attempt, nextAttempt: attempt + 1 },
        );
        if (this.config.nodeEnv !== "test") {
          await new Promise((resolvePromise) =>
            setTimeout(resolvePromise, attempt * 1_000),
          );
        }
      }
    }
    if (!response) {
      throw new AppError(
        502,
        "ARK_NETWORK_ERROR",
        "火山方舟总结重试后仍未返回结果",
      );
    }

    let parsedJson: unknown;
    try {
      parsedJson = extractJson(response.text);
    } catch {
      throw new AppError(
        502,
        "ARK_SUMMARY_JSON_INVALID",
        "火山方舟没有返回合法 JSON 总结",
      );
    }
    const parsed = resultSchema.safeParse(parsedJson);
    if (!parsed.success) {
      throw new AppError(
        502,
        "ARK_SUMMARY_SCHEMA_INVALID",
        "火山方舟返回的总结结构不符合契约",
        parsed.error.issues,
      );
    }

    await report("copywriting.ark.completed", "火山方舟总结生成完成", {
      model: this.config.arkSummaryModel,
      responseId: response.id,
      ...response.usage,
    });
    return {
      ...parsed.data,
      provider: "volcengine-ark-responses",
      model: this.config.arkSummaryModel,
    };
  }
}
