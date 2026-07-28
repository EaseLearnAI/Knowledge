import { existsSync } from "node:fs";
import { z } from "zod";
import type { AppConfig } from "../../../platform/config/app-config.js";
import { AppError } from "../../../platform/http/errors/app-error.js";
import {
  DefaultPlatformContentResolver,
  type PlatformContentResolver,
} from "../../media/platform-content-resolver.js";
import {
  DefaultModelMediaStager,
  type ModelMediaStager,
  type StagedModelMedia,
} from "../../media/model-media-stager.js";
import type {
  CopywritingResult,
  ProgressReporter,
  ResolvedContent,
  TranscriptResult,
  VideoProcessInput,
  VideoProcessor,
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

const analysisSchema = z.object({
  contentText: z.string().min(1),
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
        title: z.string(),
        startMs: z.number().nonnegative(),
        endMs: z.number().nonnegative(),
        summary: z.string(),
      }),
    )
    .transform((items) => items.slice(0, 8)),
  actionItems: z
    .array(z.string())
    .transform((items) => items.slice(0, 5)),
  tags: z
    .array(z.string().min(1))
    .min(1)
    .transform((items) => items.slice(0, 3)),
  markdown: z.string().min(1),
});

type MiniMaxResponse = {
  id?: string;
  choices?: Array<{ message?: { content?: string } }>;
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
  return JSON.parse(
    firstBrace >= 0 && lastBrace > firstBrace
      ? withoutFence.slice(firstBrace, lastBrace + 1)
      : withoutFence,
  );
}

export class MiniMaxMultimodalAnalyzer {
  constructor(private readonly config: AppConfig) {}

  async analyze(
    content: ResolvedContent,
    media: StagedModelMedia,
    report: ProgressReporter,
  ): Promise<TranscriptResult> {
    if (!this.config.minimaxApiKey) {
      throw new AppError(
        503,
        "MINIMAX_API_KEY_MISSING",
        "启用 MiniMax M3 多模态解析时必须配置 MINIMAX_API_KEY",
      );
    }
    const contentBlocks: Array<Record<string, unknown>> = [
      {
        type: "text",
        text: [
          `平台：${content.platform}`,
          `内容类型：${content.kind}`,
          `标题：${content.title}`,
          content.text ? `平台正文：${content.text}` : "",
          "请综合正文、画面、字幕和视频中的声音生成 JSON。",
          "contentText 应保留适合全文搜索的正文、OCR、重要口播和画面信息，不要只重复摘要。",
          "只输出字段：contentText、displayTitle、oneSentenceSummary、whyWorthWatching、keyPoints、chapters、actionItems、tags、markdown。",
          "displayTitle 用 12-24 个中文字符直接写核心主题或关键结论；不要保留作者自述、平台话术、Emoji、#话题、问候语或整段原标题，不要使用“该视频/本期内容”。",
          "oneSentenceSummary 用 45-90 字讲清对象、方法和结论；whyWorthWatching 用 20-50 字说明用户能获得什么。",
          "keyPoints 输出 3-5 条互不重复的具体事实或方法；actionItems 最多 5 条；tags 输出 2-3 个 2-8 字的具体主题词，禁止使用“视频、内容、分享、干货、知识”等泛词。",
          "markdown 不超过 2000 个中文字，结构清楚且不要复述标签。",
          "图文的 chapters 必须为空；视频章节时间使用整数毫秒，无法确认时间时也返回空数组，禁止编造。",
        ]
          .filter(Boolean)
          .join("\n"),
      },
      ...media.imageUrls.map((url) => ({
        type: "image_url",
        image_url: {
          url,
          detail: this.config.minimaxVideoDetail,
        },
      })),
      ...(media.videoUrl
        ? [
            {
              type: "video_url",
              video_url: {
                url: media.videoUrl,
                detail: this.config.minimaxVideoDetail,
                fps: this.config.minimaxVideoFps,
              },
            },
          ]
        : []),
    ];
    await report("analysis.minimax.started", "已向 MiniMax M3 发起多模态理解", {
      model: this.config.minimaxModel,
      contentKind: content.kind,
      images: media.imageUrls.length,
      hasVideo: Boolean(media.videoUrl),
    });
    const payload = await this.request(contentBlocks);
    const rawText = payload.choices?.[0]?.message?.content;
    if (!rawText) {
      throw new AppError(
        502,
        "MINIMAX_EMPTY_RESPONSE",
        "MiniMax M3 未返回多模态分析结果",
      );
    }
    let parsed = this.parse(rawText);
    if (!parsed.success) {
      await report("analysis.minimax.repairing", "M3 返回结构异常，正在修复 JSON", {
        issues: parsed.error.issues.map((issue) => issue.path.join(".")),
      });
      const repairPayload = await this.request([
        {
          type: "text",
          text: [
            "请把下面内容修复成合法 JSON，只输出 JSON，不得增加来源中不存在的事实。",
            rawText,
          ].join("\n"),
        },
      ]);
      parsed = this.parse(repairPayload.choices?.[0]?.message?.content ?? "");
    }
    if (!parsed.success) {
      throw new AppError(
        502,
        "MINIMAX_SCHEMA_INVALID",
        "MiniMax M3 返回的多模态分析结构不符合契约",
        parsed.error.issues,
      );
    }
    const copywriting: CopywritingResult = {
      displayTitle: normalizeDisplayTitle(
        parsed.data.displayTitle ?? parsed.data.oneSentenceSummary,
      ),
      oneSentenceSummary: parsed.data.oneSentenceSummary,
      whyWorthWatching: parsed.data.whyWorthWatching,
      keyPoints: parsed.data.keyPoints,
      chapters: parsed.data.chapters,
      actionItems: parsed.data.actionItems,
      tags: parsed.data.tags,
      markdown: parsed.data.markdown,
      provider: "minimax-m3-multimodal",
      model: this.config.minimaxModel,
    };
    await report("analysis.minimax.completed", "MiniMax M3 多模态理解完成", {
      inputTokens: payload.usage?.prompt_tokens ?? 0,
      outputTokens: payload.usage?.completion_tokens ?? 0,
      totalTokens: payload.usage?.total_tokens ?? 0,
    });
    return {
      title: content.title,
      source: "",
      transcriptPath: `minimax-m3://${payload.id ?? "analysis"}`,
      text: parsed.data.contentText,
      segments: [],
      provider: "minimax-m3-multimodal",
      contentKind: content.kind,
      analysisMode: "minimax_m3_multimodal",
      copywriting,
    };
  }

