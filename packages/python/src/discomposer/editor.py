import copy
import json
import re
from pathlib import PurePosixPath
from urllib.parse import urlsplit

import aiohttp
from yarl import URL

from discomposer.format import validate, validate_design
from discomposer.media import MAX_IMAGE, MediaError

DEFAULT_URL = "https://editor.discomposer.dev"
# Only the editor and Discord's CDN are fetched, so templates can't reach internal URLs.
DISCORD_MEDIA = frozenset({"cdn.discordapp.com", "media.discordapp.net"})
CODE = re.compile(r"[0-9A-HJKMNP-TV-Z]{5}-[0-9A-HJKMNP-TV-Z]{5}")
MAX_RESPONSE = 70 * 1024
OFFLINE = "The editor is unavailable right now. Please try again later."


class EditorError(Exception):
    """Talking to the editor failed. The message is meant for end users."""


async def read_all(response, limit):
    # response.content.read(n) returns whatever has arrived so far, which truncates large images.
    data = bytearray()
    async for chunk in response.content.iter_chunked(64 * 1024):
        data.extend(chunk)
        if len(data) > limit:
            raise EditorError("The response is too large.")
    return bytes(data)


def parse_code(value):
    """Return the code from a code or an editor link."""
    try:
        code = urlsplit(str(value).strip()).path.rstrip("/").rsplit("/", 1)[-1].upper()
    except ValueError:
        code = ""
    if not CODE.fullmatch(code):
        raise EditorError("That is not a valid code. It looks like this: K7F3M-9QX2A")
    return code


def components_to_blocks(items, on_row_item=None):
    """Convert sent Components V2 back into blocks.

    on_row_item(child, blocks) may turn your own buttons or menus into blocks and returns True.
    Returns (blocks, color, has_actions); has_actions means interactive components were left over.
    """
    blocks, color, has_actions = [], None, False

    def walk(parts):
        nonlocal color, has_actions
        for part in parts:
            kind = part.get("type")
            if kind == 17:
                color = part.get("accent_color", color)
                walk(part.get("components", []))
            elif kind == 9:
                accessory = part.get("accessory", {})
                if accessory.get("type") == 11:
                    blocks.append({"image": accessory.get("media", {}).get("url")})
                elif accessory.get("type") == 2:
                    walk([{"type": 1, "components": [accessory]}])
                walk(part.get("components", []))
            elif kind == 10:
                blocks.append({"text": part.get("content", "")})
            elif kind == 12:
                blocks.extend(
                    {"gallery": item.get("media", {}).get("url")} for item in part.get("items", [])
                )
            elif kind == 14:
                blocks.append({"separator": True})
            elif kind == 1:
                for child in part.get("components", []):
                    if on_row_item and on_row_item(child, blocks):
                        continue
                    if child.get("type") == 2 and child.get("style") == 5:
                        link = {"label": child.get("label") or "Link", "url": child.get("url")}
                        if emoji_text(child.get("emoji")):
                            link["emoji"] = emoji_text(child.get("emoji"))
                        blocks.append({"link": link})
                    else:
                        has_actions = True

    walk(items)
    return blocks, color, has_actions


def emoji_text(emoji):
    """Emoji of a component in template notation."""
    if emoji and emoji.get("id"):
        prefix = "a" if emoji.get("animated") else ""
        return f"<{prefix}:{emoji.get('name')}:{emoji['id']}>"
    return emoji.get("name") if emoji else None


def guild_context(guild):
    """Channels, roles and emojis for the editor. Codes aren't secret, so only public ones."""
    everyone = guild.default_role
    channels = [
        channel for channel in guild.text_channels if channel.permissions_for(everyone).view_channel
    ]
    roles = [r for r in guild.roles if not r.is_default() and not r.managed]
    emojis = [e for e in guild.emojis if e.available]
    return {
        "channels": [{"id": str(c.id), "name": c.name} for c in channels[:200]],
        "roles": [{"id": str(r.id), "name": r.name} for r in reversed(roles[-200:])],
        "emojis": [{"id": str(e.id), "name": e.name, "animated": e.animated} for e in emojis[:200]],
    }


def _error(body):
    value = body.get("error") if isinstance(body, dict) else None
    return value if isinstance(value, str) and value else OFFLINE


