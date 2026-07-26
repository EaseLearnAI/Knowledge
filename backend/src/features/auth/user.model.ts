import { model, Schema } from "mongoose";

export type UserRecord = {
  email?: string;
  phone?: string;
  installationId?: string;
  accountType: "guest" | "registered";
  passwordHash?: string;
  nickname: string;
  createdAt: Date;
  updatedAt: Date;
};

const userSchema = new Schema<UserRecord>(
  {
    email: {
      type: String,
      trim: true,
      lowercase: true,
      unique: true,
      sparse: true,
      index: true,
    },
    phone: {
      type: String,
      trim: true,
      unique: true,
      sparse: true,
      index: true,
    },
    installationId: {
      type: String,
      trim: true,
      unique: true,
      sparse: true,
      index: true,
      select: false,
    },
    accountType: {
      type: String,
      enum: ["guest", "registered"],
      default: "registered",
      required: true,
    },
    passwordHash: { type: String, select: false },
    nickname: { type: String, required: true, trim: true, maxlength: 40 },
  },
  { timestamps: true, collection: "users" },
);

export const UserModel = model<UserRecord>("User", userSchema);
