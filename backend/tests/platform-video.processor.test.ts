import { describe, expect, it, vi } from "vitest";
import { PlatformVideoProcessor } from "../src/features/video/platform-video.processor.js";
import type {
  TranscriptResult,
  VideoProcessor,
} from "../src/features/video/video.types.js";

function processor(provider: string): VideoProcessor {
  return {
    process: vi.fn().mockResolvedValue({
      title: provider,
      source: "https://example.com/video",
      transcriptPath: `${provider}://result`,
      text: "转写",
      segments: [],
      provider,
    } satisfies TranscriptResult),
  };
}

describe("PlatformVideoProcessor", () => {
  it("抖音新任务通过服务端下载后交给方舟音频转写", async () => {
    const primary = processor("volcengine-bigasr");
    const douyin = processor("volcengine-ark-audio-chunked");
    const events: string[] = [];

    const result = await new PlatformVideoProcessor(primary, douyin).process(
      {
        source: "https://www.douyin.com/video/7658152723547753771",
        quality: "balanced",
        language: "zh",
      },
      (event) => {
        events.push(event);
      },
    );

    expect(result.provider).toBe("volcengine-ark-audio-chunked");
    expect(douyin.process).toHaveBeenCalledOnce();
    expect(primary.process).not.toHaveBeenCalled();
    expect(events).toContain("transcription.provider.selected");
  });

  it("已有火山任务 ID 时继续查询原任务，避免重复提交计费", async () => {
    const primary = processor("volcengine-bigasr");
    const douyin = processor("volcengine-ark-audio-chunked");

    const result = await new PlatformVideoProcessor(primary, douyin).process(
      {
        source: "https://www.douyin.com/video/7658152723547753771",
        providerTaskId: "existing-volc-task",
        quality: "balanced",
        language: "zh",
      },
      () => undefined,
    );

    expect(result.provider).toBe("volcengine-bigasr");
    expect(primary.process).toHaveBeenCalledOnce();
    expect(douyin.process).not.toHaveBeenCalled();
  });

  it("小红书仍使用默认火山录音识别链路", async () => {
    const primary = processor("volcengine-bigasr");
    const douyin = processor("volcengine-ark-audio-chunked");

    const result = await new PlatformVideoProcessor(primary, douyin).process(
      {
        source: "https://www.xiaohongshu.com/explore/note-id",
        quality: "balanced",
        language: "zh",
      },
      () => undefined,
    );

    expect(result.provider).toBe("volcengine-bigasr");
    expect(primary.process).toHaveBeenCalledOnce();
    expect(douyin.process).not.toHaveBeenCalled();
  });
});
