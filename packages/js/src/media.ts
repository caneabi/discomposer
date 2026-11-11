import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { AttachmentBuilder } from "discord.js";
import type { Design } from "./format.js";

export const MAX_IMAGE = 8 * 1024 * 1024;
const ATTACHMENT_NAME = /^pb-[0-9a-f]{16}\.(?:png|jpg|gif|webp)$/;
const STORED_NAME = /^[0-9a-f]{64}$/;

/** An image can't be stored. The message is meant for end users. */
export class MediaError extends Error {
  override name = "MediaError";
}

/** Detects the format from the bytes. Anything else, including SVG, is rejected. */
export function imageExtension(raw: Uint8Array): string | null {
  const ascii = (from: number, to: number) => String.fromCharCode(...raw.subarray(from, to));
  if (raw[0] === 0x89 && ascii(1, 8) === "PNG\r\n\x1a\n") return "png";
  if (raw[0] === 0xff && raw[1] === 0xd8 && raw[2] === 0xff) return "jpg";
  if (ascii(0, 6) === "GIF87a" || ascii(0, 6) === "GIF89a") return "gif";
  if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "webp";
  return null;
}

/** Stores images by SHA-256 in a folder with a size limit. */
export class MediaStore {
  constructor(
    readonly path: string,
    readonly quota = 128 * 1024 * 1024,
  ) {}

  async save(raw: Uint8Array): Promise<string> {
    if (raw.length > MAX_IMAGE || !imageExtension(raw)) {
      throw new MediaError("Please use a PNG, JPEG, GIF or WebP image up to 8 MB.");
    }
    await mkdir(this.path, { recursive: true });
    const name = createHash("sha256").update(raw).digest("hex");
    const target = join(this.path, name);
    const exists = await stat(target).then(() => true, () => false);
    if (!exists) {
      let used = 0;
      for (const entry of await readdir(this.path, { withFileTypes: true })) {
        if (entry.isFile()) used += (await stat(join(this.path, entry.name))).size;
      }
      if (used + raw.length > this.quota) throw new MediaError("The image store is full. Please clean up old template images.");
      await writeFile(target, raw);
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
