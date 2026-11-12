// EditorClient against a local server, including a large image sent in small chunks.
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { mkdtemp, readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { EditorClient, EditorError, MediaStore, parseCode } from "../dist/index.js";

const PNG = Buffer.concat([Buffer.from("\x89PNG\r\n\x1a\n", "latin1"), randomBytes(1_500_000)]);
const HASH = createHash("sha256").update(PNG).digest("hex");
const stored = new Map();
let server;
let base;

before(async () => {
  server = createServer(async (request, response) => {
    if (request.method === "POST" && request.url === "/api/templates") {
      let body = "";
      for await (const chunk of request) body += chunk;
      stored.set("ABCDE-12345", body);
      response.writeHead(201, { "content-type": "application/json" }).end('{"code":"ABCDE-12345"}');
    } else if (request.url?.startsWith("/api/templates/")) {
      const doc = stored.get(request.url.split("/").pop());
      response.writeHead(doc ? 200 : 404, { "content-type": "application/json" }).end(doc ?? '{"error":"x"}');
    } else if (request.url === `/api/images/${HASH}`) {
      response.writeHead(200);
      for (let start = 0; start < PNG.length; start += 4096) response.write(PNG.subarray(start, start + 4096));
      response.end();
    } else response.writeHead(404).end();
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

test("parseCode accepts links and rejects garbage", () => {
  assert.equal(new EditorClient().baseUrl, "https://editor.discomposer.dev");
  assert.equal(parseCode(" https://editor.discomposer.dev/e/abcde-12345/ "), "ABCDE-12345");
  assert.throws(() => parseCode("nope"), EditorError);
});

test("roundtrip and complete image adoption", async () => {
  const folder = await mkdtemp(join(tmpdir(), "templates-"));
  const client = new EditorClient({ baseUrl: base, media: new MediaStore(folder) });
  assert.match(await client.open({ design: { blocks: [{ text: "Hallo" }] } }), /\/e\/ABCDE-12345$/);
  assert.deepEqual((await client.fetch("ABCDE-12345")).blocks, [{ text: "Hallo" }]);
  // The test server has no TLS, so adoptImages is called directly.
  const adopted = await client.adoptImages({ blocks: [{ gallery: `${base}/api/images/${HASH}` }] });
  const [[name, hash]] = Object.entries(adopted.attachments);
  assert.equal(hash, HASH);
  assert.ok((await readFile(join(folder, HASH))).equals(PNG));
  assert.equal(adopted.blocks[0].gallery, `attachment://${name}`);
});

test("expired code", async () => {
  await assert.rejects(new EditorClient({ baseUrl: base }).fetch("ZZZZZ-99999"), /expired/);
});


test("custom URLs are validated and link query strings do not become part of the code", () => {
  assert.equal(parseCode("https://custom.example/e/abcde-12345/?from=bot#edit"), "ABCDE-12345");
  assert.equal(new EditorClient({ baseUrl: "https://custom.example///" }).baseUrl, "https://custom.example");
  for (const baseUrl of ["file:///tmp", "https://user:pass@example.com", "https://example.com/?x=y", "https://example.com/#x", "not a URL"]) {
    assert.throws(() => new EditorClient({ baseUrl }), EditorError);
  }
});

test("repeated images are downloaded only once per adoption", async () => {
  const folder = await mkdtemp(join(tmpdir(), "templates-dedup-"));
  const media = new MediaStore(folder);
  let saves = 0;
  const original = media.save.bind(media);
  media.save = async (bytes) => { saves++; return original(bytes); };
  const client = new EditorClient({ baseUrl: base, media });
  const url = base + "/api/images/" + HASH;
  const design = await client.adoptImages({ blocks: [{ image: url }, { gallery: url }] });
  assert.equal(saves, 1);
  assert.equal(design.blocks[0].image, design.blocks[1].gallery);
  let uploads = 0;
  const publicUrl = "https://custom.example/api/images/" + HASH;
  client.upload = async () => { uploads++; return publicUrl; };
  const exposed = await client.exposeAttachments(design);
  assert.equal(uploads, 1);
  assert.deepEqual(exposed.blocks, [{ image: publicUrl }, { gallery: publicUrl }]);
});


test("equivalent editor URL spellings still adopt their uploaded images", async (t) => {
  const folder = await mkdtemp(join(tmpdir(), "templates-origin-"));
  const { rm } = await import("node:fs/promises");
  t.after(() => rm(folder, { recursive: true, force: true }));
  const client = new EditorClient({ baseUrl: base, media: new MediaStore(folder) });
  const adopted = await client.adoptImages({
    blocks: [{ gallery: base.replace("http:", "HTTP:") + "/api/images/" + HASH }],
  });
  assert.equal(Object.values(adopted.attachments)[0], HASH);
});
