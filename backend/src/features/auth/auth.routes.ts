import { Router } from "express";
import type { AppConfig } from "../../config.js";
import { sendSuccess } from "../../shared/http/response.js";
import { validate } from "../../shared/http/validate.js";
import { requireAuth } from "../../shared/security/auth.middleware.js";
import {
  changePasswordSchema,
  deleteAccountSchema,
  loginSchema,
  refreshSchema,
  registerSchema,
} from "./auth.schemas.js";
import {
  changePassword,
  deleteAccount,
  getCurrentUser,
  login,
  logout,
  refreshSession,
  register,
} from "./auth.service.js";

export function createAuthRouter(config: AppConfig): Router {
  const router = Router();

  router.post("/register", validate(registerSchema), async (request, response) => {
    sendSuccess(response, await register(request.body, config), 201);
  });

  router.post("/login", validate(loginSchema), async (request, response) => {
    sendSuccess(response, await login(request.body, config));
  });

  router.post("/refresh", validate(refreshSchema), async (request, response) => {
    sendSuccess(response, await refreshSession(request.body.refreshToken, config));
  });

  router.post("/logout", validate(refreshSchema), async (request, response) => {
    await logout(request.body.refreshToken);
    response.status(204).send();
  });

  router.get("/me", requireAuth(config), async (request, response) => {
    sendSuccess(response, await getCurrentUser(request.auth!.userId));
  });

  router.patch(
    "/me/password",
    requireAuth(config),
    validate(changePasswordSchema),
    async (request, response) => {
      sendSuccess(
        response,
        await changePassword(request.auth!.userId, request.body, config),
      );
    },
  );

  router.delete(
    "/me",
    requireAuth(config),
    validate(deleteAccountSchema),
    async (request, response) => {
      await deleteAccount(request.auth!.userId, request.body);
      response.status(204).send();
    },
  );

  return router;
}
