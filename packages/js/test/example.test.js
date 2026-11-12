import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

test("Node reference returns usable HTTP errors and remains usable afterwards", { timeout: 10_000 }, async (t) => {
  const folder = await mkdtemp(join(tmpdir(), "discomposer-example-"));
  const source = await readFile(new URL("../../../examples/template-server.mjs", import.meta.url), "utf8");
  const path = join(folder, "server.mjs");
  await writeFile(path, source.replace('"discomposer/server"', JSON.stringify(new URL("../dist/server.js", import.meta.url).href)));
  const child = spawn(process.execPath, [path], {
    env: { PORT: "0", SYSTEMROOT: process.env.SYSTEMROOT ?? "" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let errors = "";
  child.stderr.on("data", (data) => { errors += data; });
  t.after(async () => {
    if (child.exitCode === null) {
      const closed = once(child, "close");
      child.kill();
      await closed;
    }
    await rm(folder, { recursive: true, force: true });
  });
  const base = await new Promise((resolve, reject) => {
    child.stdout.once("data", (data) => resolve(data.toString().trim().replace("Template API: ", "")));
    child.once("error", reject);
    child.once("exit", (code) => reject(new Error("Reference exited: " + code + " " + errors)));
  });
  const oversized = await fetch(base + "/api/templates", {
    method: "POST", headers: { "content-type": "application/json" }, body: "x".repeat(65537),
  });
  assert.equal(oversized.status, 413);
  assert.match((await oversized.json()).error, /large/);
  const response = await fetch(base + "/api/templates", {
    method: "POST", headers: { "content-type": "application/json" }, body: '{"design":{"blocks":[]}}',
  });
  assert.equal(response.status, 201);
});
