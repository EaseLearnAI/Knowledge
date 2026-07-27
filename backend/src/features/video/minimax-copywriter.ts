import { z } from "zod";
import type { AppConfig } from "../../config.js";
import { AppError } from "../../shared/errors/app-error.js";
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
      title: z.string(),
      startMs: z.number().nonnegative(),
      endMs: z.number().nonnegative(),
      summary: z.string(),
    }),
  ),
  actionItems: z.array(z.string()).max(10),
  tags: z.array(z.string()).min(1).max(3),
  markdown: z.string().min(1),
});

type MiniMaxResponse = {
  choices?: Array<{
    message?: {
      content?: string;
      reasoning_content?: string;
    };
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
  base_resp?: { status_code?: number; status_msg?: string };
  error?: { message?: string };
};

function extractJson(value: string): unknown {
  const withoutThinking = value.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
  const withoutFence = withoutThinking
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();
  const firstBrace = withoutFence.indexOf("{");
  const lastBrace = withoutFence.lastIndexOf("}");
  const jsonText =
    firstBrace >= 0 && lastBrace > firstBrace
      ? withoutFence.slice(firstBrace, lastBrace + 1)
      : withoutFence;
  return JSON.parse(jsonText);
}

export class MiniMaxCopywriter implements Copywriter {
  constructor(private readonly config: AppConfig) {}

  async generate(
    transcript: TranscriptResult,
    report: ProgressReporter,
  ): Promise<CopywritingResult> {
    if (!this.config.minimaxApiKey) {
      throw new AppError(
        503,
        "MINIMAX_API_KEY_MISSING",
        "已选择 MiniMax 文案服务，但未配置 MINIMAX_API_KEY",
      );
    }
    await report("copywriting.request.started", "已向 MiniMax 发起文案请求", {
      model: this.config.minimaxModel,
      characters: transcript.text.length,
    });
    const timedTranscript =
      transcript.segments.length > 0
        ? transcript.segments
            .map(
              (segment) =>
                `[${Math.round(segment.startMs)}-${Math.round(segment.endMs)}] ${segment.text}`,
            )
            .join("\n")
        : transcript.text;

    const response = await fetch(
      `${this.config.minimaxApiBase.replace(/\/$/, "")}/v1/chat/completions`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.config.minimaxApiKey}`,
        },
        body: JSON.stringify({
          model: this.config.minimaxModel,
          thinking: { type: "disabled" },
          max_completion_tokens: 12_000,
          temperature: 0.2,
          reasoning_split: true,
          messages: [
            {
              role: "system",
              content:
                "你是 Memo 的视频内容编辑。只能根据转录生成结果，不得编造。只输出一个合法 JSON 对象，不要 Markdown 代码围栏或额外说明。",
            },
            {
              role: "user",
              content: [
                `标题：${transcript.title}`,
                "请输出 JSON 字段：oneSentenceSummary、whyWorthWatching、keyPoints（3-7条字符串）、chapters（对象数组，每项 title/startMs/endMs/summary，时间为整数毫秒）、actionItems（字符串数组）、tags（1-3个字符串）、markdown（字符串）。",
                "章节时间必须来自转录行首的毫秒区间，不能编造超出视频范围的时间。",
                "带时间戳转录：",
                timedTranscript.slice(0, 900_000),
              ].join("\n"),
            },
          ],
        }),
        signal: AbortSignal.timeout(300_000),
      },
    );

    const payload = (await response.json()) as MiniMaxResponse;
    if (!response.ok || payload.base_resp?.status_code) {
      throw new AppError(
        502,
        "MINIMAX_REQUEST_FAILED",
        payload.error?.message ??
          payload.base_resp?.status_msg ??
          `MiniMax 返回 HTTP ${response.status}`,
      );
    }
    const text = payload.choices?.[0]?.message?.content;
    if (!text) {
      throw new AppError(502, "MINIMAX_EMPTY_RESPONSE", "MiniMax 未返回文案文本");
    }

    let json: unknown;
    try {
      json = extractJson(text);
    } catch {
      throw new AppError(502, "MINIMAX_JSON_INVALID", "MiniMax 未返回合法 JSON 文案");
    }
    const parsed = resultSchema.safeParse(json);
    if (!parsed.success) {
      await report("copywriting.response.invalid", "MiniMax 文案结构校验失败", {
        issues: parsed.error.issues.map((issue: { path: PropertyKey[]; message: string }) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      });
      throw new AppError(
        502,
        "MINIMAX_SCHEMA_INVALID",
        "MiniMax 返回的文案结构不符合契约",
        parsed.error.issues,
      );
    }
    await report("copywriting.request.completed", "MiniMax 文案请求成功", {
      inputTokens: payload.usage?.prompt_tokens ?? 0,
      outputTokens: payload.usage?.completion_tokens ?? 0,
      totalTokens: payload.usage?.total_tokens ?? 0,
    });
    return {
      ...parsed.data,
      provider: "minimax-openai-compatible",
      model: this.config.minimaxModel,
    };
  }
}
