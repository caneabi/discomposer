import { ChannelType, PermissionFlagsBits, type Guild } from "discord.js";
import { validate, validateDesign, type Context, type Design, type TemplateDocument } from "./format.js";
import { MAX_IMAGE, MediaError, type MediaStore } from "./media.js";

export const DEFAULT_URL = "https://editor.caneabi.dev";
// Only the editor and Discord's CDN are fetched, so templates can't reach internal URLs.
const DISCORD_MEDIA = new Set(["cdn.discordapp.com", "media.discordapp.net"]);
const CODE = /^[0-9A-HJKMNP-TV-Z]{5}-[0-9A-HJKMNP-TV-Z]{5}$/;
const MAX_RESPONSE = 70 * 1024;
const OFFLINE = "The editor is unavailable right now. Please try again later.";

/** Talking to the editor failed. The message is meant for end users. */
export class EditorError extends Error {
  override name = "EditorError";
}

/** Reads the whole body, failing above `limit` bytes. */
export async function readAll(response: Response, limit: number): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let size = 0;
  if (response.body) {
    for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
      size += chunk.length;
      if (size > limit) throw new EditorError("The response is too large.");
      chunks.push(chunk);
    }
  }
  const data = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    data.set(chunk, offset);
    offset += chunk.length;
  }
  return data;
}

/** Returns the code from a code or an editor link. */
export function parseCode(value: string): string {
  const code = String(value).trim().replace(/\/+$/, "").split("/").pop()!.toUpperCase();
  if (!CODE.test(code)) throw new EditorError("That is not a valid code. It looks like this: K7F3M-9QX2A");
  return code;
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
    this.baseUrl = (options.baseUrl ?? DEFAULT_URL).replace(/\/+$/, "");
    this.media = options.media;
    this.timeoutMs = options.timeoutMs ?? 30_000;
    this.imageUrl = new RegExp(`^${this.baseUrl.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/api/images/[0-9a-f]{64}$`);
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
      const parsed = JSON.parse(new TextDecoder().decode(body));
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
    if (status !== 201 || typeof body?.code !== "string") throw new EditorError(typeof body?.error === "string" ? body.error : OFFLINE);
    return `${this.baseUrl}/e/${body.code}`;
  }

  /** Uploads an image and returns its URL. */
  async upload(raw: Uint8Array): Promise<string> {
    const { status, body } = await this.json("/api/images", {
      method: "POST",
      headers: { "content-type": "application/octet-stream" },
      body: raw as BodyInit,
    });
    if (status !== 201 || typeof body?.path !== "string") throw new EditorError(typeof body?.error === "string" ? body.error : OFFLINE);
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
    for (const block of copy.blocks as Record<string, unknown>[]) {
      for (const key of ["image", "gallery"]) {
        const value = block[key];
        if (typeof value !== "string") continue;
        let raw: Uint8Array;
        if (this.imageUrl.test(value)) {
          const { status, body } = await this.request(value, {}, MAX_IMAGE);
          if (status !== 200) throw new EditorError("An uploaded image has expired. Please upload it again.");
          raw = body;
        } else if (value.startsWith("https://") && DISCORD_MEDIA.has(new URL(value).hostname)) {
          const { status, body } = await this.request(value, {}, MAX_IMAGE).catch(() => {
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
      }
    }
    if (Object.keys(attachments).length) copy.attachments = attachments;
    return copy;
  }

  /** Reverse of adoptImages: uploads stored attachments so the editor can show them. */
  async exposeAttachments(design: Design): Promise<Design> {
    const { attachments = {}, ...rest } = structuredClone(design);
    for (const block of rest.blocks as Record<string, unknown>[]) {
      for (const key of ["image", "gallery"]) {
        const value = block[key];
        if (typeof value === "string" && value.startsWith("attachment://")) {
          const stored = attachments[value.slice("attachment://".length)];
          if (!stored || !this.media) throw new EditorError("An image of this template is missing.");
          block[key] = await this.upload(await this.media.read(stored));
        }
      }
    }
    return validateDesign(rest);
  }
}
