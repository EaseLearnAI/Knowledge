import { afterEach, describe, expect, it, vi } from "vitest";
import { loadConfig, type AppConfig } from "../src/config.js";
import {
  HybridMultimodalVideoProcessor,
  MiniMaxMultimodalAnalyzer,
} from "../src/features/video/minimax-multimodal.processor.js";
import type { ModelMediaStager } from "../src/features/video/model-media-stager.js";
import type { PlatformContentResolver } from "../src/features/video/platform-content-resolver.js";
import type {
  ResolvedContent,
  TranscriptResult,
  VideoProcessor,
} from "../src/features/video/video.types.js";

const config: AppConfig = {
  ...loadConfig({ NODE_ENV: "test" }),
  minimaxApiKey: "test-api-key",
  minimaxMultimodalEnabled: true,
  minimaxShortVideoMaxSeconds: 180,
};

const input = {
  taskId: "task-001",
  source: "https://www.xiaohongshu.com/explore/test",
  quality: "balanced" as const,
  language: "auto" as const,
};

function modelPayload() {
  return {
    id: "m3-response",
    choices: [
      {
        message: {
          content: JSON.stringify({
            contentText: "正文与画面共同说明了如何整理知识。",
            oneSentenceSummary: "这是一个知识整理方法。",
            whyWorthWatching: "包含可以立即执行的步骤。",
            keyPoints: ["先收集内容。", "再提炼重点。"],
            chapters: [],
            actionItems: ["整理一条收藏。"],
            tags: ["知识管理"],
            markdown: "# 知识整理",
          }),
        },
      },
    ],
    usage: {
      prompt_tokens: 100,
      completion_tokens: 80,
      total_tokens: 180,
    },
    base_resp: { status_code: 0, status_msg: "" },
  };
}

function fallbackProcessor() {
  const process = vi.fn(async (): Promise<TranscriptResult> => ({
    title: "ASR fallback",
    source: input.source,
    transcriptPath: "asr://fallback",
    text: "fallback transcript",
    segments: [],
    provider: "fallback",
  }));
  return { processor: { process } satisfies VideoProcessor, process };
}

function resolverFor(content: ResolvedContent): PlatformContentResolver {
  return { resolve: vi.fn(async () => content) };
}

function stagerFor(media: { imageUrls: string[]; videoUrl?: string }) {
  const cleanup = vi.fn(async () => undefined);
  const stage = vi.fn(async () => ({ ...media, cleanup }));
  return {
    stager: { stage } satisfies ModelMediaStager,
    stage,
    cleanup,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("HybridMultimodalVideoProcessor", () => {
  it("图文直接使用 M3 图片理解并复用同一次结构化结果", async () => {
    const content: ResolvedContent = {
      kind: "image_post",
      platform: "xiaohongshu",
      title: "图文收藏",
      text: "平台正文",
      durationSeconds: 0,
      assets: [
        {
          kind: "image",
          url: "https://img.example/post.jpg",
          format: "jpg",
        },
      ],
    };
    const fallback = fallbackProcessor();
    const staged = stagerFor({
      imageUrls: ["https://tos.example/signed-image.jpg"],
    });
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(modelPayload()), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const processor = new HybridMultimodalVideoProcessor(
      config,
      fallback.processor,
      {
        resolver: resolverFor(content),
        stager: staged.stager,
        analyzer: new MiniMaxMultimodalAnalyzer(config),
      },
    );

    const result = await processor.process(input, () => undefined);

    expect(result.contentKind).toBe("image_post");
    expect(result.analysisMode).toBe("minimax_m3_multimodal");
    expect(result.copywriting?.oneSentenceSummary).toContain("知识整理");
    expect(fallback.process).not.toHaveBeenCalled();
    expect(staged.cleanup).toHaveBeenCalledOnce();
    const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const body = JSON.parse(String(request.body));
    expect(body.thinking).toEqual({ type: "disabled" });
    expect(body.messages[1].content).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "image_url",
          image_url: expect.objectContaining({
            url: "https://tos.example/signed-image.jpg",
          }),
        }),
      ]),
    );
  });

  it("短视频只向 M3 发送 video_url，不调用 ASR", async () => {
    const content: ResolvedContent = {
      kind: "short_video",
      platform: "douyin",
      title: "三分钟短视频",
      text: "视频说明",
      durationSeconds: 180,
      assets: [
        {
          kind: "video",
          url: "https://video.example/source.mp4",
          format: "mp4",
        },
      ],
    };
    const fallback = fallbackProcessor();
    const staged = stagerFor({
      imageUrls: [],
      videoUrl: "https://tos.example/signed-video.mp4",
    });
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(modelPayload()), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const processor = new HybridMultimodalVideoProcessor(
      config,
      fallback.processor,
      {
        resolver: resolverFor(content),
        stager: staged.stager,
        analyzer: new MiniMaxMultimodalAnalyzer(config),
      },
    );

    const result = await processor.process(
      { ...input, source: "https://www.douyin.com/video/123" },
      () => undefined,
    );

    expect(result.analysisMode).toBe("minimax_m3_multimodal");
    expect(fallback.process).not.toHaveBeenCalled();
    const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const body = JSON.parse(String(request.body));
    expect(body.messages[1].content).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "video_url",
          video_url: expect.objectContaining({
            url: "https://tos.example/signed-video.mp4",
            fps: 1,
          }),
        }),
      ]),
    );
  });

  it("长视频直接保留 ASR 链路", async () => {
    const content: ResolvedContent = {
      kind: "long_video",
      platform: "bilibili",
      title: "长视频",
      text: "",
      durationSeconds: 181,
      assets: [
        {
          kind: "video",
          url: "https://video.example/source.mp4",
          format: "mp4",
        },
      ],
    };
    const fallback = fallbackProcessor();
    const staged = stagerFor({ imageUrls: [] });
    const processor = new HybridMultimodalVideoProcessor(
      config,
      fallback.processor,
      {
        resolver: resolverFor(content),
        stager: staged.stager,
        analyzer: new MiniMaxMultimodalAnalyzer(config),
      },
    );

    const result = await processor.process(input, () => undefined);

    expect(result.analysisMode).toBe("asr_then_summary");
    expect(result.contentKind).toBe("long_video");
    expect(fallback.process).toHaveBeenCalledOnce();
    expect(staged.stage).not.toHaveBeenCalled();
  });

  it("M3 技术失败时清理媒体并自动回退 ASR", async () => {
    const content: ResolvedContent = {
      kind: "short_video",
      platform: "douyin",
      title: "短视频",
      text: "",
      durationSeconds: 60,
      assets: [
        {
          kind: "video",
          url: "https://video.example/source.mp4",
          format: "mp4",
        },
      ],
    };
    const fallback = fallbackProcessor();
    const staged = stagerFor({
      imageUrls: [],
      videoUrl: "https://tos.example/signed-video.mp4",
    });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: { message: "temporary" } }), {
          status: 503,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );
    const processor = new HybridMultimodalVideoProcessor(
      config,
      fallback.processor,
      {
        resolver: resolverFor(content),
        stager: staged.stager,
        analyzer: new MiniMaxMultimodalAnalyzer(config),
      },
    );

    const result = await processor.process(input, () => undefined);

    expect(result.analysisMode).toBe("asr_then_summary");
    expect(result.contentKind).toBe("short_video");
    expect(fallback.process).toHaveBeenCalledOnce();
    expect(staged.cleanup).toHaveBeenCalledOnce();
  });
});
