import type {
  ProgressReporter,
  TranscriptResult,
  VideoProcessInput,
  VideoProcessor,
} from "../../modules/processing/domain/video.types.js";

function isDouyinSource(source: string): boolean {
  try {
    const host = new URL(source).hostname.toLowerCase();
    return (
      host === "douyin.com" ||
      host.endsWith(".douyin.com") ||
      host === "iesdouyin.com" ||
      host.endsWith(".iesdouyin.com")
    );
  } catch {
    return false;
  }
}

export class PlatformVideoProcessor implements VideoProcessor {
  constructor(
    private readonly defaultProcessor: VideoProcessor,
    private readonly douyinProcessor: VideoProcessor,
  ) {}

  async process(
    input: VideoProcessInput,
    report: ProgressReporter,
  ): Promise<TranscriptResult> {
    if (isDouyinSource(input.source) && !input.providerTaskId) {
      await report(
        "transcription.provider.selected",
        "抖音媒体将通过服务端下载并上传方舟转写",
        { provider: "volcengine-ark-audio-chunked", platform: "douyin" },
      );
      return this.douyinProcessor.process(input, report);
    }
    return this.defaultProcessor.process(input, report);
  }
}
