import type {
  ProgressReporter,
  TranscriptResult,
  VideoProcessInput,
  VideoProcessor,
} from "./video.types.js";

export class MockVideoProcessor implements VideoProcessor {
  async process(
    input: VideoProcessInput,
    report: ProgressReporter,
  ): Promise<TranscriptResult> {
    await report("video.download.started", "模拟下载视频资源");
    await report("video.download.completed", "模拟视频资源已就绪");
    await report("video.transcribe.started", "模拟 Whisper 转录");

    const title = input.titleHint ?? "AI 产品如何建立可信的内容记忆";
    const lines = [
      "收藏真正的问题不是没有总结，而是收藏之后很难再次找到和使用。",
      "可靠的内容系统必须保存原始证据，并让每个结论能回到视频时间戳。",
      "视频处理应先获取字幕，没有字幕时再使用 Whisper 做本地转录。",
      "产品需要把转录、摘要、标签和用户笔记分层保存，重新生成不能覆盖用户文字。",
      "最小可用闭环是添加内容、自动解析、进入收藏库、搜索和基于来源提问。",
    ];
    const segments = lines.map((text, index) => ({
      startMs: index * 20_000,
      endMs: (index + 1) * 20_000,
      text,
    }));
    await report("video.transcribe.completed", "模拟转录完成", {
      segments: segments.length,
    });
    return {
      title,
      source: input.source,
      transcriptPath: "mock://transcript.json",
      text: lines.join(""),
      segments,
      provider: "mock-videosummarize",
    };
  }
}
