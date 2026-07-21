import { model, Schema, type Types } from "mongoose";
import type {
  CopywritingResult,
  TranscriptSegment,
} from "./video.types.js";

export type SourceItemRecord = {
  userId: Types.ObjectId;
  taskId?: Types.ObjectId;
  type: "video" | "audio";
  platform: string;
  url?: string;
  title: string;
  status: "processing" | "completed" | "failed";
  transcript?: {
    text: string;
    segments: TranscriptSegment[];
    path: string;
    provider: string;
  };
  copywriting?: CopywritingResult;
  tags: string[];
  capturedAt: Date;
  version: number;
  deletedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
};

const segmentSchema = new Schema<TranscriptSegment>(
  {
    startMs: { type: Number, required: true },
    endMs: { type: Number, required: true },
    text: { type: String, required: true },
  },
  { _id: false },
);

const sourceItemSchema = new Schema<SourceItemRecord>(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    taskId: { type: Schema.Types.ObjectId, ref: "ProcessingTask", index: true },
    type: { type: String, enum: ["video", "audio"], required: true },
    platform: { type: String, required: true },
    url: String,
    title: { type: String, required: true },
    status: {
      type: String,
      enum: ["processing", "completed", "failed"],
      default: "processing",
      index: true,
    },
    transcript: {
      text: String,
      segments: { type: [segmentSchema], default: undefined },
      path: String,
      provider: String,
    },
    copywriting: { type: Schema.Types.Mixed },
    tags: { type: [String], default: [] },
    capturedAt: { type: Date, default: Date.now },
    version: { type: Number, default: 1 },
    deletedAt: Date,
  },
  { timestamps: true, collection: "source_items" },
);

sourceItemSchema.index({ userId: 1, createdAt: -1 });
sourceItemSchema.index({ userId: 1, title: "text", "transcript.text": "text", tags: "text" });

export const SourceItemModel = model<SourceItemRecord>("SourceItem", sourceItemSchema);
