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

  constructor(
    private readonly processor: VideoProcessor,
    private readonly copywriter: Copywriter,
    private readonly logger: AppLogger,
  ) {}

  enqueue(taskId: string): void {
    this.tail = this.tail
      .then(() => this.run(taskId))
      .catch((error: unknown) => {
        this.logger.error({ error, taskId }, "视频队列出现未处理异常");
      });
  }

  async whenIdle(): Promise<void> {
    await this.tail;
  }

  async recoverPending(): Promise<number> {
    const interrupted = await ProcessingTaskModel.updateMany(
      { status: "processing" },
      {
        $set: { status: "queued", stage: "queued" },
        $push: {
          logs: {
            timestamp: new Date(),
            level: "warn",
            event: "task.recovered",
            message: "服务重启，任务已重新入队",
          },
        },
      },
    );
    const pending = await ProcessingTaskModel.find({ status: "queued" })
      .sort({ createdAt: 1 })
      .select("_id")
      .lean();
    for (const task of pending) this.enqueue(String(task._id));
    if (interrupted.modifiedCount > 0 || pending.length > 0) {
      this.logger.info(
        {
          event: "task.queue.recovered",
          interrupted: interrupted.modifiedCount,
          queued: pending.length,
        },
        "已恢复未完成视频任务",
      );
    }
    return pending.length;
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
    const task = await ProcessingTaskModel.findById(taskId);
    if (!task || task.status !== "queued") return;
    const report = this.reporter(taskId);

    task.status = "processing";
    task.stage = "transcribing";
    task.progress = 10;
    task.startedAt = new Date();
    await task.save();
    await report("task.started", "视频解析任务开始执行");

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
      const transcript = await this.processor.process(
        {
          source: task.source,
          ...(task.originalFilename
            ? { titleHint: task.originalFilename }
            : typeof resolvedTitle === "string"
              ? { titleHint: resolvedTitle }
              : {}),
          ...(typeof providerTaskId === "string" ? { providerTaskId } : {}),
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
      await task.save();
      await report("task.completed", "视频解析与承接文案已全部完成");
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "未知处理错误";
      const code =
        typeof error === "object" && error !== null && "code" in error
          ? String(error.code)
          : "VIDEO_TASK_FAILED";
      await SourceItemModel.updateOne(
        { _id: task.sourceItemId },
        { $set: { status: "failed" }, $inc: { version: 1 } },
      );
      task.status = "failed";
      task.stage = "failed";
      task.error = { code, message };
      task.completedAt = new Date();
      await task.save();
      await report("task.failed", message, { code });
    }
  }
}
