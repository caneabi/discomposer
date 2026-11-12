"""Exercise the actual example without logging in or contacting Discord."""

import importlib.util
from pathlib import Path
from types import SimpleNamespace as NS
from unittest.mock import AsyncMock

import discord
import pytest

ROLE = 111111111111111111
DOCUMENT = {"design": {"blocks": [{"select": {
    "id": "roles", "purpose": "role_picker", "mode": "select", "exclusive": False,
    "options": [{"value": str(ROLE), "label": "News", "roles": [str(ROLE)]}],
}}]}}


@pytest.fixture
async def example(monkeypatch):
    monkeypatch.setenv("DISCORD_TOKEN", "fixture-not-a-token")
    monkeypatch.setattr(discord.Client, "run", lambda *args, **kwargs: None)
    path = Path(__file__).resolve().parents[3] / "examples/discordpy_bot.py"
    spec = importlib.util.spec_from_file_location("role_picker_fixture", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    yield module
    await module.client.close()


def interaction(*, allowed=True, guild=True, position=5):
    class Rank:
        def __gt__(self, role):
            return role.position < 10

    role = NS(id=ROLE, name="News", position=position, is_assignable=lambda: True)
    server = NS(
        owner_id=999, get_role=lambda role_id: role if role_id == ROLE else None,
        me=NS(guild_permissions=NS(manage_roles=True)), name="Fixture", member_count=1,
        icon=None, banner=None,
    )
    person = NS(id=123, guild=server, top_role=Rank())
    return NS(
        guild=server if guild else None, user=person, permissions=NS(manage_roles=allowed),
        response=NS(send_message=AsyncMock(), defer=AsyncMock()),
        edit_original_response=AsyncMock(),
        channel=NS(send=AsyncMock(return_value=NS(id=456))),
    )


@pytest.mark.parametrize("options", [{"allowed": False}, {"guild": False}])
async def test_rejected_before_fetch(example, monkeypatch, options):
    fetch = AsyncMock()
    monkeypatch.setattr(example.editor, "fetch", fetch)
    request = interaction(**options)
    await example.send.callback(request, "ABCDE-12345")
    fetch.assert_not_awaited()
    request.response.send_message.assert_awaited_once()


async def test_above_member_role_is_not_published(example, monkeypatch):
    monkeypatch.setattr(example.editor, "fetch", AsyncMock(return_value=DOCUMENT["design"]))
    request = interaction(position=20)
    await example.send.callback(request, "ABCDE-12345")
    request.response.defer.assert_awaited_once()
    request.channel.send.assert_not_awaited()
    assert "one role" in request.edit_original_response.await_args.kwargs["content"]


async def test_deferred_before_fetch_and_delivery_before_success(example, monkeypatch):
    request = interaction()

    async def fetch(code):
        request.response.defer.assert_awaited_once()
        return DOCUMENT["design"]

    async def confirm(*, content):
        if content == "Sent.":
            request.channel.send.assert_awaited_once()

    monkeypatch.setattr(example.editor, "fetch", fetch)
    request.edit_original_response.side_effect = confirm
    await example.send.callback(request, "ABCDE-12345")
    request.edit_original_response.assert_awaited_once_with(content="Sent.")


async def test_failed_delivery_has_no_success_message(example, monkeypatch):
    monkeypatch.setattr(example.editor, "fetch", AsyncMock(return_value=DOCUMENT["design"]))
    request = interaction()
    request.channel.send.side_effect = discord.DiscordException("fixture delivery failure")
    await example.send.callback(request, "ABCDE-12345")
    request.edit_original_response.assert_awaited_once_with(
        content="The message could not be sent."
    )
