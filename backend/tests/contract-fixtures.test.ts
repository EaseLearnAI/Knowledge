import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const contractRoot = resolve("../contracts");

describe("根级 API 契约", () => {
  it("提供 OpenAPI v1 单一事实源", async () => {
    const openapi = await readFile(
      resolve(contractRoot, "openapi/memo-v1.yaml"),
      "utf8",
    );
    expect(openapi).toContain("openapi: 3.1.0");
    expect(openapi).toContain("/api/v1/captures:");
    expect(openapi).toContain("/api/v1/items:");
  });

  it.each([
    "fixtures/v1/auth/session.json",
    "fixtures/v1/capture/task-processing.json",
    "fixtures/v1/capture/task-failed.json",
    "fixtures/v1/library/items.json",
    "fixtures/v1/error/unauthorized.json",
  ])("Fixture 可以被解析：%s", async (relativePath) => {
    const fixture = await readFile(resolve(contractRoot, relativePath), "utf8");
    expect(() => JSON.parse(fixture)).not.toThrow();
  });
});
