import { z } from "zod";
import type { AppConfig } from "../../../platform/config/app-config.js";
import { AppError } from "../../../platform/http/errors/app-error.js";
import {
  ArkResponseClient,
  type ArkClient,
} from "./ark-response.client.js";
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
  keyPoints: z.array(z.string().min(1)).min(1).transform((items) => items.slice(0, 5)),
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
    .transform((items) => items.slice(0, 12)),
  actionItems: z
    .array(z.string().min(1))
    .default([])
    .transform((items) => items.slice(0, 6)),
  tags: z.array(z.string().min(1)).min(1).transform((items) => items.slice(0, 3)),
  markdown: z.string().min(1).optional(),
});

type ParsedCopywriting = Omit<
  z.infer<typeof resultSchema>,
  "displayTitle" | "markdown"
> & {
  displayTitle: string;
  markdown: string;
};

function completeMarkdown(
  value: z.infer<typeof resultSchema>,
): ParsedCopywriting {
  const displayTitle = normalizeDisplayTitle(
    value.displayTitle ?? value.oneSentenceSummary,
  );
  if (value.markdown?.trim()) {
    return { ...value, displayTitle, markdown: value.markdown.trim() };
  }
  const markdown = [
    `# ${displayTitle}`,
    "",
    value.whyWorthWatching,
    "",
    "## 核心要点",
    ...value.keyPoints.map((item) => `- ${item}`),
  ].join("\n");
  return { ...value, displayTitle, markdown };
}

const MAP_THRESHOLD_CHARACTERS = 45_000;
const MAP_CHUNK_CHARACTERS = 18_000;

type ModelSelection = {
  models: string[];
  index: number;
};

function isModelUnavailable(error: unknown): boolean {
  if (!(error instanceof AppError)) return false;
  if (error.code === "ARK_MODEL_NOT_OPEN") return true;
  return (
    error.code === "ARK_REQUEST_FAILED" &&
    /(?:reached inference limit|service.*paused|does not exist|do not have access|服务暂停|免费额度|安心体验|Safe Experience Mode)/i.test(
      error.message,
    )
  );
}

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

