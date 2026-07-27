import "dotenv/config";
import { createServer } from "node:http";
import { createApp } from "./app.js";
import { loadConfig } from "./config.js";
import { connectDatabase, disconnectDatabase } from "./shared/db/mongoose.js";
import { createLogger } from "./shared/logger/logger.js";

const config = loadConfig();
const logger = createLogger(config);

async function main(): Promise<void> {
  if (config.workerMode === "worker") {
    throw new Error("WORKER_MODE=worker 必须使用 npm run worker 启动");
  }
  await connectDatabase(config.mongodbUri, logger);
  const { app, runner } = createApp({ config, logger });
  if (config.workerMode === "embedded") await runner.recoverPending();
  const server = createServer(app);

  server.listen(config.port, config.host, () => {
    logger.info(
      {
        event: "server.started",
        url: `http://${config.host}:${config.port}`,
        terminal: config.enableWebTerminal
          ? `http://${config.host}:${config.port}/terminal`
          : "disabled",
      },
      "Memo 后端已启动",
    );
  });

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ event: "server.shutdown", signal }, "开始优雅关闭");
    server.close();
    runner.stopPolling();
    await runner.whenIdle();
    await disconnectDatabase(logger);
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((error: unknown) => {
  logger.fatal({ event: "server.start_failed", error }, "服务器启动失败");
  process.exit(1);
});
