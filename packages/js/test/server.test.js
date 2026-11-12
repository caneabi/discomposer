import assert from "node:assert/strict";
import { createServer } from "node:http";
import { Readable } from "node:stream";
import { test } from "node:test";
import { EditorClient, MediaStore } from "../dist/index.js";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { TemplateServer, RETENTION_SECONDS } from "../dist/server.js";

class MemoryStore {
  entries = new Map();
  writes = 0;
  async get(key) { return this.entries.get(key) ?? null; }
  async put(key, entry, ttl) {
    assert.equal(ttl, RETENTION_SECONDS);
    this.writes++;
    this.entries.set(key, structuredClone(entry));
  }
  async create(key, entry, ttl) {
    if (this.entries.has(key)) return false;
    await this.put(key, entry, ttl);
    return true;
  }
}
const document = { context: { buttons: [{ id: "open", label: "Open" }] }, design: {
  content: "Above", blocks: [{ text: "Hello" }, { button: { id: "open", label: "Open" } }],
} };
const png = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3]);
const post = (path, body, headers = { "content-type": "application/json" }) =>
  new Request("https://custom.example" + path, { method: "POST", body, headers });
const get = (path, method = "GET") => new Request("https://custom.example" + path, { method });

test("templates normalize, preserve context and get new immutable codes", async () => {
  const store = new MemoryStore();
  const api = new TemplateServer({ store });
  const first = await api.fetch(post("/api/templates", JSON.stringify(document)));
  assert.equal(first.status, 201);
  const { code } = await first.json();
  assert.match(code, /^[0-9A-HJKMNP-TV-Z]{5}-[0-9A-HJKMNP-TV-Z]{5}$/);
  const loaded = await api.fetch(get("/api/templates/" + code.toLowerCase()));
  const saved = await loaded.json();
  assert.deepEqual(saved.context, document.context);
  assert.equal(saved.design.blocks[1].button.style, "secondary");
  assert.equal(loaded.headers.get("cache-control"), "no-store");
  const second = await api.fetch(post("/api/templates", JSON.stringify(saved)));
  assert.notEqual((await second.json()).code, code);
  assert.equal(store.entries.size, 2);
});

test("images are hashed, deduplicated, typed by bytes and support HEAD", async () => {
  const store = new MemoryStore();
  const api = new TemplateServer({ store });
  const upload = () => api.fetch(post("/api/images", png, { "content-type": "image/svg+xml" }));
  const response = await upload();
  assert.equal(response.status, 201);
  const { path } = await response.json();
  assert.match(path, /^\/api\/images\/[0-9a-f]{64}$/);
  assert.deepEqual(await (await upload()).json(), { path });
  assert.equal(store.writes, 1);
  const downloaded = await api.fetch(get(path));
  assert.equal(downloaded.headers.get("content-type"), "image/png");
  assert.deepEqual(new Uint8Array(await downloaded.arrayBuffer()), png);
  const head = await api.fetch(get(path, "HEAD"));
  assert.equal(head.headers.get("content-type"), "image/png");
  assert.equal((await head.arrayBuffer()).byteLength, 0);
  assert.equal((await api.fetch(post("/api/images", "<svg/>"))).status, 415);
  assert.equal((await api.fetch(post("/api/images", "GIF8"))).status, 415);
});

test("bad documents, content types, missing codes and unsupported methods", async () => {
  const api = new TemplateServer({ store: new MemoryStore() });
  for (const [request, status] of [
    [post("/api/templates", "{"), 400],
    [post("/api/templates", '{"design":{"blocks":[{"roles":{}}]}}'), 400],
    [post("/api/templates", "{}"), 400],
    [post("/api/templates", "{}", { "content-type": "application/jsonp" }), 415],
    [get("/api/templates/invalid"), 400],
    [get("/api/templates/ABCDE-12345"), 404],
    [get("/api/images/invalid"), 400],
    [get("/api/images/" + "a".repeat(64)), 404],
    [get("/api/templates/ABCDE-12345", "DELETE"), 404],
    [get("/e/ABCDE-12345"), 404],
  ]) {
    const response = await api.fetch(request);
    assert.equal(response.status, status);
    assert.equal(typeof (await response.json()).error, "string");
  }
});

test("streaming size limits cancel chunked bodies and do not store them", async () => {
  for (const [path, limit] of [["/api/templates", 64 * 1024], ["/api/images", 8 * 1024 * 1024]]) {
    const store = new MemoryStore();
    const api = new TemplateServer({ store });
    let cancelled = false;
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(limit));
        controller.enqueue(new Uint8Array(1));
      },
      cancel() { cancelled = true; },
    });
    const response = await api.fetch(new Request("https://custom.example" + path, {
      method: "POST", body: stream, duplex: "half", headers: { "content-type": "application/json" },
    }));
    assert.equal(response.status, 413);
    assert.ok(cancelled);
    assert.equal(store.writes, 0);
  }
});

test("write policy runs before reading the body and failures are not retried", async () => {
  const store = new MemoryStore();
  const policy = [];
  const api = new TemplateServer({ store, allowWrite: async (_, kind) => { policy.push(kind); return false; } });
  assert.equal((await api.fetch(post("/api/templates", JSON.stringify(document)))).status, 429);
  assert.equal((await api.fetch(post("/api/images", png))).status, 429);
  assert.deepEqual(policy, ["template", "image"]);
  assert.equal(store.writes, 0);
  let attempts = 0;
  store.create = async () => { attempts++; throw new Error("private provider detail"); };
  const response = await new TemplateServer({ store }).fetch(post("/api/templates", JSON.stringify(document)));
  assert.equal(response.status, 503);
  assert.doesNotMatch(await response.text(), /provider/);
  assert.equal(attempts, 1);
});