function splitAtLines(value: string, maximumCharacters: number): string[] {
  const chunks: string[] = [];
  let current = "";
  for (const line of value.split("\n")) {
    if (current && current.length + line.length + 1 > maximumCharacters) {
      chunks.push(current);
      current = "";
    }
    current += `${current ? "\n" : ""}${line}`;
  }
  if (current) chunks.push(current);
  return chunks;
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
    const modelSelection: ModelSelection = {
      models: [
        this.config.arkSummaryModel,
        ...(this.config.arkSummaryFallbackModels ?? []),
      ],
      index: 0,
    };

    await report("copywriting.ark.started", "已向火山方舟发起总结请求", {
      model: modelSelection.models[0],
      fallbackModels: modelSelection.models.slice(1),
      characters: transcript.text.length,
      promptCharacters: timedTranscript.length,
    });
    const sourceMaterial =
      timedTranscript.length > MAP_THRESHOLD_CHARACTERS
        ? await this.mapLongTranscript(
            transcript.title,
            timedTranscript,
            report,
            modelSelection,
          )
        : timedTranscript;
    const request = {
      max_output_tokens: 8_192,
      instructions:
        "你是内容知识编辑。只能根据用户提供的转录或分段提炼，不得编造。目标是让用户在首页快速判断内容讲什么、值不值得看，并在详情页获得不重复的结构化笔记。只输出一个合法且完整的 JSON 对象，不要代码围栏、思考过程或额外说明。",
      input: [
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: [
                `来源标题：${transcript.title}`,
                "输出 JSON 字段：displayTitle、oneSentenceSummary、whyWorthWatching、keyPoints、chapters、actionItems、tags、markdown。",
                "displayTitle：12-24个中文字符，直接写核心主题或关键结论；不要保留作者自述、平台话术、Emoji、#话题、问候语或整段原标题，不要使用“该视频/本期内容”。",
                "oneSentenceSummary：45-90个中文字符，只回答“内容讲了什么、核心结论是什么”；不要重复标题，不要写空泛评价。",
                "whyWorthWatching：20-50个中文字符，只说明用户能获得的具体价值；不要重复摘要。",
                "keyPoints：3-5条字符串，每条只表达一个独立信息，优先保留方法、论据、数据、例子或反常识结论；不要编号，不要互相重复，不要复述标题和摘要。",
                "tags：2-3个名词短语，每个2-8个中文字符；覆盖主题、方法或场景等不同维度；禁止使用“视频、内容、分享、干货、知识”等泛标签，不要带#。",
                "chapters：对象数组，每项 title/startMs/endMs/summary，最多8项；actionItems最多5项；markdown控制在2000个中文字符以内，必须完整结束。",
                "章节时间必须来自材料中的毫秒区间；没有时间戳时 chapters 返回空数组。",
                timedTranscript.length > MAP_THRESHOLD_CHARACTERS
                  ? "以下是按时间段从完整逐字稿提炼的忠实笔记："
                  : "带时间戳转录：",
                sourceMaterial,
              ].join("\n"),
            },
          ],
        },
      ],
    };
    const firstResult = await this.createWithRetry(
      request,
      report,
      modelSelection,
    );
    let parsed = this.parseResult(firstResult.response.text);
    let finalResult = firstResult;
    if (!parsed.success) {
      await report(
        "copywriting.ark.repairing",
        "火山方舟总结结构不完整，正在自动修复 JSON",
        { reason: parsed.reason },
      );
      finalResult = await this.createWithRetry(
        {
          max_output_tokens: 8_192,
          instructions:
            "你是 JSON 修复器。把用户提供的输出修复成一个合法、完整、精简的 JSON 对象。不得新增原输出没有的事实；不要代码围栏或额外说明。",
          input: [
            {
              role: "user",
              content: [
                {
                  type: "input_text",
                  text: [
                    "目标字段：displayTitle(string，12-24字)、oneSentenceSummary(string，45-90字)、whyWorthWatching(string，20-50字)、keyPoints(string[3..5])、chapters({title,startMs,endMs,summary}[]，最多8项)、actionItems(string[]，最多5项)、tags(string[2..3]，每个2-8字)、markdown(string，最多2000中文字)。",
                    "displayTitle 不得包含平台话术、Emoji 或 #话题；要点之间不得重复；标签不得使用“视频、内容、分享、干货、知识”等泛词。",
                    "待修复输出：",
                    firstResult.response.text.slice(0, 120_000),
                  ].join("\n"),
                },
              ],
            },
          ],
        },
        report,
        modelSelection,
      );
      parsed = this.parseResult(finalResult.response.text);
    }
    if (!parsed.success) {
      throw new AppError(
        502,
        parsed.reason === "json"
          ? "ARK_SUMMARY_JSON_INVALID"
          : "ARK_SUMMARY_SCHEMA_INVALID",
        parsed.reason === "json"
          ? "火山方舟没有返回合法 JSON 总结"
          : "火山方舟返回的总结结构不符合契约",
        parsed.details,
      );
    }

    await report("copywriting.ark.completed", "火山方舟总结生成完成", {
      model: finalResult.model,
      responseId: finalResult.response.id,
      ...finalResult.response.usage,
    });
    return {
      ...parsed.data,
      provider: "volcengine-ark-responses",
      model: finalResult.model,
    };
  }

  private async mapLongTranscript(
    title: string,
    timedTranscript: string,
    report: ProgressReporter,
    modelSelection: ModelSelection,
  ): Promise<string> {
    const chunks = splitAtLines(timedTranscript, MAP_CHUNK_CHARACTERS);
    await report(
      "copywriting.ark.map.started",
      "长逐字稿开始分段提炼",
      { chunks: chunks.length, characters: timedTranscript.length },
    );
    const notes: string[] = [];
    for (let index = 0; index < chunks.length; index += 1) {
      const response = await this.createWithRetry(
        {
          max_output_tokens: 4_096,
          instructions:
            "你是忠实的逐字稿编辑。只提炼当前时间段的重要事实、观点、论据和行动信息，保留每条对应的毫秒时间范围。输出精简 Markdown 要点，不输出 JSON，不补充材料之外的信息。",
          input: [
            {
              role: "user",
              content: [
                {
                  type: "input_text",
                  text: [
                    `标题：${title}`,
                    `分段：${index + 1}/${chunks.length}`,
                    chunks[index] ?? "",
                  ].join("\n"),
                },
              ],
            },
          ],
        },
        report,
        modelSelection,
      );
      notes.push(
        `## 分段 ${index + 1}/${chunks.length}\n${response.response.text.trim()}`,
      );
      await report(
        "copywriting.ark.map.chunk.completed",
        "长逐字稿分段提炼完成",
        { chunk: index + 1, chunks: chunks.length },
      );
    }
    await report("copywriting.ark.map.completed", "长逐字稿分段提炼全部完成", {
      chunks: chunks.length,
      noteCharacters: notes.reduce((total, note) => total + note.length, 0),
    });
    return notes.join("\n\n");
  }

  private async createWithRetry(
    request: Record<string, unknown>,
    report: ProgressReporter,
    modelSelection: ModelSelection,
  ): Promise<{
    response: Awaited<ReturnType<ArkClient["create"]>>;
    model: string;
  }> {
    let response: Awaited<ReturnType<ArkClient["create"]>> | undefined;
    let attempt = 1;
    while (attempt <= 3) {
      const model = modelSelection.models[modelSelection.index];
      if (!model) break;
      try {
        response = await this.client.create({ ...request, model });
        break;
      } catch (error: unknown) {
        if (
          isModelUnavailable(error) &&
          modelSelection.index < modelSelection.models.length - 1
        ) {
          const previousModel = model;
          modelSelection.index += 1;
          attempt = 1;
          await report(
            "copywriting.ark.model_fallback",
            "当前总结模型不可用，已自动切换备用模型",
            {
              previousModel,
              model: modelSelection.models[modelSelection.index],
              reason: error instanceof AppError ? error.code : "unknown",
            },
          );
          continue;
        }
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
        attempt += 1;
      }
    }
    if (!response) {
      throw new AppError(
        502,
        "ARK_NETWORK_ERROR",
        "火山方舟总结重试后仍未返回结果",
      );
    }
    return {
      response,
      model: modelSelection.models[modelSelection.index]!,
    };
  }

  private parseResult(
    value: string,
  ):
    | { success: true; data: ParsedCopywriting }
    | { success: false; reason: "json" | "schema"; details?: unknown } {
    let parsedJson: unknown;
    try {
      parsedJson = extractJson(value);
    } catch {
      return { success: false, reason: "json" };
    }
    const parsed = resultSchema.safeParse(parsedJson);
    if (!parsed.success) {
      return {
        success: false,
        reason: "schema",
        details: parsed.error.issues,
      };
    }
    return { success: true, data: completeMarkdown(parsed.data) };
  }
}
