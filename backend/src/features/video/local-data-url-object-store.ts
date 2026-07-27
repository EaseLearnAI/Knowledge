import { readFile } from "node:fs/promises";
import { extname } from "node:path";
import type { TemporaryObjectStore } from "./tos-object-store.js";

const MIME_BY_EXTENSION: Record<string, string> = {
  ".gif": "image/gif",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".m4a": "audio/mp4",
  ".mp4": "video/mp4",
  ".png": "image/png",
  ".webp": "image/webp",
};

export class LocalDataUrlObjectStore implements TemporaryObjectStore {
  async uploadAndSign(localPath: string): Promise<string> {
    const bytes = await readFile(localPath);
    const mimeType =
      MIME_BY_EXTENSION[extname(localPath).toLowerCase()] ??
      "application/octet-stream";
    return `data:${mimeType};base64,${bytes.toString("base64")}`;
  }

  async delete(): Promise<void> {
    // Data URLs are request-local values and do not create remote objects.
  }
}
