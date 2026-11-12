// Validation and normalization of the template format (spec/FORMAT.md).

export const MAX_BLOCKS = 20;
export const MAX_BYTES = 64 * 1024;
// Unlike $, the final assertion rejects trailing line breaks.
export const CODE_PATTERN = /^[0-9A-HJKMNP-TV-Z]{5}-[0-9A-HJKMNP-TV-Z]{5}(?![\s\S])/;
export const MAX_TEXT = 3500;
export const IMAGE_VARIABLES = ["{server_icon}", "{server_banner}"] as const;
export const BUTTON_STYLES = ["primary", "secondary", "success", "danger"] as const;
export const SELECT_MODES = ["select", "buttons"] as const;
export const ROLE_MODES = ["none", "optional", "single"] as const;

export type ButtonStyleName = (typeof BUTTON_STYLES)[number];
export type SelectMode = (typeof SELECT_MODES)[number];

export interface SelectOption {
  value: string;
  label: string;
  emoji?: string;
  description?: string;
  roles?: string[];
}
export interface Select {
  id: string;
  purpose: string;
  mode: SelectMode;
  exclusive: boolean;
  placeholder?: string;
  options: SelectOption[];
}
export interface Button {
  id: string;
  label: string;
  style: ButtonStyleName;
  emoji?: string;
}
export interface Link {
  label: string;
  url: string;
  emoji?: string;
}
export type Block =
  | { text: string }
  | { image: string }
  | { gallery: string }
  | { separator: true }
  | { slot: string }
  | { button: Button }
  | { link: Link }
  | { select: Select };
export interface Design {
  blocks: Block[];
  /** Text above the container, e.g. for pings. */
  content?: string;
  color?: number;
  keepBotImage?: "large" | "small";
  /** Set by adoptImages: attachment filename -> stored name. */
  attachments?: Record<string, string>;
}
export interface SelectOffer {
  purpose: string;
  label: string;
  roles: (typeof ROLE_MODES)[number];
  modes?: SelectMode[];
  exclusive?: boolean;
  hint?: string;
}
export interface Context {
  channels?: { id: string; name: string }[];
  roles?: { id: string; name: string }[];
  emojis?: { id: string; name: string; animated?: boolean }[];
  buttons?: { id: string; label: string; sample?: string; icon?: string }[];
  slots?: { id: string; label: string; sample?: string }[];
  selects?: SelectOffer[];
  accessory?: string;
  footer?: { label?: string; rows: string[][] };
}
export interface TemplateDocument {
  version?: 1;
  kind?: string;
  title?: string;
  template?: string;
  note?: string;
  returnHint?: string;
  messageType?: "general" | "member";
  sender?: { name: string; avatar?: string };
  context?: Context;
  design: Design;
}

/** The template violates the format. The message is meant for end users. */
export class TemplateError extends Error {
  override name = "TemplateError";
}

const SLUG = /^[A-Za-z0-9_-]{1,64}(?![\s\S])/;
const SNOWFLAKE = /^\d{17,20}(?![\s\S])/;
const CUSTOM_EMOJI = /^<a?:\w{1,32}:\d{17,20}>(?![\s\S])/;
const DOCUMENT_KEYS = new Set(["version", "kind", "title", "template", "note", "returnHint", "sender", "messageType", "context", "design"]);

type Json = Record<string, unknown>;
const isObject = (value: unknown): value is Json => typeof value === "object" && value !== null && !Array.isArray(value);
const missing = (value: unknown) => value === undefined || value === null || value === "";

function text(value: unknown, limit: number, message: string, required = false): string | undefined {
  if ((value === undefined || value === null) && !required) return undefined;
  if (typeof value !== "string" || value.length > limit || (required && !value.trim())) throw new TemplateError(message);
  return value;
}

function slug(value: unknown, message: string): string {
  if (typeof value !== "string" || !SLUG.test(value)) throw new TemplateError(message);
  return value;
}

function roles(value: unknown, limit: number, message: string): string[] {
  if (!Array.isArray(value) || value.length > limit) throw new TemplateError(message);
  for (const role of value) if (typeof role !== "string" || !SNOWFLAKE.test(role)) throw new TemplateError(message);
  return [...new Set(value as string[])];
}

/** A custom emoji (<:name:id>) or a short Unicode emoji without letters. */
export function cleanEmoji(value: unknown): string | undefined {
  if (missing(value)) return undefined;
  if (typeof value === "string" && CUSTOM_EMOJI.test(value)) return value;
  const valid = typeof value === "string" && value.length > 0 && value.length <= 16 && !/[\s\p{L}<>]/u.test(value);
  if (!valid) throw new TemplateError("An emoji is invalid.");
  return value as string;
}

export function httpsUrl(value: unknown): string {
  if (typeof value !== "string" || value.length > 2048) throw new TemplateError("Invalid URL.");
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new TemplateError("Images and links need a public HTTPS URL.");
  }
  if (url.protocol !== "https:" || !url.hostname || url.username || url.password) {
    throw new TemplateError("Images and links need a public HTTPS URL.");
  }
  return value;
}

