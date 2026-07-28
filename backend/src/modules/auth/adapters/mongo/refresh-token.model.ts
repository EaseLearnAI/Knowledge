import { model, Schema, type Types } from "mongoose";

export type RefreshTokenRecord = {
  userId: Types.ObjectId;
  tokenHash: string;
  expiresAt: Date;
  revokedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
};

const refreshTokenSchema = new Schema<RefreshTokenRecord>(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    tokenHash: { type: String, required: true, unique: true, index: true },
    expiresAt: { type: Date, required: true, index: { expires: 0 } },
    revokedAt: Date,
  },
  { timestamps: true, collection: "refresh_tokens" },
);

export const RefreshTokenModel = model<RefreshTokenRecord>("RefreshToken", refreshTokenSchema);
