<h1 align="center">discomposer for discord.py</h1>

<p align="center">
  Validate, fetch and send Discord message templates as Components V2.<br>
  Design the message in the <a href="https://editor.discomposer.dev">visual editor</a>, send it from your bot with a code.
</p>

[Website](https://discomposer.dev) · [Editor](https://editor.discomposer.dev) · [Documentation](https://docs.discomposer.dev)

<p align="center">
  <a href="https://pypi.org/project/discomposer/"><img src="https://img.shields.io/pypi/v/discomposer?color=7b61ff" alt="PyPI"></a>
  <a href="https://pypi.org/project/discomposer/"><img src="https://img.shields.io/pypi/pyversions/discomposer?color=7b61ff" alt="Python versions"></a>
  <a href="https://github.com/caneabi/discomposer/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-MIT-ff7a59" alt="MIT license"></a>
</p>

discomposer only builds messages. What a button or selection does (open a ticket, hand out a role) stays in your bot.

## Install

```bash
pip install discomposer
```

Requires Python 3.11+ and discord.py 2.6+.

## Fetch a template and send it

```python
import discord
from discomposer import EditorClient, MediaStore, render_message, select_rows

editor = EditorClient(media=MediaStore("data/media"))

async def send(channel, code):
    design = await editor.fetch(code)  # validates and copies editor/Discord CDN images
    view = discord.ui.LayoutView(timeout=None)
    for item in render_message(
        design,
        guild=channel.guild,
        buttons={"ticket": lambda b: discord.ui.Button(label=b["label"], custom_id="mybot:ticket")},
        slots={"online": "12 members online"},
        selects=lambda menu, guild: select_rows(menu, f"mybot:{menu['id']}"),
    ):
        view.add_item(item)
    await channel.send(view=view, files=editor.media.files_for(design))
```

`render_message` returns the text outside the box (if any) and the filled container. Use `render` to fill a container you created yourself.

## Offer your bot's features in the editor

```python
from discomposer import guild_context

link = await editor.open({
    "title": "Ticket panel",
    "context": {
        **guild_context(guild),
        "buttons": [{"id": "ticket", "label": "Open ticket"}],
        "selects": [{"purpose": "ticket_categories", "label": "Ticket categories", "roles": "optional"}],
    },
    "design": {"blocks": [{"text": "## Support"}]},
})
```

The person designs the message at `link` and gives your bot the new code.

## Handle a selection

Values and roles only ever come from the stored template, never from the interaction:

```python
from discomposer import category_roles, chosen_category, ticket_overwrites

option = chosen_category(saved_design, "tickets", interaction.data["values"][0])
if option:
    roles = category_roles(guild, option)
    channel = await guild.create_text_channel(
        f"ticket-{interaction.user.name}",
        overwrites=ticket_overwrites(guild, interaction.user, roles),
    )
```

## Use your own editor

```python
editor = EditorClient(
    base_url="https://your-editor.example",
    media=MediaStore("data/media"),
)
```

Shared links supply a code; they never change the configured host. Your editor
implements the same open [HTTP protocol](https://github.com/caneabi/discomposer/blob/main/spec/API.md).
The template format and bot library are independent of the closed-source hosted
frontend. A reusable backend is available through the JS package's
`discomposer/server` entry point; it serves both bot libraries.

## API overview

| Area | Functions |
| --- | --- |
| Format | `validate`, `validate_design`, `find_select`, `selects_for`, `chosen_options` |
| Sending | `render`, `render_message`, `outside_text`, `select_rows`, `fill_variables`, `VARIABLES` |
| Editor | `EditorClient` (`open`, `fetch`, `fetch_document`, `upload`, `adopt_images`, `expose_attachments`, `open_message`), `guild_context`, `parse_code` |
| Images | `MediaStore` (`save`, `files_for`) |
| Tickets | `ticket_categories`, `chosen_category`, `category_roles`, `missing_roles`, `ticket_overwrites`, `transcript_markdown` |

Errors: `TemplateError` (format), `EditorError` (editor, network), `MediaError` (images). Messages are written for end users.

The template format is specified in [spec/FORMAT.md](https://github.com/caneabi/discomposer/blob/main/spec/FORMAT.md). A JavaScript version for discord.js is available as [`discomposer` on npm](https://www.npmjs.com/package/discomposer).

discomposer is not affiliated with or endorsed by Discord Inc.



Use one MediaStore instance per directory. Saves through that instance serialize
quota checks and publish complete files through an atomic rename. Separate processes
sharing a directory need coordination supplied by the application.


Image adoption copies editor uploads and Discord CDN images. Other HTTPS image URLs
remain external references and depend on their host remaining available.
