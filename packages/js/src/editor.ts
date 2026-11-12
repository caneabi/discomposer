import { ChannelType, PermissionFlagsBits, type Guild } from "discord.js";
import { CODE_PATTERN, validate, validateDesign, type Context, type Design, type TemplateDocument } from "./format.js";
import { MAX_IMAGE, MediaError, type MediaStore } from "./media.js";
import { readBody } from "./transport.js";

export const DEFAULT_URL = "https://editor.discomposer.dev";
// Only the editor and Discord's CDN are fetched, so templates can't reach internal URLs.
const DISCORD_MEDIA = new Set(["cdn.discordapp.com", "media.discordapp.net"]);
const MAX_RESPONSE = 70 * 1024;
const OFFLINE = "The editor is unavailable right now. Please try again later.";

/** Talking to the editor failed. The message is meant for end users. */
export class EditorError extends Error {
  override name = "EditorError";
}

/** Reads the whole body, failing above `limit` bytes. */
export async function readAll(response: Response, limit: number): Promise<Uint8Array> {
  try {
    return await readBody(response, limit);
  } catch (error) {
    if (error instanceof RangeError) throw new EditorError(error.message);
    throw error;
  }
}

/** Returns the code from a code or an editor link. */
export function parseCode(value: string): string {
  try {
    const path = new URL(String(value).trim(), DEFAULT_URL).pathname;
    const code = path.replace(/\/+$/, "").split("/").pop()!.toUpperCase();
    if (CODE_PATTERN.test(code)) return code;
  } catch {
    // Native URL parsing failed; use the same message as for malformed codes.
  }
  throw new EditorError("That is not a valid code. It looks like this: K7F3M-9QX2A");
}

/** Channels, roles and emojis for the editor. Codes aren't secret, so only public ones. */
export function guildContext(guild: Guild): Pick<Context, "channels" | "roles" | "emojis"> {
  const everyone = guild.roles.everyone;
  const channels = guild.channels.cache.filter(
    (channel) => channel.type === ChannelType.GuildText && channel.permissionsFor(everyone)?.has(PermissionFlagsBits.ViewChannel),
  );
  const roles = guild.roles.cache.filter((role) => role.id !== guild.id && !role.managed).sort((a, b) => b.position - a.position);
  const emojis = guild.emojis.cache.filter((emoji) => emoji.available !== false && Boolean(emoji.name));
  return {
    channels: [...channels.values()].slice(0, 200).map((channel) => ({ id: channel.id, name: channel.name })),
    roles: [...roles.values()].slice(0, 200).map((role) => ({ id: role.id, name: role.name })),
    emojis: [...emojis.values()].slice(0, 200).map((emoji) => ({ id: emoji.id, name: emoji.name!, ...(emoji.animated ? { animated: true } : {}) })),
  };
}

export interface EditorClientOptions {
  baseUrl?: string;
  /** Keeps copies of images; editor images expire after 30 days. */
  media?: MediaStore;
  timeoutMs?: number;
}

/** Client for the template editor. */
export class EditorClient {
  readonly baseUrl: string;
  readonly media?: MediaStore;
  readonly timeoutMs: number;
  private readonly imageUrl: RegExp;

