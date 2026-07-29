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
    .array(z.string().trim().min(2).max(8))
    .min(3)
    .transform((items) => items.slice(0, 3)),
  markdown: z.string().min(1).optional(),
});

type MiniMaxResponse = {
  choices?: Array<{
    finish_reason?: string;
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

    const payload = await this.request([
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
                "keyPoints 输出 3-5 条互不重复的具体事实或方法；actionItems 最多 5 条。",
                "tags 必须恰好 3 个且按顺序分别是：领域标签（如 AI、商业、创作）、主题标签（具体方法或议题）、对象或场景标签（产品、公司、平台或应用场景）；每个 2-8 字，禁止使用“视频、内容、分享、干货、知识”等泛词。",
                "chapters 最多 8 项，每项包含 title/startMs/endMs/summary，时间为整数毫秒；markdown 不超过 2000 个中文字，结构清楚且不要复述标签。",
                "章节时间必须来自转录行首的毫秒区间，不能编造超出视频范围的时间。",
                "带时间戳转录：",
                timedTranscript.slice(0, 900_000),
              ].join("\n"),
            },
          ]);
    const text = payload.choices?.[0]?.message?.content;
    if (!text) {
      throw new AppError(502, "MINIMAX_EMPTY_RESPONSE", "MiniMax 未返回文案文本");
    }

    let parsed = this.parse(text);
    let repairPayload: MiniMaxResponse | undefined;
    if (!parsed.success) {
      await report("copywriting.response.repairing", "MiniMax 返回结构异常，正在自动修复", {
        responseCharacters: text.length,
        finishReason: payload.choices?.[0]?.finish_reason ?? "unknown",
        issues: parsed.issues,
      });
      repairPayload = await this.request([
        {
          role: "system",
          content:
            "你是 JSON 修复器。只输出一个合法 JSON 对象，不要代码围栏或额外说明，也不得补充来源中不存在的事实。",
        },
        {
          role: "user",
          content: [
            "请将下面的模型回复修复成符合契约的 JSON。",
            "必填字段：oneSentenceSummary(string)、whyWorthWatching(string)、keyPoints(string[1..5])、chapters(array)、actionItems(array)、tags(string[3])；可选字段：displayTitle(string)、markdown(string)。",
            "chapters 每项必须含 title(string)、startMs(非负数字)、endMs(非负数字)、summary(string)。",
            "tags 恰好 3 个，顺序为领域、主题、对象或场景。",
            "原始回复：",
            text,
          ].join("\n"),
        },
      ]);
      parsed = this.parse(repairPayload.choices?.[0]?.message?.content ?? "");
    }
    if (!parsed.success) {
      await report("copywriting.response.invalid", "MiniMax 文案结构校验失败", {
        issues: parsed.issues,
      });
      throw new AppError(
        502,
        parsed.kind === "json" ? "MINIMAX_JSON_INVALID" : "MINIMAX_SCHEMA_INVALID",
        parsed.kind === "json"
          ? "MiniMax 自动修复后仍未返回合法 JSON 文案"
          : "MiniMax 自动修复后的文案结构仍不符合契约",
        parsed.issues,
      );
    }
    await report("copywriting.request.completed", "MiniMax 文案请求成功", {
      inputTokens:
        (payload.usage?.prompt_tokens ?? 0) +
        (repairPayload?.usage?.prompt_tokens ?? 0),
      outputTokens:
        (payload.usage?.completion_tokens ?? 0) +
        (repairPayload?.usage?.completion_tokens ?? 0),
      totalTokens:
        (payload.usage?.total_tokens ?? 0) +
        (repairPayload?.usage?.total_tokens ?? 0),
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

  private parse(value: string):
    | { success: true; data: z.infer<typeof resultSchema> }
    | { success: false; kind: "json" | "schema"; issues: Array<{ path: string; message: string }> } {
    let json: unknown;
    try {
      json = extractJson(value);
    } catch {
      return {
        success: false,
        kind: "json",
        issues: [{ path: "", message: "响应不是合法 JSON" }],
      };
    }
    const parsed = resultSchema.safeParse(json);
    if (parsed.success) {
      return parsed;
    }
    return {
      success: false,
      kind: "schema",
      issues: parsed.error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      })),
    };
  }

  private async request(
    messages: Array<{ role: "system" | "user"; content: string }>,
  ): Promise<MiniMaxResponse> {
    let response: Response;
    try {
      response = await fetch(
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
            messages,
          }),
          signal: AbortSignal.timeout(300_000),
        },
      );
    } catch (error) {
      throw new AppError(
        502,
        "MINIMAX_REQUEST_FAILED",
        error instanceof Error ? error.message : "MiniMax 网络请求失败",
      );
    }
    const payload = (await response.json().catch(() => ({}))) as MiniMaxResponse;
    if (!response.ok || payload.base_resp?.status_code) {
      throw new AppError(
        502,
        "MINIMAX_REQUEST_FAILED",
        payload.error?.message ??
          payload.base_resp?.status_msg ??
          `MiniMax 返回 HTTP ${response.status}`,
      );
    }
    return payload;
  }
}
