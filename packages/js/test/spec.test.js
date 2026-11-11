import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { chosenOptions, TemplateError, validate } from "../dist/index.js";

const fixtures = (name) =>
  JSON.parse(readFileSync(new URL(`../../../spec/fixtures/${name}.json`, import.meta.url), "utf8"), (key, value) =>
    typeof value === "string" && value.startsWith("REPEAT_") ? "x".repeat(Number(value.slice(7))) : value,
  );

for (const { name, doc } of fixtures("valid")) {
  test(`valid: ${name}`, () => {
    const cleaned = validate(doc);
    assert.deepEqual(validate(cleaned), cleaned);
  });
}

for (const { name, doc } of fixtures("invalid")) {
  test(`invalid: ${name}`, () => assert.throws(() => validate(doc), TemplateError));
}

test("chosen options come only from the stored template", () => {
  const { design } = validate(fixtures("valid")[3].doc);
  const chosen = chosenOptions(design, "tickets", ["support", "admin"]);
  assert.deepEqual(chosen.map((option) => option.value), ["support"]);
  assert.deepEqual(chosen[0].roles, ["333333333333333333"]);
  assert.deepEqual(chosenOptions(design, "other", ["support"]), []);
});

test("python and js clean documents identically", () => {
  // Same normalization as the Python library: default button style, empty fields dropped.
  const { design } = validate({ design: { blocks: [{ button: { id: "a", label: "A", emoji: "" } }] } });
  assert.deepEqual(design.blocks, [{ button: { id: "a", label: "A", style: "secondary" } }]);
});

