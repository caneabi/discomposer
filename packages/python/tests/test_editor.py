"""EditorClient against a local server, including a large image sent in small chunks."""

import hashlib
import os

import pytest
from aiohttp import web

from discomposer import EditorClient, EditorError, MediaStore, parse_code

PNG = b"\x89PNG\r\n\x1a\n" + os.urandom(1_500_000)
HASH = hashlib.sha256(PNG).hexdigest()


@pytest.fixture
async def server():
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
            web.post("/api/templates", create),
            web.get("/api/templates/{code}", get),
            web.get(f"/api/images/{HASH}", image),
        ]
    )
    runner = web.AppRunner(app)
    await runner.setup()
    site = web.TCPSite(runner, "127.0.0.1", 0)
    await site.start()
    port = site._server.sockets[0].getsockname()[1]
    yield f"http://127.0.0.1:{port}"
    await runner.cleanup()


def test_parse_code():
    assert parse_code(" https://editor.caneabi.dev/e/abcde-12345/ ") == "ABCDE-12345"
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
