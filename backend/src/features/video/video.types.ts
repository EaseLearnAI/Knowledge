export type VideoQuality = "fast" | "balanced" | "accurate";
export type VideoLanguage = "zh" | "en" | "ja" | "auto";
export type ContentKind = "image_post" | "short_video" | "long_video";
export type AnalysisMode = "minimax_m3_multimodal" | "asr_then_summary";

export type TranscriptSegment = {
  startMs: number;
  endMs: number;
  text: string;
};

export type TranscriptResult = {
  title: string;
  source: string;
  transcriptPath: string;
  text: string;
  segments: TranscriptSegment[];
  provider: string;
  contentKind?: ContentKind;
  analysisMode?: AnalysisMode;
  copywriting?: CopywritingResult;
};

export type ResolvedContentAsset = {
  kind: "image" | "video" | "audio";
  url: string;
  format: string;
  headers?: Record<string, string>;
};

export type ResolvedContent = {
  kind: ContentKind;
  platform: "bilibili" | "douyin" | "xiaohongshu";
  title: string;
  text: string;
  durationSeconds: number;
  assets: ResolvedContentAsset[];
};

export type Chapter = {
  title: string;
  startMs: number;
  endMs: number;
  summary: string;
};

export type CopywritingResult = {
  oneSentenceSummary: string;
  whyWorthWatching: string;
  keyPoints: string[];
  chapters: Chapter[];
  actionItems: string[];
  tags: string[];
  markdown: string;
  provider: string;
  model?: string;
};

export type VideoProcessInput = {
  taskId?: string;
  source: string;
  titleHint?: string;
  providerTaskId?: string;
  stagedObjectKey?: string;
  quality: VideoQuality;
  language: VideoLanguage;
};

export type ProgressReporter = (
  event: string,
  message: string,
  data?: Record<string, unknown>,
) => Promise<void> | void;

export interface VideoProcessor {
  process(input: VideoProcessInput, report: ProgressReporter): Promise<TranscriptResult>;
  doctor?(report: ProgressReporter): Promise<void>;
}

export interface Copywriter {
  generate(transcript: TranscriptResult, report: ProgressReporter): Promise<CopywritingResult>;
}
