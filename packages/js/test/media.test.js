import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { MediaStore } from "../dist/index.js";

const png = (suffix) => Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), Buffer.from(suffix)]);

test("concurrent saves respect quota, recover after rejection and preserve stored bytes", async (t) => {
  const folder = await mkdtemp(join(tmpdir(), "discomposer-media-"));
  t.after(() => rm(folder, { recursive: true, force: true }));
  const first = png("first");
  const second = png("other");
  const store = new MediaStore(folder, first.length);
  const results = await Promise.allSettled([store.save(first), store.save(second)]);
  assert.deepEqual(results.map((result) => result.status), ["fulfilled", "rejected"]);
  const name = await store.save(first);
  assert.deepEqual(await readFile(join(folder, name)), first);
  assert.deepEqual(await readdir(folder), [name]);
});
