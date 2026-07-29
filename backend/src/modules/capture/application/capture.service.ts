import { randomUUID } from "node:crypto";
import { AppError } from "../../../platform/http/errors/app-error.js";
import { SourceItemModel } from "../../library/adapters/mongo/source-item.model.js";
import { ProcessingTaskModel } from "../../processing/adapters/mongo/processing-task.model.js";
import type { VideoTaskRunner } from "../../processing/application/task-runner.js";
import type {
  VideoLanguage,
  VideoQuality,
} from "../../processing/domain/video.types.js";

function platformOf(url?: string): string {
  if (!url) return "本地上传";
  if (/bilibili|b23\.tv/.test(url)) return "B站";
  if (/douyin/.test(url)) return "抖音";
  if (/xiaohongshu|xhslink/.test(url)) return "小红书";
  return "其他";
}

export type CreateCaptureInput = {
  userId: string;
  inputType: "url" | "upload";
  source: string;
  originalFilename?: string;
  url?: string;
  quality: VideoQuality;
  language: VideoLanguage;
  idempotencyKey?: string;
};

export async function createCaptureTask(
  input: CreateCaptureInput,
  runner: VideoTaskRunner,
) {
  const idempotencyKey = input.idempotencyKey ?? randomUUID();
  const existing = await ProcessingTaskModel.findOne({
    userId: input.userId,
    idempotencyKey,
  }).lean();
  if (existing) return existing;

  const item = await SourceItemModel.create({
    userId: input.userId,
    type: input.inputType === "upload" && /\.(mp3|m4a|wav)$/i.test(input.source)
      ? "audio"
      : "video",
    platform: platformOf(input.url),
    ...(input.url ? { url: input.url } : {}),
    title: input.originalFilename ?? "正在解析视频…",
    status: "processing",
    tags: [],
    capturedAt: new Date(),
  });

  try {
    const task = await ProcessingTaskModel.create({
      userId: input.userId,
      sourceItemId: item._id,
      inputType: input.inputType,
      source: input.source,
      ...(input.originalFilename ? { originalFilename: input.originalFilename } : {}),
      quality: input.quality,
      language: input.language,
      idempotencyKey,
      status: "queued",
      stage: "queued",
      progress: 0,
      statusMessage: "任务已加入队列",
      logs: [],
    });
    item.taskId = task._id;
    await item.save();
    runner.enqueue(String(task._id));
    return task.toObject();
  } catch (error) {
    await SourceItemModel.deleteOne({ _id: item._id });
    const duplicate = await ProcessingTaskModel.findOne({
      userId: input.userId,
      idempotencyKey,
    }).lean();
    if (duplicate) return duplicate;
    throw error;
  }
}

export async function getCaptureTask(userId: string, taskId: string) {
  const task = await ProcessingTaskModel.findOne({ _id: taskId, userId }).lean();
  if (!task) throw new AppError(404, "TASK_NOT_FOUND", "任务不存在");
  return task;
}
