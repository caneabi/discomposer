"""Helpers for ticket bots. Creating and managing tickets stays in your bot."""

import discord

from discomposer.format import chosen_options, selects_for

TICKET_PURPOSE = "ticket_categories"


def ticket_categories(design, purpose=TICKET_PURPOSE):
    """{value: option} for all ticket categories of a stored design."""
    return {
        option["value"]: option
        for menu in selects_for(design, purpose)
        for option in menu["options"]
    }


def chosen_category(design, select_id, value):
    """The chosen category including its roles, looked up in the stored design."""
    options = chosen_options(design, select_id, [value])
    return options[0] if options else None


def category_roles(guild, option):
    """Existing roles of a category, without managed roles and @everyone."""
    roles = []
    for role_id in option.get("roles", []):
        role = guild.get_role(int(role_id))
        if role is not None and not role.is_default() and not role.managed:
            roles.append(role)
    return roles


def missing_roles(guild, design, purpose=TICKET_PURPOSE):
    """Labels of categories whose roles are missing or can't be used."""
    problems = []
    for option in ticket_categories(design, purpose).values():
        if len(category_roles(guild, option)) != len(option.get("roles", [])):
            problems.append(option["label"])
    return problems


def ticket_overwrites(guild, owner, roles=(), *, bot_member=None):
    """Overwrites so that only the owner, the given roles and the bot see the channel."""
    allowed = discord.PermissionOverwrite(
        view_channel=True, send_messages=True, read_message_history=True, attach_files=True
    )
    overwrites = {
        guild.default_role: discord.PermissionOverwrite(view_channel=False),
        owner: allowed,
    }
    for role in roles:
        overwrites[role] = allowed
    me = bot_member or guild.me
    if me is not None:
        overwrites[me] = discord.PermissionOverwrite(
            view_channel=True,
            send_messages=True,
            read_message_history=True,
            attach_files=True,
            manage_channels=True,
        )
    return overwrites


def component_text(items):
    for part in items:
        if part.get("type") == 10:
            yield part.get("content", "")
        yield from component_text(part.get("components", []))
        accessory = part.get("accessory")
        if accessory:
            yield from component_text([accessory])


def transcript_markdown(title, messages, *, details=(), truncated=False):
    """Markdown transcript. details are lines like ("Category", "Support")."""
    lines = [f"# {title}", ""]
    lines += [f"- {key}: {value}" for key, value in details]
    if details:
        lines.append("")
    if truncated:
        lines += ["> Incomplete.", ""]
    for message in messages:
        stamp = message.created_at.strftime("%d.%m.%Y %H:%M")
        lines.append(f"## {message.author.display_name} · {stamp}")
        text = [message.content] if message.content else []
        text += list(component_text([c.to_dict() for c in message.components]))
        for embed in message.embeds:
            text += [part for part in (embed.title, embed.description) if part]
        lines += text or ["*(no text)*"]
        lines += [f"- Attachment: [{a.filename}]({a.url})" for a in message.attachments]
        lines.append("")
    return "\n".join(lines)
