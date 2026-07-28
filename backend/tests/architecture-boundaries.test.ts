import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const backendRoot = resolve(import.meta.dirname, "..");
const sourceRoot = resolve(backendRoot, "src");

describe("architecture boundaries", () => {
  it("keeps the legacy flat entrypoints and feature buckets removed", () => {
    const removedPaths = [
      "app.ts",
      "server.ts",
      "worker.ts",
      "config.ts",
      "features",
      "shared",
    ];

    for (const removedPath of removedPaths) {
      expect(existsSync(resolve(sourceRoot, removedPath)), removedPath).toBe(false);
    }
  });

  it("keeps provider selection inside the composition root", () => {
    const httpApp = readFileSync(
      resolve(sourceRoot, "bootstrap/create-http-app.ts"),
      "utf8",
    );
    const worker = readFileSync(
      resolve(sourceRoot, "bootstrap/create-worker.ts"),
      "utf8",
    );

    expect(httpApp).not.toMatch(/process\.env\.(VIDEO|COPYWRITER|ASR|OBJECT)/);
    expect(worker).not.toContain("createHttpApp");
  });
});
