import { model, Schema } from "mongoose";

export type UserRecord = {
  email?: string;
  phone?: string;
  passwordHash: string;
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
    passwordHash: { type: String, required: true, select: false },
    nickname: { type: String, required: true, trim: true, maxlength: 40 },
  },
  { timestamps: true, collection: "users" },
);

export const UserModel = model<UserRecord>("User", userSchema);
