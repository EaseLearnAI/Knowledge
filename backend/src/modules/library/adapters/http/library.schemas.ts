import { z } from "zod";

export const itemIdSchema = z.object({
  id: z.string().regex(/^[a-f\d]{24}$/i, "ID 格式不正确"),
});

export const listItemsQuerySchema = z.object({
  status: z.enum(["processing", "completed", "failed"]).optional(),
  q: z.string().trim().max(100).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export const updateItemSchema = z
  .object({
    tags: z.array(z.string().trim().min(1).max(50)).max(20).optional(),
    isFavorite: z.boolean().optional(),
  })
  .refine(
    (value) => value.tags !== undefined || value.isFavorite !== undefined,
    "至少提供 tags 或 isFavorite",
  );
