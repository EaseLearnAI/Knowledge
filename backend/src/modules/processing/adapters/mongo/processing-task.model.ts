import { model, Schema, type Types } from "mongoose";
import type {
  AnalysisMode,
  ContentKind,
  VideoLanguage,
  VideoQuality,
} from "../../domain/video.types.js";

export type TaskStatus = "queued" | "processing" | "completed" | "failed";

export type TaskLog = {
  timestamp: Date;
  level: "info" | "warn" | "error";
  event: string;
  message: string;
  data?: Record<string, unknown>;
};

export type ProcessingTaskRecord = {
  userId: Types.ObjectId;
  sourceItemId: Types.ObjectId;
  inputType: "url" | "upload";
  source: string;
  originalFilename?: string;
  quality: VideoQuality;
  language: VideoLanguage;
  idempotencyKey: string;
  status: TaskStatus;
  stage: string;
  progress: number;
  contentKind?: ContentKind;
  analysisMode?: AnalysisMode;
  attempts: number;
  leaseOwner?: string;
  leaseUntil?: Date;
  logs: TaskLog[];
  error?: {
    code: string;
    message: string;
  };
  startedAt?: Date;
  completedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
};

const taskLogSchema = new Schema<TaskLog>(
  {
    timestamp: { type: Date, required: true },
    level: { type: String, enum: ["info", "warn", "error"], required: true },
    event: { type: String, required: true },
    message: { type: String, required: true },
    data: { type: Schema.Types.Mixed },
  },
  { _id: false },
);

const processingTaskSchema = new Schema<ProcessingTaskRecord>(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    sourceItemId: {
      type: Schema.Types.ObjectId,
      ref: "SourceItem",
      required: true,
      index: true,
    },
    inputType: { type: String, enum: ["url", "upload"], required: true },
    source: { type: String, required: true },
    originalFilename: String,
    quality: {
      type: String,
      enum: ["fast", "balanced", "accurate"],
      default: "balanced",
    },
    language: { type: String, enum: ["zh", "en", "ja", "auto"], default: "zh" },
    idempotencyKey: { type: String, required: true },
    status: {
      type: String,
      enum: ["queued", "processing", "completed", "failed"],
      default: "queued",
      index: true,
    },
    stage: { type: String, default: "queued" },
    progress: { type: Number, min: 0, max: 100, default: 0 },
    contentKind: {
      type: String,
      enum: ["image_post", "short_video", "long_video"],
    },
    analysisMode: {
      type: String,
      enum: ["minimax_m3_multimodal", "asr_then_summary"],
    },
    attempts: { type: Number, min: 0, default: 0 },
    leaseOwner: String,
    leaseUntil: Date,
    logs: { type: [taskLogSchema], default: [] },
    error: {
      code: String,
      message: String,
    },
    startedAt: Date,
    completedAt: Date,
  },
  { timestamps: true, collection: "processing_tasks" },
);

processingTaskSchema.index({ userId: 1, idempotencyKey: 1 }, { unique: true });
processingTaskSchema.index({ status: 1, leaseUntil: 1, createdAt: 1 });

export const ProcessingTaskModel = model<ProcessingTaskRecord>(
  "ProcessingTask",
  processingTaskSchema,
);