class EditorClient:
    """Client for the template editor. Pass a MediaStore to keep copies of images."""

    def __init__(self, base_url=DEFAULT_URL, media=None, *, timeout=30):
        try:
            url = URL(base_url)
            if (
                url.scheme not in ("https", "http") or not url.host
                or url.user or url.password or url.query or url.fragment
            ):
                raise ValueError
            # Accessing port also validates its syntax and range.
            _ = url.port
        except (TypeError, ValueError):
            raise EditorError(
                "The editor URL must be an HTTP(S) URL without credentials, query or fragment."
            ) from None
        self.base_url = str(url).rstrip("/")
        self.media = media
        self.timeout = timeout
        self.image_url = re.compile(re.escape(self.base_url) + r"/api/images/[0-9a-f]{64}")

    async def _request(
        self, method, path, *, limit=MAX_RESPONSE, parse=True, offline=OFFLINE, **kwargs
    ):
        timeout = aiohttp.ClientTimeout(total=self.timeout)
        try:
            async with (
                aiohttp.ClientSession(timeout=timeout) as session,
                session.request(
                    method,
                    self.base_url + path if path.startswith("/") else path,
                    allow_redirects=False,
                    **kwargs,
                ) as response,
            ):
                raw = await read_all(response, limit)
                return response.status, json.loads(raw) if parse else raw
        except (aiohttp.ClientError, TimeoutError, ValueError):
            raise EditorError(offline) from None

    async def open(self, document):
        """Store a document and return the link to edit it."""
        document = validate(document)
        status, body = await self._request("POST", "/api/templates", json=document)
        if (
            status != 201 or not isinstance(body, dict)
            or not isinstance(body.get("code"), str) or not CODE.fullmatch(body["code"])
        ):
            raise EditorError(_error(body))
        return f"{self.base_url}/e/{body['code']}"

    async def upload(self, raw):
        """Upload an image and return its URL."""
        status, body = await self._request(
            "POST", "/api/images", data=raw, headers={"content-type": "application/octet-stream"}
        )
        if (
            status != 201 or not isinstance(body, dict)
            or not isinstance(body.get("path"), str)
            or not re.fullmatch(r"/api/images/[0-9a-f]{64}", body["path"])
        ):
            raise EditorError(_error(body))
        return self.base_url + body["path"]

    async def fetch_document(self, code):
        """Fetch and validate a document by code or link."""
        status, body = await self._request("GET", f"/api/templates/{parse_code(code)}")
        if status == 404:
            raise EditorError("This code doesn't exist or has expired.")
        if status != 200 or not isinstance(body, dict):
            raise EditorError(OFFLINE)
        return validate(body)

    async def fetch(self, code, *, adopt_images=True):
        """Fetch the design of a template; images are adopted if a MediaStore is set."""
        design = (await self.fetch_document(code))["design"]
        if adopt_images and self.media is not None:
            design = await self.adopt_images(design)
        return design

    async def _download(self, url):
        status, raw = await self._request(
            "GET", url, limit=MAX_IMAGE, parse=False,
            offline="An image could not be loaded. Please upload it in the editor.",
        )
        if status != 200:
            raise EditorError(
                "A Discord image has expired. Please upload it again in the editor."
            )
        return raw

    async def adopt_images(self, design):
        """Store editor and Discord images and point the blocks at attachment:// names.

        The result has attachments: {filename: stored name}. Editor images expire after 30 days.
        """
        if self.media is None:
            raise EditorError("The client needs a MediaStore to adopt images.")
        design = copy.deepcopy(design)
        attachments = dict(design.get("attachments", {}))
        adopted = {}
        for block in design["blocks"]:
            for key in ("image", "gallery"):
                value = block.get(key)
                if not isinstance(value, str):
                    continue
                if value in adopted:
                    block[key] = adopted[value]
                    continue
                try:
                    source = URL(value)
                except (TypeError, ValueError):
                    continue
                if self.image_url.fullmatch(str(source)):
                    status, raw = await self._request(
                        "GET", str(source), limit=MAX_IMAGE, parse=False
                    )
                    if status != 200:
                        raise EditorError("An uploaded image has expired. Please upload it again.")
                elif source.scheme == "https" and source.host in DISCORD_MEDIA:
                    raw = await self._download(str(source))
                else:
                    continue
                try:
                    stored = self.media.save(raw)
                except MediaError as error:
                    raise EditorError(str(error)) from None
                filename = self.media.attachment_name(stored, raw)
                attachments[filename] = stored
                block[key] = f"attachment://{filename}"
                adopted[value] = block[key]
        if attachments:
            design["attachments"] = attachments
        return design

    async def expose_attachments(self, design):
        """Reverse of adopt_images: upload stored attachments so the editor can show them."""
        design = copy.deepcopy(design)
        stored = design.pop("attachments", {})
        uploaded = {}
        for block in design.get("blocks", []):
            for key in ("image", "gallery"):
                value = block.get(key)
                if isinstance(value, str) and value.startswith("attachment://"):
                    name = stored.get(value.removeprefix("attachment://"))
                    if name is None or self.media is None:
                        raise EditorError("An image of this template is missing.")
                    if name not in uploaded:
                        uploaded[name] = await self.upload(self.media.read(name))
                    block[key] = uploaded[name]
        return validate_design(design)

    async def open_message(self, message, *, on_row_item=None, **document):
        """Open a sent message in the editor. Returns None if it has components nobody handles."""
        items = [component.to_dict() for component in message.components]
        blocks, color, has_actions = components_to_blocks(items, on_row_item)
        if has_actions:
            return None
        if message.content:
            blocks.insert(0, {"text": message.content})
        for embed in message.embeds:
            parts = [f"## {embed.title}" if embed.title else None, embed.description]
            text = "\n".join(part for part in parts if part)
            if text:
                blocks.append({"text": text})
            if embed.image and embed.image.url:
                blocks.append({"gallery": embed.image.url})
            if color is None and embed.colour:
                color = embed.colour.value
        files = {attachment.filename: attachment for attachment in message.attachments}
        for block in blocks:
            for key in ("image", "gallery"):
                value = block.get(key)
                if not isinstance(value, str):
                    continue
                name = (
                    value.removeprefix("attachment://")
                    if value.startswith("attachment://")
                    else PurePosixPath(urlsplit(value).path).name
                )
                if name in files:
                    block[key] = await self.upload(await files[name].read())
        design = {"blocks": blocks}
        if color is not None:
            design["color"] = color
        return await self.open({**document, "design": design})
