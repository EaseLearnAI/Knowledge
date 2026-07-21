import { Router } from "express";
import type { AppConfig } from "../../config.js";
import { AppError } from "../../shared/errors/app-error.js";
import { terminalEventBus } from "../../shared/logger/event-bus.js";

export function createTerminalRouter(config: AppConfig): Router {
  const router = Router();

  router.get("/logs/stream", (request, response) => {
    if (!config.enableWebTerminal) {
      throw new AppError(404, "WEB_TERMINAL_DISABLED", "Web 终端未启用");
    }
    if (request.query.token !== config.webTerminalToken) {
      throw new AppError(401, "TERMINAL_TOKEN_INVALID", "Web 终端令牌无效");
    }
    response.setHeader("Content-Type", "text/event-stream");
    response.setHeader("Cache-Control", "no-cache");
    response.setHeader("Connection", "keep-alive");
    response.flushHeaders();

    for (const event of terminalEventBus.recent(200)) {
      response.write(`id: ${event.id}\ndata: ${JSON.stringify(event)}\n\n`);
    }
    const listener = (event: { id: number }) => {
      response.write(`id: ${event.id}\ndata: ${JSON.stringify(event)}\n\n`);
    };
    terminalEventBus.on("terminal-event", listener);
    const heartbeat = setInterval(() => response.write(": heartbeat\n\n"), 20_000);
    request.on("close", () => {
      clearInterval(heartbeat);
      terminalEventBus.off("terminal-event", listener);
    });
  });

  return router;
}
