import assert from "node:assert/strict";
import { test } from "node:test";
import { readBody } from "../dist/transport.js";

test("an oversized Content-Length releases the reader even when cancellation fails", async () => {
  const stream = new ReadableStream({ cancel() { throw new Error("cancel failed"); } });
  const response = new Response(stream, { headers: { "content-length": "3" } });
  await assert.rejects(readBody(response, 2), RangeError);
  assert.equal(stream.locked, false);
});
