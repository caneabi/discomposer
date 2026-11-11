"""Validation and normalization of the template format (spec/FORMAT.md)."""

import re
from urllib.parse import urlsplit

MAX_BLOCKS = 20
MAX_TEXT = 3500
IMAGE_VARIABLES = ("{server_icon}", "{server_banner}")
BUTTON_STYLES = ("primary", "secondary", "success", "danger")
SELECT_MODES = ("select", "buttons")
ROLE_MODES = ("none", "optional", "single")
SLUG = re.compile(r"[A-Za-z0-9_-]{1,64}")
SNOWFLAKE = re.compile(r"\d{17,20}")
CUSTOM_EMOJI = re.compile(r"<a?:\w{1,32}:\d{17,20}>")
DOCUMENT_KEYS = {
    "version",
    "kind",
    "title",
    "template",
    "note",
    "returnHint",
    "sender",
    "messageType",
    "context",
    "design",
}


class TemplateError(ValueError):
    """The template violates the format. The message is meant for end users."""


def _text(value, limit, message, *, required=False):
    if value is None and not required:
        return None
    if not isinstance(value, str) or len(value) > limit or (required and not value.strip()):
        raise TemplateError(message)
    return value


def clean_emoji(value):
    """A custom emoji (<:name:id>) or a short Unicode emoji without letters."""
    if value is None or value == "":
        return None
    if isinstance(value, str) and CUSTOM_EMOJI.fullmatch(value):
        return value
    valid = (
        isinstance(value, str)
        and 0 < len(value) <= 16
        and not any(char.isspace() or char.isalpha() or char in "<>" for char in value)
    )
    if not valid:
        raise TemplateError("An emoji is invalid.")
    return value


def https_url(value):
    if not isinstance(value, str) or len(value) > 2048:
        raise TemplateError("Invalid URL.")
    url = urlsplit(value)
    if url.scheme != "https" or not url.hostname or url.username or url.password:
        raise TemplateError("Images and links need a public HTTPS URL.")
    return value


def image_source(value):
    return value if value in IMAGE_VARIABLES else https_url(value)


def _slug(value, message):
    if not isinstance(value, str) or not SLUG.fullmatch(value):
        raise TemplateError(message)
    return value


def _roles(value, limit, message):
    if not isinstance(value, list) or len(value) > limit:
        raise TemplateError(message)
    for role in value:
        if not isinstance(role, str) or not SNOWFLAKE.fullmatch(role):
            raise TemplateError(message)
    return list(dict.fromkeys(value))


def _optional(entry, source, key, cleaner):
    value = source.get(key)
    if value not in (None, ""):
        entry[key] = cleaner(value)


def clean_select(menu):
    if not isinstance(menu, dict):
        raise TemplateError("Invalid selection.")
    select_id = _slug(menu.get("id"), "Invalid selection.")
    purpose = _slug(menu.get("purpose"), "Invalid selection.")
    if menu.get("mode") not in SELECT_MODES or not isinstance(menu.get("exclusive"), bool):
        raise TemplateError("Invalid selection.")
    options = menu.get("options")
    if not isinstance(options, list) or not 1 <= len(options) <= 25:
        raise TemplateError("A selection needs 1 to 25 options.")
    cleaned, seen = [], set()
    for option in options:
        if not isinstance(option, dict):
            raise TemplateError("Invalid option.")
        value = _slug(option.get("value"), "Every option needs a unique value.")
        if value in seen:
            raise TemplateError("Every option needs a unique value.")
        seen.add(value)
        label = _text(option.get("label"), 80, "Every option needs a label.", required=True)
        entry = {"value": value, "label": label}
        _optional(entry, option, "emoji", clean_emoji)
        _optional(
            entry,
            option,
            "description",
            lambda v: _text(v, 100, "The description is too long."),
        )
        if option.get("roles") is not None:
            entry["roles"] = _roles(option["roles"], 10, "An option contains invalid roles.")
        cleaned.append(entry)
    result = {
        "id": select_id,
        "purpose": purpose,
        "mode": menu["mode"],
        "exclusive": menu["exclusive"],
        "options": cleaned,
    }
    _optional(
        result,
        menu,
        "placeholder",
        lambda v: _text(v, 150, "The placeholder is too long."),
    )
    return result


