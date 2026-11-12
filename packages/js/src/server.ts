import { CODE_PATTERN, MAX_BYTES, TemplateError, validate } from "./format.js";
import { MAX_IMAGE, imageExtension } from "./image.js";
import { readBody } from "./transport.js";

export const RETENTION_SECONDS = 30 * 24 * 60 * 60;
const REFRESH_AFTER_MS = 24 * 60 * 60 * 1000;
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });
const JSON_HEADERS = {
  "content-type": "application/json",
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
  "content-security-policy": "default-src 'none'; frame-ancestors 'none'",
};

export interface StoredValue {
  value: Uint8Array;
  savedAt: number;
  contentType?: string;
}

/** Implementations must enforce expiry and reserve new keys atomically. */
export interface TemplateStore {
  get(key: string): Promise<StoredValue | null>;
  put(key: string, entry: StoredValue, ttlSeconds: number): Promise<void>;
  /** Return false if the key already exists; never overwrite another template. */
  create(key: string, entry: StoredValue, ttlSeconds: number): Promise<boolean>;
}

export interface TemplateServerOptions {
  store: TemplateStore;
  /** Return false to reject a write. Production hosts should use an atomic limiter. */
  allowWrite?: (request: Request, kind: "template" | "image") => Promise<boolean>;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

function newCode(): string {
  const code = Array.from(crypto.getRandomValues(new Uint8Array(10)), (byte) => ALPHABET[byte & 31]).join("");
  return code.slice(0, 5) + "-" + code.slice(5);
}

/** Fetch-compatible template/image API. Storage and access policy belong to the host. */
export class TemplateServer {
  private readonly store: TemplateStore;
  private readonly allowWrite?: TemplateServerOptions["allowWrite"];

  constructor({ store, allowWrite }: TemplateServerOptions) {
    this.store = store;
    this.allowWrite = allowWrite;
  }

  /** defer can be a worker's waitUntil; without it, expiry refreshes are awaited. */
  async fetch(request: Request, defer?: (task: Promise<void>) => void): Promise<Response> {
    const response = await this.respond(request, defer);
    return request.method === "HEAD" && response.body ? new Response(null, response) : response;
  }

  private async respond(request: Request, defer?: (task: Promise<void>) => void): Promise<Response> {
    try {
      const path = new URL(request.url).pathname;
      if (request.method === "POST" && (path === "/api/templates" || path === "/api/images")) {
        return await this.create(request, path === "/api/images");
      }
      const match = path.match(/^\/api\/(templates|images)\/([^/]+)$/);
      if (match && (request.method === "GET" || (match[1] === "images" && request.method === "HEAD"))) {
        return await this.read(match[1] === "images", match[2], request.method === "HEAD", defer);
      }
      return json({ error: "Not found." }, 404);
    } catch (error) {
      if (error instanceof TemplateError) return json({ error: error.message }, 400);
      // Storage failures must not leak provider errors to callers. No automatic write retries.
      return json({ error: "The editor is unavailable right now. Please try again later." }, 503);
    }
  }

  private async create(request: Request, image: boolean): Promise<Response> {
    if (!image && request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") {
      return json({ error: "Please send JSON." }, 415);
    }
    // Rate-limit before consuming potentially large request bodies.
    if (this.allowWrite && !await this.allowWrite(request, image ? "image" : "template")) {
      return json({ error: image
        ? "Too many images in a short time. Please try again later."
        : "Too many templates in a short time. Please try again later." }, 429);
    }
    let bytes: Uint8Array;
    try {
      bytes = await readBody(request, image ? MAX_IMAGE : MAX_BYTES);
    } catch (error) {
      if (!(error instanceof RangeError)) throw error;
      return json({ error: image ? "The image may be at most 8 MB." : "The template is too large." }, 413);
    }
    if (image) {
      const extension = imageExtension(bytes);
      if (!extension) return json({ error: "Please upload a PNG, JPEG, GIF or WebP image." }, 415);
      const hash = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
      const id = Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, "0")).join("");
      const key = "image:" + id;
      const existing = await this.store.get(key);
      if (!existing || Date.now() - existing.savedAt > REFRESH_AFTER_MS) {
        try {
          await this.store.put(key, {
            value: bytes, savedAt: Date.now(), contentType: "image/" + (extension === "jpg" ? "jpeg" : extension),
          }, RETENTION_SECONDS);
        } catch (error) {
          // An identical upload can already exist despite an ambiguous write error.
          // Confirm that fact with a read; never repeat the write.
          const stored = await this.store.get(key);
          if (!stored || Date.now() - stored.savedAt > REFRESH_AFTER_MS) throw error;
        }
      }
      return json({ path: "/api/images/" + id }, 201);
    }
    let document: unknown;
    try {
      document = JSON.parse(decoder.decode(bytes));
    } catch {
      return json({ error: "Invalid template." }, 400);
    }
    const value = encoder.encode(JSON.stringify(validate(document)));
    // Collisions may be retried; ambiguous storage failures must propagate.
    for (let attempt = 0; attempt < 5; attempt++) {
      const code = newCode();
      if (await this.store.create("code:" + code, { value, savedAt: Date.now() }, RETENTION_SECONDS)) {
        return json({ code }, 201);
      }
    }
    return json({ error: "The editor is unavailable right now. Please try again later." }, 503);
  }

  private async read(image: boolean, id: string, head: boolean, defer?: (task: Promise<void>) => void): Promise<Response> {
    if (!image) id = id.toUpperCase();
    if (!(image ? /^[0-9a-f]{64}(?![\s\S])/ : CODE_PATTERN).test(id)) {
      return json({ error: image ? "Invalid image." : "Invalid code." }, 400);
    }
    const key = (image ? "image:" : "code:") + id;
    const entry = await this.store.get(key);
    if (!entry) return json({ error: image
      ? "This image doesn't exist or has expired."
      : "This code doesn't exist or has expired." }, 404);
    if (Date.now() - entry.savedAt > REFRESH_AFTER_MS) {
      const refresh = this.store.put(key, { ...entry, savedAt: Date.now() }, RETENTION_SECONDS);
      if (defer) defer(refresh);
      else await refresh;
    }
    return new Response(head ? null : entry.value as BodyInit, { headers: image ? {
      "content-type": entry.contentType ?? "application/octet-stream",
      "cache-control": "public, max-age=86400",
      "x-content-type-options": "nosniff",
      "content-security-policy": "default-src 'none'; sandbox",
      "content-disposition": "inline",
      "cross-origin-resource-policy": "cross-origin",
    } : JSON_HEADERS });
  }
}
