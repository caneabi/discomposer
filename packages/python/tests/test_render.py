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




def test_all_gallery_images_survive_grouping():
    urls = [f"https://images.example/{n}.png" for n in range(20)]
    container = render(discord.ui.Container(), {"blocks": [{"gallery": url} for url in urls]})
    data = [item.to_component_dict() for item in container.children]
    assert [len(item["items"]) for item in data] == [10, 10]
    assert [image["media"]["url"] for item in data for image in item["items"]] == urls


def test_outside_only_and_empty_output():
    import pytest

    from discomposer import TemplateError, render_message

    items = render_message({"content": "Only outside", "blocks": []})
    assert [type(item).__name__ for item in items] == ["TextDisplay"]
    with pytest.raises(TemplateError):
        render_message({"blocks": [{"slot": "missing"}]})


def test_render_applies_design_color_to_existing_container():
    container = render(discord.ui.Container(accent_colour=123), {"color": 0, "blocks": []})
    assert container.to_component_dict()["accent_color"] == 0




def test_empty_variable_values_do_not_leave_empty_displays():
    import pytest

    from discomposer import TemplateError, render_message

    with pytest.raises(TemplateError):
        render_message({"content": "{mention}", "blocks": [{"text": "{nickname}"}]})
    assert len(render_message({"content": " ", "blocks": [{"text": "Visible"}]})) == 1




def test_one_render_scans_members_once_for_all_text_blocks():
    class CountedMembers(list):
        scans = 0

        def __iter__(self):
            self.scans += 1
            return super().__iter__()

    server = guild()
    server.chunked = True
    person = member(server)
    server.members = CountedMembers([person])
    container = render(
        discord.ui.Container(),
        {"blocks": [{"text": "{member_number}"} for _ in range(20)]},
        member=person,
    )
    assert container.children[0].content == "\n".join(["1"] * 20)
    assert server.members.scans == 1
