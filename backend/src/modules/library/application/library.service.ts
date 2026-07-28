import { unlink } from "node:fs/promises";
import { AppError } from "../../../platform/http/errors/app-error.js";
import { ProcessingTaskModel } from "../../processing/adapters/mongo/processing-task.model.js";
import { SourceItemModel } from "../adapters/mongo/source-item.model.js";

export type ListItemsOptions = {
  status?: string;
  q?: string;
  page: number;
  pageSize: number;
};

export async function listItems(userId: string, options: ListItemsOptions) {
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
      .select("-transcript.text -content.text")
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

export async function updateItem(
  userId: string,
  itemId: string,
  input: { tags?: string[]; isFavorite?: boolean },
) {
  const changes: Record<string, unknown> = {};
  if (input.tags !== undefined) {
    changes.tags = [...new Set(input.tags.map((tag) => tag.trim()))]
      .filter(Boolean)
      .sort();
  }
  if (input.isFavorite !== undefined) {
    changes.isFavorite = input.isFavorite;
  }
  const item = await SourceItemModel.findOneAndUpdate(
    { _id: itemId, userId, deletedAt: { $exists: false } },
    { $set: changes, $inc: { version: 1 } },
    { new: true },
  ).lean();
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
