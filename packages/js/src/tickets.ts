// Helpers for ticket bots. Creating and managing tickets stays in your bot.
import { PermissionFlagsBits, type Guild, type GuildMember, type Message, type OverwriteResolvable, type Role } from "discord.js";
import { chosenOptions, selectsFor, type Design, type SelectOption } from "./format.js";

export const TICKET_PURPOSE = "ticket_categories";

/** value -> option for all ticket categories of a stored design. */
export function ticketCategories(design: Design, purpose = TICKET_PURPOSE): Map<string, SelectOption> {
  return new Map(selectsFor(design, purpose).flatMap((menu) => menu.options.map((option) => [option.value, option] as const)));
}

/** The chosen category including its roles, looked up in the stored design. */
export function chosenCategory(design: Design, selectId: string, value: string): SelectOption | undefined {
  return chosenOptions(design, selectId, [value])[0];
}

/** Existing roles of a category, without managed roles and @everyone. */
export function categoryRoles(guild: Guild, option: SelectOption): Role[] {
  return (option.roles ?? []).flatMap((id) => {
    const role = guild.roles.cache.get(id);
    return role && role.id !== guild.id && !role.managed ? [role] : [];
  });
}

/** Labels of categories whose roles are missing or can't be used. */
export function missingRoles(guild: Guild, design: Design, purpose = TICKET_PURPOSE): string[] {
  return [...ticketCategories(design, purpose).values()]
    .filter((option) => categoryRoles(guild, option).length !== (option.roles ?? []).length)
    .map((option) => option.label);
}

/** Overwrites so that only the owner, the given roles and the bot see the channel. */
export function ticketOverwrites(guild: Guild, owner: GuildMember, roles: Role[] = [], botMember = guild.members.me): OverwriteResolvable[] {
  const allow = [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.AttachFiles];
  const overwrites: OverwriteResolvable[] = [
    { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
    { id: owner.id, allow },
    ...roles.map((role) => ({ id: role.id, allow })),
  ];
  if (botMember) overwrites.push({ id: botMember.id, allow: [...allow, PermissionFlagsBits.ManageChannels] });
  return overwrites;
}

function* componentText(items: unknown[]): Generator<string> {
  for (const part of items as Record<string, unknown>[]) {
    if (part.type === 10 && typeof part.content === "string") yield part.content;
    if (Array.isArray(part.components)) yield* componentText(part.components);
    if (part.accessory) yield* componentText([part.accessory]);
  }
}

const pad = (value: number) => String(value).padStart(2, "0");
const stamp = (date: Date) => `${pad(date.getDate())}.${pad(date.getMonth() + 1)}.${date.getFullYear()} ${pad(date.getHours())}:${pad(date.getMinutes())}`;

/** Markdown transcript. details are lines like ["Category", "Support"]. */
export function transcriptMarkdown(title: string, messages: Message[], { details = [] as [string, string][], truncated = false } = {}): string {
  const lines = [`# ${title}`, ""];
  for (const [key, value] of details) lines.push(`- ${key}: ${value}`);
  if (details.length) lines.push("");
  if (truncated) lines.push("> Incomplete.", "");
  for (const message of messages) {
    lines.push(`## ${message.member?.displayName ?? message.author.displayName} · ${stamp(message.createdAt)}`);
    const text = message.content ? [message.content] : [];
    text.push(...componentText(message.components.map((component) => component.toJSON())));
    for (const embed of message.embeds) text.push(...[embed.title, embed.description].filter((part): part is string => Boolean(part)));
    lines.push(...(text.length ? text : ["*(no text)*"]));
    for (const attachment of message.attachments.values()) lines.push(`- Attachment: [${attachment.name}](${attachment.url})`);
    lines.push("");
  }
  return lines.join("\n");
}