def _clean_button(item):
    if not isinstance(item, dict):
        raise TemplateError("Invalid button.")
    button = {
        "id": _slug(item.get("id"), "Invalid button."),
        "label": _text(item.get("label"), 80, "Invalid button.", required=True),
        "style": item.get("style") or "secondary",
    }
    if button["style"] not in BUTTON_STYLES:
        raise TemplateError("Invalid button.")
    _optional(button, item, "emoji", clean_emoji)
    return button


def _clean_link(item):
    if not isinstance(item, dict):
        raise TemplateError("Link buttons need a label and an HTTPS URL.")
    link = {
        "label": _text(item.get("label"), 80, "Link buttons need a label.", required=True),
        "url": https_url(item.get("url")),
    }
    _optional(link, item, "emoji", clean_emoji)
    return link


def clean_block(block):
    if not isinstance(block, dict) or len(block) != 1:
        raise TemplateError("Invalid block.")
    key, item = next(iter(block.items()))
    if key == "text" and isinstance(item, str):
        return {"text": item}
    if key in ("image", "gallery"):
        return {key: image_source(item)}
    if key == "slot":
        return {"slot": _slug(item, "Invalid dynamic block.")}
    if key == "separator" and item is True:
        return {"separator": True}
    if key == "button":
        return {"button": _clean_button(item)}
    if key == "link":
        return {"link": _clean_link(item)}
    if key == "select":
        return {"select": clean_select(item)}
    raise TemplateError("Unknown block.")


def validate_design(design):
    """Validate a design and return a cleaned copy."""
    if not isinstance(design, dict) or not isinstance(design.get("blocks"), list):
        raise TemplateError("Invalid template.")
    if len(design["blocks"]) > MAX_BLOCKS:
        raise TemplateError(f"At most {MAX_BLOCKS} blocks.")
    blocks, ids = [], set()
    for block in design["blocks"]:
        cleaned = clean_block(block)
        if "select" in cleaned:
            if cleaned["select"]["id"] in ids:
                raise TemplateError("Every selection needs its own ID.")
            ids.add(cleaned["select"]["id"])
        blocks.append(cleaned)
    content = _text(design.get("content"), 2000, "The outside text is too long.")
    length = sum(len(block.get("text", "")) for block in blocks) + len(content or "")
    if length > MAX_TEXT:
        raise TemplateError(f"At most {MAX_TEXT} characters of text.")
    result = {"blocks": blocks}
    if content:
        result["content"] = content
    color = design.get("color")
    if color is not None:
        if type(color) is not int or not 0 <= color <= 0xFFFFFF:
            raise TemplateError("Invalid accent color.")
        result["color"] = color
    keep = design.get("keepBotImage")
    if keep is not None:
        if keep not in ("large", "small"):
            raise TemplateError("Invalid image setting.")
        result["keepBotImage"] = keep
    return result


def _clean_footer(footer):
    if not isinstance(footer, dict) or not isinstance(footer.get("rows"), list):
        raise TemplateError("Invalid context.")
    rows = footer["rows"]
    if len(rows) > 5 or any(not isinstance(row, list) or len(row) > 5 for row in rows):
        raise TemplateError("Invalid context.")
    result = {"rows": [[https_url(url) for url in row] for row in rows]}
    _optional(result, footer, "label", lambda v: _text(v, 100, "Invalid context."))
    return result


