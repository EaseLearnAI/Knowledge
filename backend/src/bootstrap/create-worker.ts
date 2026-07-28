import { VideoTaskRunner } from "../modules/processing/application/task-runner.js";
import type { AppConfig } from "../platform/config/app-config.js";
import type { AppLogger } from "../platform/observability/logger.js";
import { createProcessingContainer } from "./create-container.js";

export function createProcessingWorker(
  config: AppConfig,
  logger: AppLogger,
): VideoTaskRunner {
  const { processor, copywriter } = createProcessingContainer(config);
  return new VideoTaskRunner(processor, copywriter, logger, {
    enabled: true,
    leaseSeconds: config.workerLeaseSeconds,
    maxAttempts: config.workerMaxAttempts,
  });
}
