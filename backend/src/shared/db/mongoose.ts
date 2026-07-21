import mongoose from "mongoose";
import type { AppLogger } from "../logger/logger.js";

export async function connectDatabase(uri: string, logger: AppLogger): Promise<void> {
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 5_000 });
  logger.info({ event: "database.connected", database: mongoose.connection.name }, "MongoDB 已连接");
}

export async function disconnectDatabase(logger?: AppLogger): Promise<void> {
  await mongoose.disconnect();
  logger?.info({ event: "database.disconnected" }, "MongoDB 已断开");
}

export function databaseReady(): boolean {
  return mongoose.connection.readyState === 1;
}