  private parse(value: string) {
    try {
      return analysisSchema.safeParse(extractJson(value));
    } catch {
      return analysisSchema.safeParse(undefined);
    }
  }

  private async request(
    content: Array<Record<string, unknown>>,
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
            reasoning_split: true,
            max_completion_tokens: 12_000,
            temperature: 0.2,
            messages: [
              {
                role: "system",
                content:
                  "你是 Memo 的多模态内容编辑。只能根据提供的正文、图片和视频作答，不得编造。输出必须是一个合法 JSON 对象。",
              },
              { role: "user", content },
            ],
          }),
          signal: AbortSignal.timeout(300_000),
        },
      );
    } catch (error: unknown) {
      throw new AppError(
        502,
        "MINIMAX_NETWORK_ERROR",
        `连接 MiniMax M3 失败：${error instanceof Error ? error.message : "未知错误"}`,
      );
    }
    const payload = (await response.json().catch(() => ({}))) as MiniMaxResponse;
    if (!response.ok || payload.base_resp?.status_code) {
      throw new AppError(
        response.status === 401 ? 401 : 502,
        "MINIMAX_REQUEST_FAILED",
        payload.error?.message ??
          payload.base_resp?.status_msg ??
          `MiniMax M3 返回 HTTP ${response.status}`,
      );
    }
    return payload;
  }
}

export class HybridMultimodalVideoProcessor implements VideoProcessor {
  private readonly resolver: PlatformContentResolver;
  private readonly stager: ModelMediaStager;
  private readonly analyzer: MiniMaxMultimodalAnalyzer;

  constructor(
    private readonly config: AppConfig,
    private readonly fallback: VideoProcessor,
    dependencies: {
      resolver?: PlatformContentResolver;
      stager?: ModelMediaStager;
      analyzer?: MiniMaxMultimodalAnalyzer;
    } = {},
  ) {
    this.resolver =
      dependencies.resolver ?? new DefaultPlatformContentResolver(config);
    this.stager = dependencies.stager ?? new DefaultModelMediaStager(config);
    this.analyzer =
      dependencies.analyzer ?? new MiniMaxMultimodalAnalyzer(config);
  }

  async process(
    input: VideoProcessInput,
    report: ProgressReporter,
  ): Promise<TranscriptResult> {
    if (existsSync(input.source)) {
      return this.fallback.process(input, report);
    }
    let content: ResolvedContent;
    try {
      content = await this.resolver.resolve(input, report);
    } catch (error) {
      await report(
        "analysis.fallback",
        "内容类型识别失败，回退到现有音频解析链路",
        { reason: this.errorCode(error) },
      );
      return this.fallback.process(input, report);
    }
    if (content.kind === "long_video") {
      await report("analysis.fallback", "内容超过短视频阈值，使用 ASR 总结链路", {
        reason: "LONG_VIDEO",
        durationSeconds: content.durationSeconds,
      });
      const transcript = await this.fallback.process(input, report);
      return {
        ...transcript,
        contentKind: "long_video",
        analysisMode: "asr_then_summary",
      };
    }
    let staged: StagedModelMedia | undefined;
    try {
      if (!input.taskId) {
        throw new AppError(
          500,
          "TASK_ID_REQUIRED",
          "M3 多模态媒体准备缺少任务 ID",
        );
      }
      staged = await this.stager.stage(input.taskId, content, report);
      const result = await this.analyzer.analyze(content, staged, report);
      return { ...result, source: input.source };
    } catch (error) {
      if (content.kind === "image_post") throw error;
      await report("analysis.fallback", "M3 短视频理解失败，回退到 ASR 链路", {
        reason: this.errorCode(error),
      });
      const transcript = await this.fallback.process(input, report);
      return {
        ...transcript,
        contentKind: "short_video",
        analysisMode: "asr_then_summary",
      };
    } finally {
      await staged?.cleanup();
    }
  }

  private errorCode(error: unknown): string {
    return typeof error === "object" && error !== null && "code" in error
      ? String(error.code)
      : "UNKNOWN";
  }
}
