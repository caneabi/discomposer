"""EditorClient against a local server, including a large image sent in small chunks."""

import hashlib
import os

import pytest
from aiohttp import web

from discomposer import EditorClient, EditorError, MediaStore, parse_code

PNG = b"\x89PNG\r\n\x1a\n" + os.urandom(1_500_000)
HASH = hashlib.sha256(PNG).hexdigest()


@pytest.fixture(params=["", "/editor"])
async def server(request):
    prefix = request.param
    stored = {}

    async def create(request):
        doc = await request.json()
        stored["ABCDE-12345"] = doc
        return web.json_response({"code": "ABCDE-12345"}, status=201)

    async def get(request):
        doc = stored.get(request.match_info["code"])
        return web.json_response(doc) if doc else web.json_response({"error": "x"}, status=404)

    async def image(request):
        response = web.StreamResponse()
        await response.prepare(request)
        for start in range(0, len(PNG), 4096):
            await response.write(PNG[start : start + 4096])
        return response

    app = web.Application()
    app.add_routes(
        [
            web.post(prefix + "/api/templates", create),
            web.get(prefix + "/api/templates/{code}", get),
            web.get(prefix + f"/api/images/{HASH}", image),
        ]
    )
    runner = web.AppRunner(app)
    await runner.setup()
    site = web.TCPSite(runner, "127.0.0.1", 0)
    await site.start()
    port = site._server.sockets[0].getsockname()[1]
    yield f"http://127.0.0.1:{port}{prefix}"
    await runner.cleanup()


def test_parse_code():
    assert EditorClient().base_url == "https://editor.discomposer.dev"
    assert parse_code(" https://editor.discomposer.dev/e/abcde-12345/ ") == "ABCDE-12345"
    with pytest.raises(EditorError):
        parse_code("nope")


async def test_roundtrip_and_complete_image(server, tmp_path):
    client = EditorClient(server, MediaStore(tmp_path))
    link = await client.open({"design": {"blocks": [{"text": "Hallo"}]}})
    assert link.endswith("/e/ABCDE-12345")
    assert (await client.fetch("ABCDE-12345"))["blocks"] == [{"text": "Hallo"}]
    # The test server has no TLS, so adopt_images is called directly.
    adopted = await client.adopt_images({"blocks": [{"gallery": f"{server}/api/images/{HASH}"}]})
    name, stored = next(iter(adopted["attachments"].items()))
    assert stored == HASH
    assert (tmp_path / HASH).read_bytes() == PNG
    assert adopted["blocks"][0]["gallery"] == f"attachment://{name}"


async def test_missing_code(server):
    with pytest.raises(EditorError, match="expired"):
        await EditorClient(server).fetch("ZZZZZ-99999")



@pytest.mark.parametrize("base_url", [
    "file:///tmp", "https://user:pass@example.com", "https://example.com/?x=y",
    "https://example.com/#x", "not a URL",
])
def test_invalid_editor_url(base_url):
    with pytest.raises(EditorError):
        EditorClient(base_url)


def test_parse_link_with_query():
    assert parse_code("https://custom.example/e/abcde-12345/?from=bot#edit") == "ABCDE-12345"


async def test_repeated_images(server, tmp_path, monkeypatch):
    media = MediaStore(tmp_path)
    client = EditorClient(server, media)
    saves = []
    save = media.save

    def counted(raw):
        saves.append(raw)
        return save(raw)

    monkeypatch.setattr(media, "save", counted)
    url = f"{server}/api/images/{HASH}"
    design = await client.adopt_images({"blocks": [{"image": url}, {"gallery": url}]})
    assert len(saves) == 1
    assert design["blocks"][0]["image"] == design["blocks"][1]["gallery"]
    uploads = []

    async def upload(raw):
        uploads.append(raw)
        return "https://custom.example/api/images/" + HASH

    monkeypatch.setattr(client, "upload", upload)
    exposed = await client.expose_attachments(design)
    assert len(uploads) == 1
    assert exposed["blocks"][0]["image"] == exposed["blocks"][1]["gallery"]


@pytest.mark.parametrize("body", [{}, [], {"error": None}, {"code": "../escape"}])
async def test_invalid_create_response(body, monkeypatch):
    client = EditorClient()

    async def request(*args, **kwargs):
        return 201, body

    monkeypatch.setattr(client, "_request", request)
    with pytest.raises(EditorError, match="unavailable"):
        await client.open({"design": {"blocks": []}})



@pytest.mark.parametrize(("value", "expected"), [
    ("HTTPS://EXAMPLE.COM:443/editor///", "https://example.com/editor"),
    ("http://LOCALHOST:80", "http://localhost"),
    ("https://[::1]:443/editor", "https://[::1]/editor"),
])
def test_editor_origin_normalization(value, expected):
    assert EditorClient(value).base_url == expected


async def test_equivalent_editor_image_url(server, tmp_path):
    client = EditorClient(server, MediaStore(tmp_path))
    url = server.replace("http:", "HTTP:") + f"/api/images/{HASH}"
    adopted = await client.adopt_images({"blocks": [{"gallery": url}]})
    assert list(adopted["attachments"].values()) == [HASH]
