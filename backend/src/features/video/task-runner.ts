import { randomUUID } from "node:crypto";
import type { AppLogger } from "../../shared/logger/logger.js";
import { terminalEventBus } from "../../shared/logger/event-bus.js";
import { ProcessingTaskModel } from "./processing-task.model.js";
import { SourceItemModel } from "./source-item.model.js";
import type {
  Copywriter,
  ProgressReporter,
  VideoProcessor,
} from "./video.types.js";

export class VideoTaskRunner {
  private tail: Promise<void> = Promise.resolve();
  private pollTimer: NodeJS.Timeout | undefined;
  private readonly scheduled = new Set<string>();
  private readonly workerId = randomUUID();

  constructor(
    private readonly processor: VideoProcessor,
    private readonly copywriter: Copywriter,
    private readonly logger: AppLogger,
    private readonly options: {
      enabled: boolean;
      leaseSeconds: number;
      maxAttempts: number;
    } = {
      enabled: true,
      leaseSeconds: 120,
      maxAttempts: 3,
    },
  ) {}

  enqueue(taskId: string): void {
    if (!this.options.enabled || this.scheduled.has(taskId)) return;
    this.scheduled.add(taskId);
    this.tail = this.tail
      .then(() => this.run(taskId))
      .catch((error: unknown) => {
        this.logger.error({ error, taskId }, "视频队列出现未处理异常");
      })
      .finally(() => {
        this.scheduled.delete(taskId);
      });
  }

  async whenIdle(): Promise<void> {
    await this.tail;
  }

  async recoverPending(recoverInterrupted = true): Promise<number> {
    if (!this.options.enabled) return 0;
    await ProcessingTaskModel.updateMany(
      { attempts: { $exists: false } },
      { $set: { attempts: 0 } },
    );
    const now = new Date();
    const pending = await ProcessingTaskModel.find({
      attempts: { $lt: this.options.maxAttempts },
      $or: [
        { status: "queued" },
        { status: "processing", leaseUntil: { $lte: now } },
        { status: "processing", leaseUntil: { $exists: false } },
      ],
    })
      .sort({ createdAt: 1 })
      .select("_id")
      .lean();
    for (const task of pending) this.enqueue(String(task._id));
    if (pending.length > 0) {
      this.logger.info(
        {
          event: "task.queue.recovered",
          recoverInterrupted,
          queued: pending.length,
        },
        "已恢复未完成视频任务",
      );
    }
    return pending.length;
  }

  startPolling(intervalMs: number): void {
    if (!this.options.enabled || this.pollTimer) return;
    this.pollTimer = setInterval(() => {
      void this.recoverPending(false).catch((error: unknown) => {
        this.logger.error({ error }, "轮询未完成视频任务失败");
      });
    }, intervalMs);
    this.pollTimer.unref();
  }

  stopPolling(): void {
    if (!this.pollTimer) return;
    clearInterval(this.pollTimer);
    this.pollTimer = undefined;
  }

  private reporter(taskId: string): ProgressReporter {
    return async (event, message, data) => {
      const level = event.includes("stderr") || event.includes("failed") ? "warn" : "info";
      this.logger[level]({ event, taskId, data }, message);
      terminalEventBus.publish({
        level,
        event,
        message,
        taskId,
        ...(data ? { data } : {}),
      });
      await ProcessingTaskModel.updateOne(
        { _id: taskId },
        {
          $push: {
            logs: {
              $each: [{ timestamp: new Date(), level, event, message, data }],
              $slice: -500,
            },
          },
        },
      );
    };
  }