def _clean_context(context):
    if not isinstance(context, dict):
        raise TemplateError("Invalid context.")
    result = {}
    for key, items in context.items():
        if key == "accessory":
            result[key] = _slug(items, "Invalid context.")
            continue
        if key == "footer":
            result[key] = _clean_footer(items)
            continue
        if key not in ("channels", "roles", "emojis", "buttons", "slots", "selects"):
            raise TemplateError("Invalid context.")
        if not isinstance(items, list) or len(items) > (20 if key == "selects" else 200):
            raise TemplateError("Invalid context.")
        cleaned = []
        for item in items:
            if not isinstance(item, dict):
                raise TemplateError("Invalid context.")
            if key == "selects":
                entry = {
                    "purpose": _slug(item.get("purpose"), "Invalid context."),
                    "label": _text(item.get("label"), 80, "Invalid context.", required=True),
                    "roles": item.get("roles") or "none",
                }
                modes = item.get("modes")
                if entry["roles"] not in ROLE_MODES:
                    raise TemplateError("Invalid context.")
                if modes is not None:
                    if (
                        not isinstance(modes, list)
                        or not modes
                        or any(mode not in SELECT_MODES for mode in modes)
                    ):
                        raise TemplateError("Invalid context.")
                    entry["modes"] = modes
                if item.get("exclusive") is not None:
                    if not isinstance(item["exclusive"], bool):
                        raise TemplateError("Invalid context.")
                    entry["exclusive"] = item["exclusive"]
                _optional(entry, item, "hint", lambda v: _text(v, 300, "Invalid context."))
            elif key in ("buttons", "slots"):
                entry = {
                    "id": _slug(item.get("id"), "Invalid context."),
                    "label": _text(item.get("label"), 80, "Invalid context.", required=True),
                }
                _optional(entry, item, "sample", lambda v: _text(v, 1000, "Invalid context."))
                if item.get("icon") is not None:
                    if key != "buttons":
                        raise TemplateError("Invalid context.")
                    entry["icon"] = https_url(item["icon"])
            else:
                ident, name = item.get("id"), item.get("name")
                if not isinstance(ident, str) or not SNOWFLAKE.fullmatch(ident):
                    raise TemplateError("Invalid context.")
                _text(name, 100, "Invalid context.", required=True)
                if key == "emojis" and not re.fullmatch(r"\w{2,32}", name):
                    raise TemplateError("Invalid context.")
                entry = {"id": ident, "name": name}
                if key == "emojis" and item.get("animated") is True:
                    entry["animated"] = True
            cleaned.append(entry)
        result[key] = cleaned
    return result


def validate(document):
    """Validate a whole document and return a cleaned copy. Raises TemplateError."""
    if not isinstance(document, dict) or set(document) - DOCUMENT_KEYS:
        raise TemplateError("Invalid template.")
    if document.get("version") not in (None, 1):
        raise TemplateError("Unknown format version.")
    result = {}
    for key, limit in (
        ("kind", 80),
        ("title", 80),
        ("template", 80),
        ("note", 300),
        ("returnHint", 300),
    ):
        if document.get(key) is not None:
            result[key] = _text(document[key], limit, "Invalid template.")
    if document.get("version") is not None:
        result["version"] = 1
    if document.get("messageType") not in (None, "general", "member"):
        raise TemplateError("Invalid message type.")
    if document.get("messageType"):
        result["messageType"] = document["messageType"]
    sender = document.get("sender")
    if sender is not None:
        if not isinstance(sender, dict):
            raise TemplateError("Invalid sender.")
        result["sender"] = {"name": _text(sender.get("name"), 80, "Invalid sender.", required=True)}
        if sender.get("avatar") is not None:
            result["sender"]["avatar"] = https_url(sender["avatar"])
    if document.get("context") is not None:
        result["context"] = _clean_context(document["context"])
    result["design"] = validate_design(document.get("design"))
    return result


def find_select(design, select_id):
    for block in design.get("blocks", []):
        if block.get("select", {}).get("id") == select_id:
            return block["select"]
    return None


def selects_for(design, purpose):
    return [
        block["select"]
        for block in design.get("blocks", [])
        if block.get("select", {}).get("purpose") == purpose
    ]


def chosen_options(design, select_id, values):
    """Options matching the chosen values. Always pass the stored design, never interaction data."""
    menu = find_select(design, select_id)
    if menu is None:
        return []
    wanted = set(values)
    return [option for option in menu["options"] if option["value"] in wanted]
