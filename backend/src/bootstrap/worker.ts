import "dotenv/config";
import { createProcessingWorker } from "./create-worker.js";
import { loadConfig } from "../platform/config/app-config.js";
import { connectDatabase, disconnectDatabase } from "../platform/database/mongoose.js";
import { createLogger } from "../platform/observability/logger.js";

const config = loadConfig();
const logger = createLogger(config);

async function main(): Promise<void> {
  if (config.workerMode !== "worker") {
    throw new Error("独立 Worker 必须配置 WORKER_MODE=worker");
  }
  await connectDatabase(config.mongodbUri, logger);
  const runner = createProcessingWorker(config, logger);
  await runner.recoverPending();
  runner.startPolling(config.workerPollIntervalMs);
  logger.info(
    {
      event: "worker.started",
      pollIntervalMs: config.workerPollIntervalMs,
    },
    "Memo 视频 Worker 已启动",
  );

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ event: "worker.shutdown", signal }, "开始优雅关闭 Worker");
    runner.stopPolling();
    await runner.whenIdle();
    await disconnectDatabase(logger);
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((error: unknown) => {
  logger.fatal({ event: "worker.start_failed", error }, "Worker 启动失败");
  process.exit(1);
});
