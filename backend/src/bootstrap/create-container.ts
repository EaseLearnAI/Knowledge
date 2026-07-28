import { ArkVideoProcessor } from "../integrations/analysis/ark/ark-video.processor.js";
import { MockVideoProcessor } from "../integrations/analysis/local/mock-video.processor.js";
import { HybridMultimodalVideoProcessor } from "../integrations/analysis/minimax/minimax-multimodal.processor.js";
import { PlatformVideoProcessor } from "../integrations/analysis/platform-video.processor.js";
import { ArkCopywriter } from "../integrations/generation/ark/ark-copywriter.js";
import { LocalCopywriter } from "../integrations/generation/local/local-copywriter.js";
import { MiniMaxCopywriter } from "../integrations/generation/minimax/minimax-copywriter.js";
import { VideoSummarizeProcessor } from "../integrations/transcription/local/videosummarize.processor.js";
import { VolcAsrVideoProcessor } from "../integrations/transcription/volc/volc-asr-video.processor.js";
import type { Copywriter, VideoProcessor } from "../modules/processing/domain/video.types.js";
import type { AppConfig } from "../platform/config/app-config.js";

export type ProcessingOverrides = {
  videoProcessor?: VideoProcessor;
  copywriter?: Copywriter;
};

export type ProcessingContainer = {
  processor: VideoProcessor;
  copywriter: Copywriter;
};

export function createProcessingContainer(
  config: AppConfig,
  overrides: ProcessingOverrides = {},
): ProcessingContainer {
  const fallbackProcessor =
    overrides.videoProcessor ??
    (config.videoProcessor === "mock"
      ? new MockVideoProcessor()
      : config.videoProcessor === "ark"
        ? new ArkVideoProcessor(config)
        : config.videoProcessor === "volc_asr"
          ? new PlatformVideoProcessor(
              new VolcAsrVideoProcessor(config),
              new ArkVideoProcessor(config),
            )
          : new VideoSummarizeProcessor(config));

  const processor = config.minimaxMultimodalEnabled
    ? new HybridMultimodalVideoProcessor(config, fallbackProcessor)
    : fallbackProcessor;

  const copywriter =
    overrides.copywriter ??
    (config.copywriterProvider === "minimax"
      ? new MiniMaxCopywriter(config)
      : config.copywriterProvider === "ark"
        ? new ArkCopywriter(config)
        : new LocalCopywriter());

  return { processor, copywriter };
}
