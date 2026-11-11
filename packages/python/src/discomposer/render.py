import re

import discord

from discomposer.format import IMAGE_VARIABLES
from discomposer.variables import fill_variables

BUTTON_STYLES = {
    "primary": discord.ButtonStyle.primary,
    "secondary": discord.ButtonStyle.secondary,
    "success": discord.ButtonStyle.success,
    "danger": discord.ButtonStyle.danger,
}
SEPARATOR_TEXT = "────────"


def button_emoji(value):
    return discord.PartialEmoji.from_str(value) if value else None


def button_style(name):
    return BUTTON_STYLES.get(name or "secondary", discord.ButtonStyle.secondary)


def select_rows(menu, custom_id):
    """Default rendering of a select block.

    Select menu: custom_id as given, values are the option values.
    Buttons: custom_id + ":" + value. Resolve the choice with chosen_options.
    """
    if menu["mode"] == "select":
        select = discord.ui.Select(
            custom_id=custom_id,
            placeholder=menu.get("placeholder"),
            min_values=0 if not menu["exclusive"] else 1,
            max_values=1 if menu["exclusive"] else len(menu["options"]),
            options=[
                discord.SelectOption(
                    label=option["label"],
                    value=option["value"],
                    description=option.get("description"),
                    emoji=button_emoji(option.get("emoji")),
                )
                for option in menu["options"]
            ],
        )
        return [discord.ui.ActionRow(select)]
    buttons = [
        discord.ui.Button(
            label=option["label"],
            custom_id=f"{custom_id}:{option['value']}",
            emoji=button_emoji(option.get("emoji")),
            style=discord.ButtonStyle.secondary,
        )
        for option in menu["options"]
    ]
    return [
        discord.ui.ActionRow(*buttons[start : start + 5]) for start in range(0, len(buttons), 5)
    ]


def render(
    container,
    design,
    *,
    member=None,
    guild=None,
    header=(),
    thumbnail=None,
    accessory=None,
    buttons=None,
    slots=None,
    selects=None,
    variables=None,
):
    """Fill a discord.ui.Container from a validated design.

    header: items added first, e.g. a large image of your own.
    thumbnail: top-right image if the design has no image block.
    accessory: item next to the first text if there is no thumbnail.
    buttons: {id: callable(button) -> discord.ui.Button}; unknown ids are skipped.
    slots: {id: text}; missing slots are skipped.
    selects: callable(select, guild) -> items; select blocks are skipped without it.
    variables: extra variables, e.g. {"{level}": "3"}.
    """
    for item in header:
        container.add_item(item)

    def fill(text):
        return fill_variables(text, member, guild, variables)

    def resolved(url):
        return fill(url) if url in IMAGE_VARIABLES else url

    blocks = design.get("blocks", [])
    image = thumbnail or next((block["image"] for block in blocks if "image" in block), None)
    # {server_icon} resolves to an empty string if the server has no icon.
    image = resolved(image) if image else None

    texts, galleries, links = [], [], []

    def flush_links():
        for start in range(0, len(links), 5):
            container.add_item(discord.ui.ActionRow(*links[start : start + 5]))
        links.clear()

    def flush_text():
        nonlocal image, accessory
        if not texts:
            return
        display = discord.ui.TextDisplay("\n".join(texts))
        texts.clear()
        if image:
            container.add_item(discord.ui.Section(display, accessory=discord.ui.Thumbnail(image)))
            image = None
        elif accessory:
            container.add_item(discord.ui.Section(display, accessory=accessory))
            accessory = None
        else:
            container.add_item(display)

    def flush_gallery():
        if galleries:
            container.add_item(
                discord.ui.MediaGallery(*(discord.MediaGalleryItem(url) for url in galleries[:10]))
            )
            galleries.clear()

    for block in blocks:
        if "link" in block:
            flush_text()
            flush_gallery()
            link = block["link"]
            links.append(
                discord.ui.Button(
                    label=link["label"],
                    url=link["url"],
                    style=discord.ButtonStyle.link,
                    emoji=button_emoji(link.get("emoji")),
                )
            )
            continue
        if "button" in block:
            action = (buttons or {}).get(block["button"]["id"])
            if action:
                flush_text()
                flush_gallery()
                links.append(action(block["button"]))
            continue
        if "select" in block:
            flush_text()
            flush_gallery()
            flush_links()
            if selects:
                for row in selects(block["select"], member.guild if member else guild) or ():
                    container.add_item(row)
            continue
        if "slot" in block:
            flush_links()
            flush_gallery()
            value = (slots or {}).get(block["slot"])
            if value:
                texts.append(value)
            continue
        if "image" not in block:
            flush_links()
        if "gallery" in block:
            flush_text()
            url = resolved(block["gallery"])
            if url:
                galleries.append(url)
            continue
        if "text" in block:
            flush_gallery()
            # Discord only renders headings with a space after the #.
            texts.append(re.sub(r"(?m)^(#{1,3})(?=[^#\s])", r"\1 ", fill(block["text"])))
        elif block.get("separator"):
            flush_gallery()
            texts.append(SEPARATOR_TEXT)
    flush_text()
    flush_gallery()
    flush_links()
    if image:
        container.add_item(
            discord.ui.Section(discord.ui.TextDisplay("​"), accessory=discord.ui.Thumbnail(image))
        )
    return container


def outside_text(design, *, member=None, guild=None, variables=None):
    """The design's content as a TextDisplay placed above the container, or None."""
    content = design.get("content")
    if not content:
        return None
    return discord.ui.TextDisplay(fill_variables(content, member, guild, variables))


def render_message(design, **options):
    """Top-level items of a message: the outside text (if any) and the filled container.

    Takes the same options as render.
    """
    container = render(discord.ui.Container(accent_colour=design.get("color")), design, **options)
    text = outside_text(
        design,
        member=options.get("member"),
        guild=options.get("guild"),
        variables=options.get("variables"),
    )
    return [text, container] if text else [container]
