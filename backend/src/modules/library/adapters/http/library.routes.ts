import { Router } from "express";
import type { AppConfig } from "../../../../platform/config/app-config.js";
import { sendSuccess } from "../../../../platform/http/response.js";
import { validate } from "../../../../platform/http/validate.js";
import { requireAuth } from "../../../../platform/security/auth.middleware.js";
import {
  deleteItem,
  getItem,
  listItems,
  updateItem,
} from "../../application/library.service.js";
import {
  itemIdSchema,
  listItemsQuerySchema,
  updateItemSchema,
} from "./library.schemas.js";

export function createLibraryRouter(config: AppConfig): Router {
  const router = Router();
  router.use(requireAuth(config));

  router.get(
    "/items",
    validate(listItemsQuerySchema, "query"),
    async (request, response) => {
      const result = await listItems(request.auth!.userId, request.query as never);
      sendSuccess(response, result.items, 200, {
        page: Number(request.query.page),
        pageSize: Number(request.query.pageSize),
        total: result.total,
      });
    },
  );

  router.patch(
    "/items/:id",
    validate(itemIdSchema, "params"),
    validate(updateItemSchema),
    async (request, response) => {
      sendSuccess(
        response,
        await updateItem(
          request.auth!.userId,
          String(request.params.id),
          request.body,
        ),
      );
    },
  );

  router.get(
    "/items/:id",
    validate(itemIdSchema, "params"),
    async (request, response) => {
      sendSuccess(
        response,
        await getItem(request.auth!.userId, String(request.params.id)),
      );
    },
  );

  router.delete(
    "/items/:id",
    validate(itemIdSchema, "params"),
    async (request, response) => {
      await deleteItem(request.auth!.userId, String(request.params.id));
      response.status(204).send();
    },
  );

  return router;
}
