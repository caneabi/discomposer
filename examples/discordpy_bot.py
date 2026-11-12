"""Minimal role picker: /design configures a panel, /send imports and publishes it.

Set DISCORD_TOKEN in the environment, then run python discordpy_bot.py.
"""

import os

import discord
from discord import app_commands

from discomposer import (
    EditorClient,
    EditorError,
    MediaError,
    MediaStore,
    TemplateError,
    chosen_options,
    find_select,
    guild_context,
    render_message,
    select_rows,
    selects_for,
)

client = discord.Client(intents=discord.Intents.default())
tree = app_commands.CommandTree(client)
editor = EditorClient(media=MediaStore("data/media"))
saved = {}  # message id -> design; persist this in a real bot.


def can_offer_role(member, role):
    bot = member.guild.me
    return (
        role is not None and bot is not None and bot.guild_permissions.manage_roles
        and role.is_assignable()
        and (member.id == member.guild.owner_id or member.top_role > role)
    )


async def configure(interaction):
    # Default command permissions can be overridden in Discord, so check at execution too.
    if interaction.guild is None or not interaction.permissions.manage_roles:
        await interaction.response.send_message(
            "Manage Roles in this server is required.", ephemeral=True
        )
        return False
    await interaction.response.defer(ephemeral=True)
    return True


@tree.command(description="Opens the role picker editor.")
@app_commands.guild_only()
@app_commands.default_permissions(manage_roles=True)
async def design(interaction: discord.Interaction):
    if not await configure(interaction):
        return
    context = guild_context(interaction.guild)
    context["roles"] = [
        role for role in context["roles"]
        if can_offer_role(interaction.user, interaction.guild.get_role(int(role["id"])))
    ]
    try:
        link = await editor.open({
            "title": "Role picker",
            "context": {
                **context,
                "selects": [{"purpose": "role_picker", "label": "Role picker", "roles": "single"}],
            },
            "design": {"blocks": [{"text": "## Roles\nPick what you are interested in."}]},
        })
    except (EditorError, TemplateError) as error:
        await interaction.edit_original_response(content=str(error))
        return
    await interaction.edit_original_response(content=link)


@tree.command(description="Publishes a role picker from the editor.")
@app_commands.guild_only()
@app_commands.default_permissions(manage_roles=True)
async def send(interaction: discord.Interaction, code: str):
    if not await configure(interaction):
        return
    try:
        design = await editor.fetch(code)
        # A shared code is untrusted, even if the bot opened the editor previously.
        for menu in selects_for(design, "role_picker"):
            for option in menu["options"]:
                roles = option.get("roles", [])
                if (
                    len(roles) != 1 or option["value"] != roles[0]
                    or not can_offer_role(
                        interaction.user, interaction.guild.get_role(int(roles[0]))
                    )
                ):
                    raise TemplateError(
                        "Every option must use one role that you and the bot can manage."
                    )
        view = discord.ui.LayoutView(timeout=None)
        for item in render_message(
            design,
            guild=interaction.guild,
            selects=lambda menu, _: (
                select_rows(menu, f"demo:{menu['id']}") if menu["purpose"] == "role_picker" else []
            ),
        ):
            view.add_item(item)
        message = await interaction.channel.send(
            view=view, files=editor.media.files_for(design),
            allowed_mentions=discord.AllowedMentions.none(),
        )
    except (EditorError, TemplateError, MediaError) as error:
        await interaction.edit_original_response(content=str(error))
        return
    except discord.DiscordException:
        await interaction.edit_original_response(content="The message could not be sent.")
        return
    saved[message.id] = design
    await interaction.edit_original_response(content="Sent.")


@client.event
async def on_interaction(interaction: discord.Interaction):
    if interaction.guild is None:
        return
    custom_id = (interaction.data or {}).get("custom_id", "")
    design = saved.get(getattr(interaction.message, "id", None))
    if not custom_id.startswith("demo:") or design is None:
        return
    _, select_id, *value = custom_id.split(":")
    if (find_select(design, select_id) or {}).get("purpose") != "role_picker":
        return
    values = interaction.data.get("values", value)
    roles = [
        role
        for option in chosen_options(design, select_id, values)
        for role in (interaction.guild.get_role(int(r)) for r in option.get("roles", []))
        if role and role.is_assignable()
    ]
    await interaction.response.defer(ephemeral=True)
    try:
        if roles:
            await interaction.user.add_roles(*roles, reason="Role picker")
    except discord.DiscordException:
        await interaction.edit_original_response(content="The roles could not be assigned.")
        return
    await interaction.edit_original_response(
        content="Done: " + ", ".join(role.name for role in roles) if roles else "No roles selected."
    )


@client.event
async def on_ready():
    await tree.sync()


client.run(os.environ["DISCORD_TOKEN"])
