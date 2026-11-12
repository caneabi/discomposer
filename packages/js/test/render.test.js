import assert from "node:assert/strict";
import { test } from "node:test";
import { ButtonBuilder, ButtonStyle } from "discord.js";
import { fillVariables, render, selectRows, validate } from "../dist/index.js";

const guild = {
  id: "1",
  name: "Example_Server",
  memberCount: 1234,
  iconURL: () => "https://cdn/icon.png",
  bannerURL: () => null,
  members: { cache: { size: 1 } },
};
const member = {
  id: "9",
  guild,
  displayName: "Max*",
  user: { username: "max" },
  joinedAt: new Date("2024-01-02T00:00:00Z"),
};

test("variables escape markdown and never invent unknown values", () => {
  assert.equal(fillVariables("{user} {server} {member_count} {member_number} {nope}", member), "Max\\* Example\\_Server 1,234 unknown {nope}");
});

test("render builds the same layout as the python library", () => {
  const { design } = validate({
    design: {
      color: 255,
      blocks: [
        { text: "#Titel {user}" },
        { image: "{server_icon}" },
        { gallery: "https://cdn/a.png" },
        { link: { label: "Web", url: "https://example.com" } },
        { button: { id: "known", label: "Los" } },
        { button: { id: "unknown", label: "Weg" } },
        { slot: "count" },
        { select: { id: "s", purpose: "role_picker", mode: "buttons", exclusive: true, options: [{ value: "a", label: "A" }] } },
      ],
    },
  });
  const data = render(design, {
    member,
    buttons: { known: (button) => new ButtonBuilder().setCustomId("x:known").setLabel(button.label).setStyle(ButtonStyle.Secondary) },
    slots: { count: "42" },
    selects: (menu) => selectRows(menu, "demo:s"),
  }).toJSON();
  assert.equal(data.accent_color, 255);
  assert.deepEqual(data.components.map((item) => item.type), [9, 12, 1, 10, 1]);
  assert.equal(data.components[0].components[0].content, "# Titel Max\\*");
  assert.equal(data.components[0].accessory.media.url, "https://cdn/icon.png");
  assert.deepEqual(data.components[2].components.map((item) => item.label), ["Web", "Los"]);
  assert.equal(data.components[3].content, "42");
  assert.equal(data.components[4].components[0].custom_id, "demo:s:a");
});

test("select menu allows clearing when not exclusive", () => {
  const { design } = validate({
    design: { blocks: [{ select: { id: "t", purpose: "ticket_categories", mode: "select", exclusive: false, options: [{ value: "a", label: "A" }, { value: "b", label: "B" }] } }] },
  });
  const menu = selectRows(design.blocks[0].select, "demo:t")[0].toJSON().components[0];
  assert.equal(menu.custom_id, "demo:t");
  assert.deepEqual([menu.min_values, menu.max_values], [0, 2]);
  assert.deepEqual(menu.options.map((option) => option.value), ["a", "b"]);
});

test("renderMessage puts content outside the container", async () => {
  const { renderMessage } = await import("../dist/index.js");
  const { design } = validate({ design: { content: "<@&1> {server}", blocks: [{ text: "Innen" }] } });
  const items = renderMessage(design, { guild }).map((item) => item.toJSON());
  assert.deepEqual(items.map((item) => item.type), [10, 17]);
  assert.equal(items[0].content, "<@&1> Example\\_Server");
});




test("all gallery images survive grouping into Discord's ten-item galleries", () => {
  const urls = Array.from({ length: 20 }, (_, n) => "https://images.example/" + n + ".png");
  const data = render({ blocks: urls.map((gallery) => ({ gallery })) }).toJSON();
  assert.deepEqual(data.components.map((gallery) => gallery.items.length), [10, 10]);
  assert.deepEqual(data.components.flatMap((gallery) => gallery.items.map((item) => item.media.url)), urls);
});

test("outside-only messages omit empty containers and empty output fails clearly", async () => {
  const { renderMessage, TemplateError } = await import("../dist/index.js");
  assert.deepEqual(renderMessage({ content: "Only outside", blocks: [] }).map((item) => item.toJSON()), [
    { type: 10, content: "Only outside" },
  ]);
  assert.throws(() => renderMessage({ blocks: [{ slot: "missing" }] }), TemplateError);
});

test("unregistered action IDs never resolve inherited object properties", () => {
  const blocks = ["constructor", "toString", "__proto__"].flatMap((id) => [
    { button: { id, label: "Unknown", style: "secondary" } }, { slot: id },
  ]);
  const data = render({ blocks: [{ text: "Known" }, ...blocks] }).toJSON();
  assert.deepEqual(data.components, [{ type: 10, content: "Known" }]);
});



test("empty variable values do not leave empty text displays", async () => {
  const { renderMessage, TemplateError, buttonStyle } = await import("../dist/index.js");
  assert.throws(() => renderMessage({ content: "{mention}", blocks: [{ text: "{nickname}" }] }), TemplateError);
  assert.equal(renderMessage({ content: " ", blocks: [{ text: "Visible" }] }).length, 1);
  assert.equal(buttonStyle("constructor"), ButtonStyle.Secondary);
});



test("one render scans a complete member cache once for all text blocks", () => {
  let scans = 0;
  const completeGuild = { ...guild, memberCount: 1, members: {
    cache: { size: 1, filter() { scans++; return { size: 0 }; } },
  } };
  const completeMember = { ...member, guild: completeGuild };
  const data = render({ blocks: Array.from({ length: 20 }, () => ({ text: "{member_number}" })) }, {
    member: completeMember,
  }).toJSON();
  assert.equal(data.components[0].content, Array(20).fill("1").join("\n"));
  assert.equal(scans, 1);
});
