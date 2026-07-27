import "dotenv/config";
import { randomUUID } from "node:crypto";
import { ArkCopywriter } from "../src/features/video/ark-copywriter.js";
import { VolcAsrVideoProcessor } from "../src/features/video/volc-asr-video.processor.js";
import type {
  CopywritingResult,
  TranscriptResult,
} from "../src/features/video/video.types.js";
import { loadConfig } from "../src/config.js";

const source = process.env.REAL_VIDEO_URL?.trim();
const providerTaskId = process.env.REAL_VOLC_REQUEST_ID?.trim();
if (!source) {
  throw new Error("请通过 REAL_VIDEO_URL 提供待验证的公开视频链接");
}

const config = loadConfig();
if (!config.volcAsrAppId || !config.volcAsrAccessToken || !config.arkApiKey) {
  throw new Error("真实云端冒烟需要配置 SeedASR 和 ARK 凭据");
}

const report = async (
  event: string,
  message: string,
  data?: Record<string, unknown>,
) => {
  const safeData = data
    ? Object.fromEntries(
        Object.entries(data).filter(
          ([key]) => !/url|token|secret|key/i.test(key),
        ),
      )
    : undefined;
  console.log(JSON.stringify({ event, message, ...(safeData ? { data: safeData } : {}) }));
};

const keepAlive = setInterval(() => undefined, 1_000);
let transcript: TranscriptResult;
let copywriting: CopywritingResult;
try {
  transcript = await new VolcAsrVideoProcessor(config).process(
    {
      taskId: randomUUID(),
      source,
      ...(providerTaskId ? { providerTaskId } : {}),
      quality: "balanced",
      language: "zh",
    },
    report,
  );
  copywriting = await new ArkCopywriter(config).generate(transcript, report);
} finally {
  clearInterval(keepAlive);
}

console.log(
  JSON.stringify({
    ok: true,
    title: transcript.title,
    transcriptCharacters: transcript.text.length,
    segments: transcript.segments.length,
    transcriptProvider: transcript.provider,
    summaryCharacters: copywriting.oneSentenceSummary.length,
    keyPoints: copywriting.keyPoints.length,
    chapters: copywriting.chapters.length,
    copywriterProvider: copywriting.provider,
  }),
);