export function imageSource(value: unknown): string {
  return (IMAGE_VARIABLES as readonly unknown[]).includes(value) ? (value as string) : httpsUrl(value);
}

function optional<T extends Json>(entry: T, source: Json, key: string, clean: (value: unknown) => unknown) {
  if (!missing(source[key])) (entry as Json)[key] = clean(source[key]);
}

export function cleanSelect(menu: unknown): Select {
  if (!isObject(menu)) throw new TemplateError("Invalid selection.");
  const id = slug(menu.id, "Invalid selection.");
  const purpose = slug(menu.purpose, "Invalid selection.");
  if (!(SELECT_MODES as readonly unknown[]).includes(menu.mode) || typeof menu.exclusive !== "boolean") {
    throw new TemplateError("Invalid selection.");
  }
  const options = menu.options;
  if (!Array.isArray(options) || options.length < 1 || options.length > 25) throw new TemplateError("A selection needs 1 to 25 options.");
  const seen = new Set<string>();
  const cleaned = options.map((option) => {
    if (!isObject(option)) throw new TemplateError("Invalid option.");
    const value = slug(option.value, "Every option needs a unique value.");
    if (seen.has(value)) throw new TemplateError("Every option needs a unique value.");
    seen.add(value);
    const entry: SelectOption = { value, label: text(option.label, 80, "Every option needs a label.", true)! };
    optional(entry as unknown as Json, option, "emoji", cleanEmoji);
    optional(entry as unknown as Json, option, "description", (v) => text(v, 100, "The description is too long."));
    if (option.roles !== undefined && option.roles !== null) entry.roles = roles(option.roles, 10, "An option contains invalid roles.");
    return entry;
  });
  const result: Select = { id, purpose, mode: menu.mode as SelectMode, exclusive: menu.exclusive, options: cleaned };
  optional(result as unknown as Json, menu, "placeholder", (v) => text(v, 150, "The placeholder is too long."));
  return result;
}

function cleanButton(item: unknown): Button {
  if (!isObject(item)) throw new TemplateError("Invalid button.");
  const style = (item.style || "secondary") as ButtonStyleName;
  if (!BUTTON_STYLES.includes(style)) throw new TemplateError("Invalid button.");
  const button: Button = { id: slug(item.id, "Invalid button."), label: text(item.label, 80, "Invalid button.", true)!, style };
  optional(button as unknown as Json, item, "emoji", cleanEmoji);
  return button;
}

function cleanLink(item: unknown): Link {
  if (!isObject(item)) throw new TemplateError("Link buttons need a label and an HTTPS URL.");
  const link: Link = { label: text(item.label, 80, "Link buttons need a label.", true)!, url: httpsUrl(item.url) };
  optional(link as unknown as Json, item, "emoji", cleanEmoji);
  return link;
}

export function cleanBlock(block: unknown): Block {
  if (!isObject(block) || Object.keys(block).length !== 1) throw new TemplateError("Invalid block.");
  const [[key, item]] = Object.entries(block);
  if (key === "text" && typeof item === "string") return { text: item };
  if (key === "image") return { image: imageSource(item) };
  if (key === "gallery") return { gallery: imageSource(item) };
  if (key === "slot") return { slot: slug(item, "Invalid dynamic block.") };
  if (key === "separator" && item === true) return { separator: true };
  if (key === "button") return { button: cleanButton(item) };
  if (key === "link") return { link: cleanLink(item) };
  if (key === "select") return { select: cleanSelect(item) };
  throw new TemplateError("Unknown block.");
}

/** Validates a design and returns a cleaned copy. */
export function validateDesign(design: unknown): Design {
  if (!isObject(design) || !Array.isArray(design.blocks)) throw new TemplateError("Invalid template.");
  if (design.blocks.length > MAX_BLOCKS) throw new TemplateError(`At most ${MAX_BLOCKS} blocks.`);
  const ids = new Set<string>();
  const blocks = design.blocks.map((block) => {
    const cleaned = cleanBlock(block);
    if ("select" in cleaned) {
      if (ids.has(cleaned.select.id)) throw new TemplateError("Every selection needs its own ID.");
      ids.add(cleaned.select.id);
    }
    return cleaned;
  });
  const content = text(design.content, 2000, "The outside text is too long.");
  const length = blocks.reduce((sum, block) => sum + ("text" in block ? block.text.length : 0), content?.length ?? 0);
  if (length > MAX_TEXT) throw new TemplateError(`At most ${MAX_TEXT} characters of text.`);
  const result: Design = { blocks };
  if (content) result.content = content;
  const color = design.color;
  if (color !== undefined && color !== null) {
    if (!Number.isInteger(color) || (color as number) < 0 || (color as number) > 0xffffff) throw new TemplateError("Invalid accent color.");
    result.color = color as number;
  }
  const keep = design.keepBotImage;
  if (keep !== undefined && keep !== null) {
    if (keep !== "large" && keep !== "small") throw new TemplateError("Invalid image setting.");
    result.keepBotImage = keep;
  }
  return result;
}

