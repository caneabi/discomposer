"""discomposer: validate, fetch and send Discord message templates with discord.py."""

from discomposer.editor import (
    DEFAULT_URL,
    EditorClient,
    EditorError,
    components_to_blocks,
    emoji_text,
    guild_context,
    parse_code,
)
from discomposer.format import (
    TemplateError,
    chosen_options,
    clean_emoji,
    find_select,
    selects_for,
    validate,
    validate_design,
)
from discomposer.media import MediaError, MediaStore, image_extension
from discomposer.render import (
    button_emoji,
    button_style,
    outside_text,
    render,
    render_message,
    select_rows,
)
from discomposer.tickets import (
    category_roles,
    chosen_category,
    missing_roles,
    ticket_categories,
    ticket_overwrites,
    transcript_markdown,
)
from discomposer.variables import VARIABLES, fill_variables

__all__ = [
    "DEFAULT_URL",
    "VARIABLES",
    "EditorClient",
    "EditorError",
    "MediaError",
    "MediaStore",
    "TemplateError",
    "button_emoji",
    "button_style",
    "category_roles",
    "chosen_category",
    "chosen_options",
    "clean_emoji",
    "components_to_blocks",
    "emoji_text",
    "fill_variables",
    "find_select",
    "guild_context",
    "image_extension",
    "missing_roles",
    "parse_code",
    "outside_text",
    "render",
    "render_message",
    "select_rows",
    "selects_for",
    "ticket_categories",
    "ticket_overwrites",
    "transcript_markdown",
    "validate",
    "validate_design",
]
