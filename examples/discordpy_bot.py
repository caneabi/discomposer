"""Minimal discord.py bot: /design opens the editor, /send fetches a code and sends the message.

Run: set DISCORD_TOKEN as an environment variable, then `python discordpy_bot.py`.
"""

import os

import discord
from discord import app_commands
from discomposer import (
    EditorClient,
    EditorError,
    MediaStore,
    TemplateError,
    chosen_options,
    guild_context,
    render,
    select_rows,
)

client = discord.Client(intents=discord.Intents.default())
tree = app_commands.CommandTree(client)
editor = EditorClient(media=MediaStore("data/media"))
saved = {}  # message id -> stored design. A real bot keeps this in a database.


@tree.command(description="Opens the editor with this server's roles.")
async def design(interaction: discord.Interaction):
    link = await editor.open(
        {
            "title": "Role picker",
            "context": {
                **guild_context(interaction.guild),
                "selects": [{"purpose": "role_picker", "label": "Role picker", "roles": "single"}],
            },
            "design": {"blocks": [{"text": "## Roles\nPick what you are interested in."}]},
        }
    )
    await interaction.response.send_message(link, ephemeral=True)


@tree.command(description="Sends a template from the editor.")
async def send(interaction: discord.Interaction, code: str):
    try:
        design = await editor.fetch(code)
    except (EditorError, TemplateError) as error:
        await interaction.response.send_message(str(error), ephemeral=True)
        return
    view = discord.ui.LayoutView(timeout=None)
    container = discord.ui.Container(accent_colour=design.get("color"))
    render(
        container,
        design,
        guild=interaction.guild,
        selects=lambda menu, guild: select_rows(menu, f"demo:{menu['id']}"),
    )
    view.add_item(container)
    await interaction.response.send_message("Sent.", ephemeral=True)
    message = await interaction.channel.send(view=view, files=editor.media.files_for(design))
    saved[message.id] = design


@client.event
async def on_interaction(interaction: discord.Interaction):
    custom_id = (interaction.data or {}).get("custom_id", "")
    design = saved.get(getattr(interaction.message, "id", None))
    if not custom_id.startswith("demo:") or design is None:
        return
    _, select_id, *value = custom_id.split(":")
    values = interaction.data.get("values") or value
    # Roles only come from the stored template, never from the interaction.
    roles = [
        role
        for option in chosen_options(design, select_id, values)
        for role in (interaction.guild.get_role(int(r)) for r in option.get("roles", []))
        if role and not role.managed and not role.is_default()
    ]
    await interaction.user.add_roles(*roles, reason="Role picker")
    await interaction.response.send_message(
        "Done: " + ", ".join(r.name for r in roles), ephemeral=True
    )


@client.event
async def on_ready():
    await tree.sync()


client.run(os.environ["DISCORD_TOKEN"])