  constructor(options: EditorClientOptions = {}) {
    try {
      const url = new URL(options.baseUrl ?? DEFAULT_URL);
      if (!["https:", "http:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
        throw new Error("Invalid editor URL");
      }
      this.baseUrl = url.href.replace(/\/+$/, "");
    } catch {
      throw new EditorError("The editor URL must be an HTTP(S) URL without credentials, query or fragment.");
    }
    this.media = options.media;
    this.timeoutMs = options.timeoutMs ?? 30_000;
    this.imageUrl = new RegExp(`^${this.baseUrl.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/api/images/[0-9a-f]{64}(?![\\s\\S])`);
  }

  private async request(url: string, init: RequestInit = {}, limit = MAX_RESPONSE): Promise<{ status: number; body: Uint8Array }> {
    try {
      const response = await fetch(url, { ...init, redirect: "manual", signal: AbortSignal.timeout(this.timeoutMs) });
      return { status: response.status, body: await readAll(response, limit) };
    } catch (error) {
      if (error instanceof EditorError) throw error;
      throw new EditorError(OFFLINE);
    }
  }

  private async json(path: string, init: RequestInit = {}): Promise<{ status: number; body: Record<string, unknown> | null }> {
    const { status, body } = await this.request(this.baseUrl + path, init);
    try {
      const parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body));
      return { status, body: parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null };
    } catch {
      throw new EditorError(OFFLINE);
    }
  }

  /** Stores a document and returns the link to edit it. */
  async open(document: TemplateDocument | Record<string, unknown>): Promise<string> {
    const { status, body } = await this.json("/api/templates", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(validate(document)),
    });
    if (status !== 201 || typeof body?.code !== "string" || !CODE_PATTERN.test(body.code)) throw new EditorError(typeof body?.error === "string" ? body.error : OFFLINE);
    return `${this.baseUrl}/e/${body.code}`;
  }

  /** Uploads an image and returns its URL. */
  async upload(raw: Uint8Array): Promise<string> {
    const { status, body } = await this.json("/api/images", {
      method: "POST",
      headers: { "content-type": "application/octet-stream" },
      body: raw as BodyInit,
    });
    if (status !== 201 || typeof body?.path !== "string" || !/^\/api\/images\/[0-9a-f]{64}(?![\s\S])/.test(body.path)) throw new EditorError(typeof body?.error === "string" ? body.error : OFFLINE);
    return this.baseUrl + body.path;
  }

  /** Fetches and validates a document by code or link. */
  async fetchDocument(code: string): Promise<TemplateDocument> {
    const { status, body } = await this.json(`/api/templates/${parseCode(code)}`);
    if (status === 404) throw new EditorError("This code doesn't exist or has expired.");
    if (status !== 200 || !body) throw new EditorError(OFFLINE);
    return validate(body);
  }

  /** Fetches the design of a template; images are adopted if a MediaStore is set. */
  async fetch(code: string, { adoptImages = true } = {}): Promise<Design> {
    const { design } = await this.fetchDocument(code);
    return adoptImages && this.media ? this.adoptImages(design) : design;
  }

  /** Stores editor and Discord images and points the blocks at attachment:// names. */
  async adoptImages(design: Design): Promise<Design> {
    const media = this.media;
    if (!media) throw new EditorError("The client needs a MediaStore to adopt images.");
    const copy: Design = structuredClone(design);
    const attachments: Record<string, string> = { ...copy.attachments };
    const adopted = new Map<string, string>();
    for (const block of copy.blocks as Record<string, unknown>[]) {
      for (const key of ["image", "gallery"]) {
        const value = block[key];
        if (typeof value !== "string") continue;
        const previous = adopted.get(value);
        if (previous) { block[key] = previous; continue; }
        let source: URL;
        try { source = new URL(value); } catch { continue; }
        let raw: Uint8Array;
        if (this.imageUrl.test(source.href)) {
          const { status, body } = await this.request(source.href, {}, MAX_IMAGE);
          if (status !== 200) throw new EditorError("An uploaded image has expired. Please upload it again.");
          raw = body;
        } else if (source.protocol === "https:" && DISCORD_MEDIA.has(source.hostname)) {
          const { status, body } = await this.request(source.href, {}, MAX_IMAGE).catch(() => {
            throw new EditorError("An image could not be loaded. Please upload it in the editor.");
          });
          if (status !== 200) throw new EditorError("A Discord image has expired. Please upload it again in the editor.");
          raw = body;
        } else continue;
        let stored: string;
        try {
          stored = await media.save(raw);
        } catch (error) {
          throw new EditorError(error instanceof MediaError ? error.message : OFFLINE);
        }
        const name = media.attachmentName(stored, raw);
        attachments[name] = stored;
        block[key] = `attachment://${name}`;
        adopted.set(value, block[key] as string);
      }
    }
    if (Object.keys(attachments).length) copy.attachments = attachments;
    return copy;
  }

  /** Reverse of adoptImages: uploads stored attachments so the editor can show them. */
  async exposeAttachments(design: Design): Promise<Design> {
    const { attachments = {}, ...rest } = structuredClone(design);
    const uploaded = new Map<string, string>();
    for (const block of rest.blocks as Record<string, unknown>[]) {
      for (const key of ["image", "gallery"]) {
        const value = block[key];
        if (typeof value === "string" && value.startsWith("attachment://")) {
          const stored = attachments[value.slice("attachment://".length)];
          if (!stored || !this.media) throw new EditorError("An image of this template is missing.");
          let url = uploaded.get(stored);
          if (!url) {
            url = await this.upload(await this.media.read(stored));
            uploaded.set(stored, url);
          }
          block[key] = url;
        }
      }
    }
    return validateDesign(rest);
  }
}
