// Local backend reference. Copy into a Node 22+ project with discomposer installed.
// No frontend; in-memory data is lost on restart. Bind only to loopback by default.
import { createServer } from "node:http";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { TemplateServer } from "discomposer/server";

class MemoryTemplateStore {
  entries = new Map();
  used = 0;
  quota = 128 * 1024 * 1024;

  delete(key) {
    const old = this.entries.get(key);
    if (old) this.used -= old.value.byteLength;
    this.entries.delete(key);
  }

  async get(key) {
    const entry = this.entries.get(key);
    if (!entry) return null;
    if (entry.expiresAt <= Date.now()) { this.delete(key); return null; }
    return entry;
  }

  async put(key, entry, ttlSeconds) {
    const size = this.used - (this.entries.get(key)?.value.byteLength ?? 0) + entry.value.byteLength;
    if (size > this.quota) throw new Error("Memory quota exceeded");
    this.entries.set(key, { ...entry, expiresAt: Date.now() + ttlSeconds * 1000 });
    this.used = size;
  }

  async create(key, entry, ttlSeconds) {
    // No await between the check and insertion: atomic within this single Node process.
    const current = this.entries.get(key);
    if (current && current.expiresAt > Date.now()) return false;
    await this.put(key, entry, ttlSeconds);
    return true;
  }

  prune() {
    for (const [key, entry] of this.entries) if (entry.expiresAt <= Date.now()) this.delete(key);
  }
}

const store = new MemoryTemplateStore();
const api = new TemplateServer({ store });
const cleanup = setInterval(() => store.prune(), 60_000);
cleanup.unref();
const server = createServer({ requestTimeout: 30_000 }, async (incoming, outgoing) => {
  try {
    const request = new Request("http://127.0.0.1" + incoming.url, {
      method: incoming.method,
      headers: incoming.headers,
      ...(["GET", "HEAD"].includes(incoming.method) ? {} : {
        body: Readable.toWeb(incoming), duplex: "half",
      }),
    });
    const response = await api.fetch(request);
    outgoing.writeHead(response.status, Object.fromEntries(response.headers));
    if (response.body) await pipeline(Readable.fromWeb(response.body), outgoing);
    else outgoing.end();
  } catch {
    if (!outgoing.headersSent) {
      outgoing.writeHead(503, { "content-type": "application/json" });
      outgoing.end('{"error":"The backend is unavailable."}');
    } else outgoing.destroy();
  }
});
server.once("close", () => clearInterval(cleanup));
server.listen(Number(process.env.PORT ?? 8787), "127.0.0.1", () => {
  console.log("Template API: http://127.0.0.1:" + server.address().port);
});
