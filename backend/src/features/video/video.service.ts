import { randomUUID } from "node:crypto";
import { unlink } from "node:fs/promises";
import { AppError } from "../../shared/errors/app-error.js";
import { ProcessingTaskModel } from "./processing-task.model.js";
import { SourceItemModel } from "./source-item.model.js";
import type { VideoLanguage, VideoQuality } from "./video.types.js";
import type { VideoTaskRunner } from "./task-runner.js";

function platformOf(url?: string): string {
  if (!url) return "本地上传";
  if (/youtu/.test(url)) return "YouTube";
  if (/bilibili|b23\.tv/.test(url)) return "B站";
  if (/douyin/.test(url)) return "抖音";
  if (/xiaohongshu|xhslink/.test(url)) return "小红书";
  if (/ixigua/.test(url)) return "西瓜视频";
  return "其他";
}

type CreateTaskInput = {
  userId: string;
  inputType: "url" | "upload";
  source: string;
  originalFilename?: string;
  url?: string;
  quality: VideoQuality;
  language: VideoLanguage;
  idempotencyKey?: string;
};

export async function createVideoTask(
  input: CreateTaskInput,
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

export async function getTask(userId: string, taskId: string) {
  const task = await ProcessingTaskModel.findOne({ _id: taskId, userId }).lean();
  if (!task) throw new AppError(404, "TASK_NOT_FOUND", "任务不存在");
  return task;
}

export async function listItems(
  userId: string,
  options: {
    status?: string;
    q?: string;
    page: number;
    pageSize: number;
  },
) {
  const filter: Record<string, unknown> = {
    userId,
    deletedAt: { $exists: false },
  };
  if (options.status) filter.status = options.status;
  if (options.q) filter.$text = { $search: options.q };

  const [items, total] = await Promise.all([
    SourceItemModel.find(filter)
      .sort({ createdAt: -1 })
      .skip((options.page - 1) * options.pageSize)
      .limit(options.pageSize)
      .select("-transcript.text")
      .lean(),
    SourceItemModel.countDocuments(filter),
  ]);
  return { items, total };
}

export async function getItem(userId: string, itemId: string) {
  const item = await SourceItemModel.findOne({
    _id: itemId,
    userId,
    deletedAt: { $exists: false },
  }).lean();
  if (!item) throw new AppError(404, "ITEM_NOT_FOUND", "内容不存在");
  return item;
}

export async function deleteItem(userId: string, itemId: string): Promise<void> {
  const item = await SourceItemModel.findOneAndUpdate(
    { _id: itemId, userId, deletedAt: { $exists: false } },
    { $set: { deletedAt: new Date() }, $inc: { version: 1 } },
  );
  if (!item) throw new AppError(404, "ITEM_NOT_FOUND", "内容不存在");
  const task = item.taskId
    ? await ProcessingTaskModel.findOne({ _id: item.taskId, userId }).lean()
    : null;
  if (task?.inputType === "upload") {
    await unlink(task.source).catch(() => undefined);
  }
}
