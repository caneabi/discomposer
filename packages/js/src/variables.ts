import { escapeMarkdown, type Guild, type GuildMember } from "discord.js";

export const VARIABLES: Record<string, string> = {
  "{user}": "Display name",
  "{username}": "Username",
  "{nickname}": "Server nickname",
  "{mention}": "Mention",
  "{member_since}": "Join date",
  "{member_number}": "Member number by join date",
  "{early_bird}": "Share of members who joined later",
  "{server}": "Server name",
  "{member_count}": "Member count",
  "{timestamp}": "Time of sending",
  "{server_icon}": "Server icon (image)",
  "{server_banner}": "Server banner (image)",
};
const MEMBER_KEYS = ["{username}", "{nickname}", "{user}", "{mention}", "{member_since}", "{member_number}", "{early_bird}"];
const UNKNOWN = "unknown";

const safe = (text: string) => escapeMarkdown(text).replace(/@(everyone|here)/g, "@​$1");
const number = (value: number) => value.toLocaleString("en-US");
const percent = (value: number) => `${value.toFixed(1)}%`;
const seconds = (date: Date) => Math.floor(date.getTime() / 1000);

/** Position by join date, or null while the member list isn't fully cached. */
export function memberRank(member: GuildMember, guild: Guild): number | null {
  if (!member.joinedAt || guild.members.cache.size < guild.memberCount) return null;
  const joined = member.joinedAt.getTime();
  return 1 + guild.members.cache.filter((other) => other.joinedAt !== null && other.joinedAt.getTime() < joined).size;
}

function memberValues(member: GuildMember, guild: Guild): Record<string, string> {
  const values: Record<string, string> = {
    "{username}": safe(member.user.username),
    "{nickname}": safe(member.displayName),
    "{user}": safe(member.displayName),
    "{mention}": `<@${member.id}>`,
    "{member_since}": member.joinedAt ? `<t:${seconds(member.joinedAt)}:D>` : UNKNOWN,
  };
  const rank = memberRank(member, guild);
  const total = guild.memberCount;
  if (rank === null || !total) {
    values["{member_number}"] = values["{early_bird}"] = UNKNOWN;
  } else {
    values["{member_number}"] = number(rank);
    values["{early_bird}"] = percent(((total - rank) / total) * 100);
  }
  return values;
}

export function variableValues(member?: GuildMember | null, guild?: Guild | null): Record<string, string> {
  const server = member?.guild ?? guild ?? null;
  const values: Record<string, string> = Object.fromEntries(MEMBER_KEYS.map((key) => [key, ""]));
  if (server) {
    Object.assign(values, {
      "{server}": safe(server.name),
      "{member_count}": Number.isFinite(server.memberCount) ? number(server.memberCount) : UNKNOWN,
      "{timestamp}": `<t:${seconds(new Date())}:f>`,
      "{server_icon}": server.iconURL() ?? "",
      "{server_banner}": server.bannerURL() ?? "",
    });
  }
  if (member && server) Object.assign(values, memberValues(member, server));
  return values;
}

/** Replaces variables. Unknown values stay unknown instead of being guessed. */
export function fillVariables(text: string, member?: GuildMember | null, guild?: Guild | null, extra?: Record<string, string>): string {
  const values = { ...variableValues(member, guild), ...extra };
  return text.replace(/\{\w+\}/g, (match) => values[match] ?? match);
}
