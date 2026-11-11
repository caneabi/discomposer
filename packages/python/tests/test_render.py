import datetime
from types import SimpleNamespace as NS

import discord

from discomposer import fill_variables, render, select_rows, validate


def guild(**kw):
    return NS(
        name="Example_Server",
        member_count=1234,
        icon=NS(url="https://cdn/icon.png"),
        banner=None,
        chunked=False,
        members=[],
        **kw,
    )


def member(g):
    return NS(
        name="max",
        display_name="Max*",
        mention="<@1>",
        guild=g,
        joined_at=datetime.datetime(2024, 1, 2, tzinfo=datetime.UTC),
    )


def types(container):
    return [item.to_component_dict()["type"] for item in container.children]


def test_variables_escape_and_unknown():
    g = guild()
    text = fill_variables("{user} {server} {member_count} {member_number} {nope}", member(g))
    assert text == "Max\\* Example\\_Server 1,234 unknown {nope}"


def test_render_layout():
    design = validate(
        {
            "design": {
                "blocks": [
                    {"text": "#Titel {user}"},
                    {"image": "{server_icon}"},
                    {"gallery": "https://cdn/a.png"},
                    {"link": {"label": "Web", "url": "https://example.com"}},
                    {"button": {"id": "known", "label": "Los"}},
                    {"button": {"id": "unknown", "label": "Weg"}},
                    {"slot": "count"},
                    {
                        "select": {
                            "id": "s",
                            "purpose": "role_picker",
                            "mode": "buttons",
                            "exclusive": True,
                            "options": [{"value": "a", "label": "A"}],
                        }
                    },
                ]
            }
        }
    )["design"]
    g = guild()
    container = render(
        discord.ui.Container(),
        design,
        member=member(g),
        buttons={"known": lambda b: discord.ui.Button(label=b["label"], custom_id="x:known")},
        slots={"count": "42"},
        selects=lambda menu, _: select_rows(menu, "demo:s"),
    )
    data = [item.to_component_dict() for item in container.children]
    assert types(container) == [9, 12, 1, 10, 1]
    section = data[0]
    assert section["components"][0]["content"] == "# Titel Max\\*"
    assert section["accessory"]["media"]["url"] == "https://cdn/icon.png"
    assert [c.get("label") for c in data[2]["components"]] == ["Web", "Los"]
    assert data[3]["content"] == "42"
    assert data[4]["components"][0]["custom_id"] == "demo:s:a"


def test_select_menu_values():
    menu = validate(
        {
            "design": {
                "blocks": [
                    {
                        "select": {
                            "id": "t",
                            "purpose": "ticket_categories",
                            "mode": "select",
                            "exclusive": False,
                            "options": [{"value": "a", "label": "A"}, {"value": "b", "label": "B"}],
                        }
                    }
                ]
            }
        }
    )["design"]["blocks"][0]["select"]
    row = select_rows(menu, "demo:t")[0].to_component_dict()["components"][0]
    assert row["custom_id"] == "demo:t"
    assert (row["min_values"], row["max_values"]) == (0, 2)
    assert [o["value"] for o in row["options"]] == ["a", "b"]


def test_render_message_puts_content_outside():
    from discomposer import render_message

    design = validate({"design": {"content": "<@&1> {server}", "blocks": [{"text": "Innen"}]}})[
        "design"
    ]
    items = render_message(design, guild=guild())
    assert [type(item).__name__ for item in items] == ["TextDisplay", "Container"]
    assert items[0].content == "<@&1> Example\\_Server"