  private async run(taskId: string): Promise<void> {
    const now = new Date();
    const leaseUntil = new Date(
      now.getTime() + this.options.leaseSeconds * 1_000,
    );
    const task = await ProcessingTaskModel.findOneAndUpdate(
      {
        _id: taskId,
        attempts: { $lt: this.options.maxAttempts },
        $or: [
          { status: "queued" },
          { status: "processing", leaseUntil: { $lte: now } },
          { status: "processing", leaseUntil: { $exists: false } },
        ],
      },
      {
        $set: {
          status: "processing",
          stage: "transcribing",
          progress: 10,
          startedAt: now,
          leaseOwner: this.workerId,
          leaseUntil,
        },
        $inc: { attempts: 1 },
      },
      { new: true },
    );
    if (!task) return;
    const report = this.reporter(taskId);
    await report("task.started", "视频解析任务开始执行");
    const renewEveryMs = Math.max(
      10_000,
      Math.floor((this.options.leaseSeconds * 1_000) / 3),
    );
    const renewLease = setInterval(() => {
      void ProcessingTaskModel.updateOne(
        {
          _id: taskId,
          status: "processing",
          leaseOwner: this.workerId,
        },
        {
          $set: {
            leaseUntil: new Date(
              Date.now() + this.options.leaseSeconds * 1_000,
            ),
          },
        },
      ).catch((error: unknown) => {
        this.logger.error({ error, taskId }, "续租视频任务失败");
      });
    }, renewEveryMs);
    renewLease.unref();

    try {
      const providerTaskId = [...task.logs]
        .reverse()
        .find(
          (log) =>
            log.event === "transcription.volc.submitted" &&
            typeof log.data?.requestId === "string",
        )?.data?.requestId;
      const resolvedTitle = [...task.logs]
        .reverse()
        .find(
          (log) =>
            log.event === "media.resolve.completed" &&
            typeof log.data?.title === "string",
        )?.data?.title;
      const stagedObjectKey = [...task.logs]
        .reverse()
        .find(
          (log) =>
            log.event === "media.tos.uploaded" &&
            typeof log.data?.objectKey === "string",
        )?.data?.objectKey;
      const transcript = await this.processor.process(
        {
          taskId,
          source: task.source,
          ...(task.originalFilename
            ? { titleHint: task.originalFilename }
            : typeof resolvedTitle === "string"
              ? { titleHint: resolvedTitle }
              : {}),
          ...(typeof providerTaskId === "string" ? { providerTaskId } : {}),
          ...(typeof stagedObjectKey === "string" ? { stagedObjectKey } : {}),
          quality: task.quality,
          language: task.language,
        },
        report,
      );
      task.stage = "copywriting";
      task.progress = 75;
      await task.save();

      const copywriting = await this.copywriter.generate(transcript, report);
      await SourceItemModel.updateOne(
        { _id: task.sourceItemId },
        {
          $set: {
            title: transcript.title,
            status: "completed",
            transcript: {
              text: transcript.text,
              segments: transcript.segments,
              path: transcript.transcriptPath,
              provider: transcript.provider,
            },
            copywriting,
            tags: copywriting.tags,
          },
          $inc: { version: 1 },
        },
      );

      task.status = "completed";
      task.stage = "completed";
      task.progress = 100;
      task.completedAt = new Date();
      task.set("leaseOwner", undefined);
      task.set("leaseUntil", undefined);
      await task.save();
      await report("task.completed", "视频解析与承接文案已全部完成");
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "未知处理错误";
      const code =
        typeof error === "object" && error !== null && "code" in error
          ? String(error.code)
          : "VIDEO_TASK_FAILED";
      const retryable =
        task.attempts < this.options.maxAttempts &&
        /NETWORK|TIMEOUT|REQUEST_FAILED|QUERY_FAILED|DOWNLOAD_FAILED|RESOLVE_FAILED|TOS_OPERATION_FAILED/.test(
          code,
        );
      if (!retryable) {
        await SourceItemModel.updateOne(
          { _id: task.sourceItemId },
          { $set: { status: "failed" }, $inc: { version: 1 } },
        );
      }
      task.status = retryable ? "queued" : "failed";
      task.stage = retryable ? "queued" : "failed";
      task.error = { code, message };
      if (!retryable) task.completedAt = new Date();
      task.set("leaseOwner", undefined);
      task.set("leaseUntil", undefined);
      await task.save();
      await report(
        retryable ? "task.retry_scheduled" : "task.failed",
        retryable ? `任务将在稍后重试：${message}` : message,
        { code, attempts: task.attempts },
      );
      if (retryable) {
        const retryTimer = setTimeout(() => this.enqueue(taskId), 1_000);
        retryTimer.unref();
      }
    } finally {
      clearInterval(renewLease);
    }
  }
}
