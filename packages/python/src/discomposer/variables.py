import re

import discord

MEMBER_KEYS = (
    "{username}",
    "{nickname}",
    "{user}",
    "{mention}",
    "{member_since}",
    "{member_number}",
    "{early_bird}",
)
VARIABLES = {
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
}


def _safe(text):
    return discord.utils.escape_mentions(discord.utils.escape_markdown(text))


UNKNOWN = "unknown"


def _number(value):
    return f"{value:,}"


def _percent(value):
    return f"{value:.1f}%"


def member_rank(member, guild):
    """Position by join date, or None while the member list isn't fully cached."""
    if member.joined_at is None or not guild.chunked:
        return None
    return 1 + sum(
        1 for other in guild.members if other.joined_at and other.joined_at < member.joined_at
    )


def member_values(member, guild):
    values = {
        "{username}": _safe(member.name),
        "{nickname}": _safe(member.display_name),
        "{user}": _safe(member.display_name),
        "{mention}": member.mention,
    }
    joined = member.joined_at
    values["{member_since}"] = f"<t:{int(joined.timestamp())}:D>" if joined else UNKNOWN
    rank = member_rank(member, guild)
    total = len(guild.members)
    if rank is None or not total:
        values["{member_number}"] = values["{early_bird}"] = UNKNOWN
    else:
        values["{member_number}"] = _number(rank)
        values["{early_bird}"] = _percent((total - rank) / total * 100)
    return values


def variable_values(member=None, guild=None):
    server = member.guild if member else guild
    values = dict.fromkeys(MEMBER_KEYS, "")
    if server:
        values.update(
            {
                "{server}": _safe(server.name),
                "{member_count}": (
                    _number(server.member_count) if server.member_count is not None else UNKNOWN
                ),
                "{timestamp}": f"<t:{int(discord.utils.utcnow().timestamp())}:f>",
                "{server_icon}": str(server.icon.url) if server.icon else "",
                "{server_banner}": str(server.banner.url) if server.banner else "",
            }
        )
    if member:
        values.update(member_values(member, server))
    return values


def fill_variables(text, member=None, guild=None, extra=None):
    """Replace variables. Unknown values stay unknown instead of being guessed."""
    values = variable_values(member, guild)
    if extra:
        values.update(extra)
    return re.sub(r"\{\w+\}", lambda match: values.get(match[0], match[0]), text)
