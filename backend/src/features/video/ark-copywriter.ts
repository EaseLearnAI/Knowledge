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
    const timedTranscript =
      transcript.segments.length > 0
        ? transcript.segments
            .map(
              (segment) =>
                `[${Math.round(segment.startMs)}-${Math.round(segment.endMs)}] ${segment.text}`,
            )
            .join("\n")
        : transcript.text;

    await report("copywriting.ark.started", "已向火山方舟发起总结请求", {
      model: this.config.arkSummaryModel,
      characters: transcript.text.length,
    });
    const response = await this.client.create({
      model: this.config.arkSummaryModel,
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
    });

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
