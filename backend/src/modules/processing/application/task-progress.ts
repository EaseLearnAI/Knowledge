export type TaskProgressUpdate = {
  stage: string;
  progress: number;
  statusMessage: string;
};

type ProgressData = Record<string, unknown> | undefined;

const milestones: Record<string, Omit<TaskProgressUpdate, "statusMessage">> = {
  "task.started": { stage: "starting", progress: 5 },
  "content.resolve.started": { stage: "resolving", progress: 10 },
  "media.resolve.started": { stage: "resolving", progress: 10 },
  "video.cli.started": { stage: "resolving", progress: 10 },
  "video.local.started": { stage: "preparing", progress: 15 },
  "video.download.started": { stage: "downloading", progress: 15 },
  "content.resolve.completed": { stage: "resolved", progress: 20 },
  "media.resolve.completed": { stage: "resolved", progress: 20 },
  "analysis.media.stage.started": { stage: "preparing", progress: 25 },
  "audio.prepare.started": { stage: "preparing", progress: 25 },
  "media.download.started": { stage: "downloading", progress: 30 },
  "analysis.media.stage.completed": { stage: "prepared", progress: 40 },
  "audio.prepare.completed": { stage: "prepared", progress: 40 },
  "media.download.completed": { stage: "prepared", progress: 40 },
  "media.tos.uploaded": { stage: "prepared", progress: 45 },
  "video.transcribe.started": { stage: "transcribing", progress: 45 },
  "transcription.ark.upload.started": { stage: "transcribing", progress: 45 },
  "transcription.volc.submitted": { stage: "transcribing", progress: 50 },
  "transcription.volc.resumed": { stage: "transcribing", progress: 50 },
  "analysis.minimax.started": { stage: "analyzing", progress: 55 },
  "analysis.minimax.repairing": { stage: "analyzing", progress: 65 },
  "transcription.ark.completed": { stage: "transcribed", progress: 72 },
  "transcription.volc.completed": { stage: "transcribed", progress: 72 },
  "video.transcribe.completed": { stage: "transcribed", progress: 72 },
  "video.cli.completed": { stage: "transcribed", progress: 72 },
  "video.local.completed": { stage: "transcribed", progress: 72 },
  "analysis.minimax.completed": { stage: "analyzed", progress: 92 },
  "copywriting.started": { stage: "summarizing", progress: 78 },
  "copywriting.request.started": { stage: "summarizing", progress: 78 },
  "copywriting.ark.started": { stage: "summarizing", progress: 78 },
  "copywriting.ark.map.started": { stage: "summarizing", progress: 80 },
  "copywriting.response.repairing": { stage: "summarizing", progress: 92 },
  "copywriting.ark.repairing": { stage: "summarizing", progress: 92 },
  "copywriting.completed": { stage: "summarized", progress: 96 },
  "copywriting.request.completed": { stage: "summarized", progress: 96 },
  "copywriting.ark.completed": { stage: "summarized", progress: 96 },
  "analysis.fallback": { stage: "transcribing", progress: 45 },
  "task.retry_scheduled": { stage: "retrying", progress: 5 },
  "task.failed": { stage: "failed", progress: 5 },
  "task.completed": { stage: "completed", progress: 100 },
};

export function progressForTaskEvent(
  event: string,
  message: string,
  data?: ProgressData,
): TaskProgressUpdate | undefined {
  if (event === "copywriting.ark.map.chunk.completed") {
    const chunk = Number(data?.chunk);
    const chunks = Number(data?.chunks);
    if (Number.isFinite(chunk) && Number.isFinite(chunks) && chunks > 0) {
      return {
        stage: "summarizing",
        progress: Math.min(91, 80 + Math.round((chunk / chunks) * 11)),
        statusMessage: message,
      };
    }
  }

  const milestone = milestones[event];
  return milestone ? { ...milestone, statusMessage: message } : undefined;
}

export function publicTaskError(
  code: string,
  technicalMessage: string,
  source: string,
): string {
  const isXiaohongshu = /xiaohongshu|xhslink/i.test(source);
  const isDouyin = /douyin/i.test(source);
  const cannotReadMedia =
    /DOWNLOAD_FAILED|RESOLVE_FAILED|MEDIA_LOGIN_REQUIRED/.test(code) ||
    /No video formats found|login|cookie/i.test(technicalMessage);

  if (isXiaohongshu && cannotReadMedia) {
    return "暂时无法读取这条小红书内容。请确认笔记仍可访问，刷新分享链接后点击重试。";
  }
  if (isDouyin && cannotReadMedia) {
    return "暂时无法读取这条抖音内容。请确认作品仍可访问，刷新分享链接后点击重试。";
  }
  if (cannotReadMedia) {
    return "暂时无法读取原始内容。请确认链接仍可访问后点击重试。";
  }
  if (/MINIMAX|ARK|VOLC_ASR/.test(code)) {
    return "内容分析服务暂时不可用，请稍后点击重试。";
  }
  return "这条内容没有分析完成，请稍后点击重试。";
}
