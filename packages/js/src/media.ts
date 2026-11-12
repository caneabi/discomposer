import { createHash, randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { AttachmentBuilder } from "discord.js";
import type { Design } from "./format.js";

import { MAX_IMAGE, imageExtension } from "./image.js";
export { MAX_IMAGE, imageExtension } from "./image.js";
const ATTACHMENT_NAME = /^pb-[0-9a-f]{16}\.(?:png|jpg|gif|webp)(?![\s\S])/;
const STORED_NAME = /^[0-9a-f]{64}(?![\s\S])/;

/** An image can't be stored. The message is meant for end users. */
export class MediaError extends Error {
  override name = "MediaError";
}

/** Stores images by SHA-256 in a folder with a size limit. */
export class MediaStore {
  private pending: Promise<unknown> = Promise.resolve();

  constructor(
    readonly path: string,
    readonly quota = 128 * 1024 * 1024,
  ) {}

  save(raw: Uint8Array): Promise<string> {
    const task = this.pending.then(() => this.saveImage(raw));
    // A failed write must not poison subsequent saves.
    this.pending = task.catch(() => {});
    return task;
  }

  private async saveImage(raw: Uint8Array): Promise<string> {
    if (raw.length > MAX_IMAGE || !imageExtension(raw)) {
      throw new MediaError("Please use a PNG, JPEG, GIF or WebP image up to 8 MB.");
    }
    await mkdir(this.path, { recursive: true });
    const name = createHash("sha256").update(raw).digest("hex");
    const target = join(this.path, name);
    const exists = await stat(target).then(() => true, (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return false;
      throw error;
    });
    if (!exists) {
      let used = 0;
      for (const entry of await readdir(this.path, { withFileTypes: true })) {
        if (entry.isFile()) used += (await stat(join(this.path, entry.name))).size;
      }
      if (used + raw.length > this.quota) throw new MediaError("The image store is full. Please clean up old template images.");
      const temporary = join(this.path, "." + randomUUID() + ".tmp");
      try {
        await writeFile(temporary, raw, { flag: "wx" });
        await rename(temporary, target);
      } finally {
        await unlink(temporary).catch((error: NodeJS.ErrnoException) => {
          if (error.code !== "ENOENT") throw error;
        });
      }
    }
    return name;
  }

  file(stored: string): string {
    if (!STORED_NAME.test(stored)) throw new MediaError("Invalid stored image name.");
    return join(this.path, stored);
  }

  read(stored: string): Promise<Buffer> {
    return readFile(this.file(stored));
  }

  attachmentName(stored: string, raw: Uint8Array): string {
    return `pb-${stored.slice(0, 16)}.${imageExtension(raw)}`;
  }

  /** AttachmentBuilders for all adopted images of a design. */
  filesFor(design: Design): AttachmentBuilder[] {
    return Object.entries(design.attachments ?? {}).map(([name, stored]) => {
      if (!ATTACHMENT_NAME.test(name)) throw new MediaError("Invalid stored image name.");
      return new AttachmentBuilder(this.file(stored), { name });
    });
  }
}
