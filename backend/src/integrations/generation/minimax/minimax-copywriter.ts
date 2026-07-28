import { z } from "zod";
import type { AppConfig } from "../../../platform/config/app-config.js";
import { AppError } from "../../../platform/http/errors/app-error.js";
import type {
  Copywriter,
  CopywritingResult,
  ProgressReporter,
  TranscriptResult,
} from "../../../modules/processing/domain/video.types.js";

function normalizeDisplayTitle(value: string): string {
  const withoutTags = value
    .replace(/#[^\s#]+/gu, " ")
    .replace(/\s+/gu, " ")
    .replace(/^(?:该视频|本视频|视频中|作者(?:分享|讲述|介绍)了?)[：:\s]*/u, "")
    .trim();
  const firstClause = withoutTags.split(/[。！？\n]/u)[0]?.trim() ?? "";
  const candidate = firstClause.length >= 6 ? firstClause : withoutTags;
  return Array.from(candidate).slice(0, 28).join("");
}

const resultSchema = z.object({
  displayTitle: z.string().trim().min(1).optional(),
  oneSentenceSummary: z.string().min(1),
  whyWorthWatching: z.string().min(1),
  keyPoints: z
    .array(z.string().min(1))
    .min(1)
    .transform((items) => items.slice(0, 5)),
  chapters: z
    .array(
      z.object({
        title: z.string().min(1),
        startMs: z.coerce.number().nonnegative(),
        endMs: z.coerce.number().nonnegative(),
        summary: z.string().min(1),
      }),
    )
    .default([])
    .transform((items) => items.slice(0, 8)),
  actionItems: z
    .array(z.string().min(1))
    .default([])
    .transform((items) => items.slice(0, 5)),
  tags: z
    .array(z.string().min(1))
    .min(1)
    .transform((items) => items.slice(0, 3)),
  markdown: z.string().min(1).optional(),
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
                "请输出 JSON 字段：displayTitle、oneSentenceSummary、whyWorthWatching、keyPoints、chapters、actionItems、tags、markdown。",
                "displayTitle 用 12-24 个中文字符直接写核心主题或关键结论；不要保留作者自述、平台话术、Emoji、#话题、问候语或整段原标题，不要使用“该视频/本期内容”。",
                "oneSentenceSummary 用 45-90 字讲清对象、方法和结论；whyWorthWatching 用 20-50 字说明用户能获得什么。",
                "keyPoints 输出 3-5 条互不重复的具体事实或方法；actionItems 最多 5 条；tags 输出 2-3 个 2-8 字的具体主题词，禁止使用“视频、内容、分享、干货、知识”等泛词。",
                "chapters 最多 8 项，每项包含 title/startMs/endMs/summary，时间为整数毫秒；markdown 不超过 2000 个中文字，结构清楚且不要复述标签。",
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
    const displayTitle = normalizeDisplayTitle(
      parsed.data.displayTitle ?? parsed.data.oneSentenceSummary,
    );
    const markdown =
      parsed.data.markdown?.trim() ||
      [
        `# ${displayTitle}`,
        "",
        parsed.data.whyWorthWatching,
        "",
        "## 核心要点",
        ...parsed.data.keyPoints.map((item) => `- ${item}`),
      ].join("\n");
    return {
      ...parsed.data,
      displayTitle,
      markdown,
      provider: "minimax-openai-compatible",
      model: this.config.minimaxModel,
    };
  }
}