function cleanFooter(footer: unknown): Context["footer"] {
  if (!isObject(footer) || !Array.isArray(footer.rows)) throw new TemplateError("Invalid context.");
  if (footer.rows.length > 5 || footer.rows.some((row) => !Array.isArray(row) || row.length > 5)) throw new TemplateError("Invalid context.");
  const result: NonNullable<Context["footer"]> = { rows: (footer.rows as unknown[][]).map((row) => row.map(httpsUrl)) };
  optional(result as unknown as Json, footer, "label", (v) => text(v, 100, "Invalid context."));
  return result;
}

function cleanContext(context: unknown): Context {
  if (!isObject(context)) throw new TemplateError("Invalid context.");
  const fail = "Invalid context.";
  const result: Json = {};
  for (const [key, items] of Object.entries(context)) {
    if (key === "accessory") {
      result[key] = slug(items, fail);
      continue;
    }
    if (key === "footer") {
      result[key] = cleanFooter(items);
      continue;
    }
    if (!["channels", "roles", "emojis", "buttons", "slots", "selects"].includes(key)) throw new TemplateError(fail);
    if (!Array.isArray(items) || items.length > (key === "selects" ? 20 : 200)) throw new TemplateError(fail);
    result[key] = items.map((item) => {
      if (!isObject(item)) throw new TemplateError(fail);
      if (key === "selects") {
        const entry: Json = { purpose: slug(item.purpose, fail), label: text(item.label, 80, fail, true), roles: item.roles || "none" };
        if (!(ROLE_MODES as readonly unknown[]).includes(entry.roles)) throw new TemplateError(fail);
        if (item.modes !== undefined && item.modes !== null) {
          const modes = item.modes;
          if (!Array.isArray(modes) || !modes.length || modes.some((mode) => !(SELECT_MODES as readonly unknown[]).includes(mode))) throw new TemplateError(fail);
          entry.modes = modes;
        }
        if (item.exclusive !== undefined && item.exclusive !== null) {
          if (typeof item.exclusive !== "boolean") throw new TemplateError(fail);
          entry.exclusive = item.exclusive;
        }
        optional(entry, item, "hint", (v) => text(v, 300, fail));
        return entry;
      }
      if (key === "buttons" || key === "slots") {
        const entry: Json = { id: slug(item.id, fail), label: text(item.label, 80, fail, true) };
        optional(entry, item, "sample", (v) => text(v, 1000, fail));
        if (item.icon !== undefined && item.icon !== null) {
          if (key !== "buttons") throw new TemplateError(fail);
          entry.icon = httpsUrl(item.icon);
        }
        return entry;
      }
      if (typeof item.id !== "string" || !SNOWFLAKE.test(item.id)) throw new TemplateError(fail);
      const name = text(item.name, 100, fail, true)!;
      if (key === "emojis" && !/^\w{2,32}(?![\s\S])/.test(name)) throw new TemplateError(fail);
      const entry: Json = { id: item.id, name };
      if (key === "emojis" && item.animated === true) entry.animated = true;
      return entry;
    });
  }
  return result as Context;
}

/** Validates a whole document and returns a cleaned copy. Throws TemplateError. */
export function validate(document: unknown): TemplateDocument {
  if (!isObject(document) || Object.keys(document).some((key) => !DOCUMENT_KEYS.has(key))) throw new TemplateError("Invalid template.");
  if (document.version !== undefined && document.version !== null && document.version !== 1) throw new TemplateError("Unknown format version.");
  const result: Json = {};
  for (const [key, limit] of [["kind", 80], ["title", 80], ["template", 80], ["note", 300], ["returnHint", 300]] as const) {
    if (document[key] !== undefined && document[key] !== null) result[key] = text(document[key], limit, "Invalid template.");
  }
  if (document.version === 1) result.version = 1;
  if (![undefined, null, "general", "member"].includes(document.messageType as string)) throw new TemplateError("Invalid message type.");
  if (document.messageType) result.messageType = document.messageType;
  if (document.sender !== undefined && document.sender !== null) {
    const sender = document.sender;
    if (!isObject(sender)) throw new TemplateError("Invalid sender.");
    const cleaned: Json = { name: text(sender.name, 80, "Invalid sender.", true) };
    if (sender.avatar !== undefined && sender.avatar !== null) cleaned.avatar = httpsUrl(sender.avatar);
    result.sender = cleaned;
  }
  if (document.context !== undefined && document.context !== null) result.context = cleanContext(document.context);
  result.design = validateDesign(document.design);
  return result as unknown as TemplateDocument;
}

export function findSelect(design: Design, selectId: string): Select | undefined {
  for (const block of design.blocks) if ("select" in block && block.select.id === selectId) return block.select;
  return undefined;
}

export function selectsFor(design: Design, purpose: string): Select[] {
  return design.blocks.flatMap((block) => ("select" in block && block.select.purpose === purpose ? [block.select] : []));
}

/** Options matching the chosen values. Always pass the stored design, never interaction data. */
export function chosenOptions(design: Design, selectId: string, values: Iterable<string>): SelectOption[] {
  const menu = findSelect(design, selectId);
  if (!menu) return [];
  const wanted = new Set(values);
  return menu.options.filter((option) => wanted.has(option.value));
}