test("collisions preserve old templates and retry only confirmed conflicts", async () => {
  const store = new MemoryStore();
  let attempts = 0;
  store.create = async (key, entry, ttl) => {
    if (++attempts < 3) return false;
    await store.put(key, entry, ttl);
    return true;
  };
  const api = new TemplateServer({ store });
  assert.equal((await api.fetch(post("/api/templates", JSON.stringify(document)))).status, 201);
  assert.equal(attempts, 3);
});

test("daily refresh works for existing records with awaited and deferred writes", async () => {
  const store = new MemoryStore();
  await store.put("code:ABCDE-12345", {
    value: new TextEncoder().encode(JSON.stringify(document)), savedAt: Date.now() - 86_400_001,
  }, RETENTION_SECONDS);
  const api = new TemplateServer({ store });
  const tasks = [];
  assert.equal((await api.fetch(get("/api/templates/ABCDE-12345"), (task) => tasks.push(task))).status, 200);
  await Promise.all(tasks);
  assert.equal(tasks.length, 1);
  assert.equal(store.writes, 2);
  await api.fetch(get("/api/templates/ABCDE-12345"));
  assert.equal(store.writes, 2);
});

test("real HTTP roundtrip uses a custom host and adopts images with the JS client", async (t) => {
  const api = new TemplateServer({ store: new MemoryStore() });
  const server = createServer(async (incoming, outgoing) => {
    const response = await api.fetch(new Request("http://local" + incoming.url, {
      method: incoming.method, headers: incoming.headers,
      ...(incoming.method === "POST" ? { body: Readable.toWeb(incoming), duplex: "half" } : {}),
    }));
    outgoing.writeHead(response.status, Object.fromEntries(response.headers));
    outgoing.end(Buffer.from(await response.arrayBuffer()));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())));
  const folder = await mkdtemp(join(tmpdir(), "discomposer-server-"));
  t.after(() => rm(folder, { recursive: true, force: true }));
  const baseUrl = "http://127.0.0.1:" + server.address().port;
  const client = new EditorClient({ baseUrl, media: new MediaStore(folder) });
  const imageUrl = await client.upload(png);
  const link = await client.open(document);
  assert.match(link, /\/e\//);
  const fetched = await client.fetch(link + "?source=bot#edit");
  assert.equal(fetched.content, "Above");
  // Local HTTP fixtures have no TLS; template image URLs still require HTTPS.
  const result = await client.adoptImages({ blocks: [{ gallery: imageUrl }] });
  assert.match(result.blocks[0].gallery, /^attachment:\/\//);
  assert.equal(Object.keys(result.attachments).length, 1);
});


test("ambiguous writes of content-addressed images are confirmed without retry", async () => {
  const store = new MemoryStore();
  const put = store.put.bind(store);
  store.put = async (...args) => { await put(...args); throw new Error("write timed out"); };
  const response = await new TemplateServer({ store }).fetch(post("/api/images", png));
  assert.equal(response.status, 201);
  assert.equal(store.writes, 1);
});

test("malformed backend codes and image paths never become editor links", async (t) => {
  let reply;
  const server = createServer((_, response) => {
    response.writeHead(201, { "content-type": "application/json" }).end(JSON.stringify(reply));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const client = new EditorClient({ baseUrl: "http://127.0.0.1:" + server.address().port });
  for (reply of [{}, [], { code: "../escape" }, { code: "https://other.example/e/ABCDE-12345" }]) {
    await assert.rejects(client.open(document), /unavailable/);
  }
  for (reply of [{}, { path: "//other.example/a.png" }, { path: "/api/images/../escape" }]) {
    await assert.rejects(client.upload(png), /unavailable/);
  }
});



test("invalid UTF-8 is rejected instead of silently changing template text", async () => {
  const before = new TextEncoder().encode('{"design":{"blocks":[{"text":"');
  const after = new TextEncoder().encode('"}]}}');
  const body = new Uint8Array([...before, 0xff, ...after]);
  const store = new MemoryStore();
  const response = await new TemplateServer({ store }).fetch(post("/api/templates", body));
  assert.equal(response.status, 400);
  assert.equal(store.writes, 0);
});



test("a failed image retention refresh does not claim a successful renewed upload", async () => {
  const store = new MemoryStore();
  const api = new TemplateServer({ store });
  const { path } = await (await api.fetch(post("/api/images", png))).json();
  const key = "image:" + path.split("/").pop();
  store.entries.get(key).savedAt = Date.now() - 90_000_000;
  store.put = async () => { throw new Error("unavailable"); };
  assert.equal((await api.fetch(post("/api/images", png))).status, 503);
});



test("HEAD errors also return headers without a response body", async () => {
  const api = new TemplateServer({ store: new MemoryStore() });
  for (const [path, status] of [["/api/images/invalid", 400], ["/api/images/" + "f".repeat(64), 404], ["/missing", 404]]) {
    const response = await api.fetch(get(path, "HEAD"));
    assert.equal(response.status, status);
    assert.equal((await response.arrayBuffer()).byteLength, 0);
  }
});
