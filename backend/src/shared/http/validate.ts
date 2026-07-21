import type { NextFunction, Request, Response } from "express";
import { AppError } from "../errors/app-error.js";

type ValidationResult =
  | { success: true; data: unknown }
  | { success: false; error: { issues: unknown[] } };

type ValidationSchema = {
  safeParse(value: unknown): ValidationResult;
};

export function validate(
  schema: ValidationSchema,
  source: "body" | "params" | "query" = "body",
) {
  return (request: Request, _response: Response, next: NextFunction): void => {
    const result = schema.safeParse(request[source]);
    if (!result.success) {
      next(new AppError(422, "VALIDATION_ERROR", "请求参数不符合要求", result.error.issues));
      return;
    }
    Object.assign(request[source], result.data);
    next();
  };
}
