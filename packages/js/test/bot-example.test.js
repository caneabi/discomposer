// Import the actual example with login disabled. Every interaction and HTTP response is a fixture.
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { after, before, test } from "node:test";
import { Client, Collection, Events, PermissionFlagsBits, PermissionsBitField } from "discord.js";

const ROLE = "111111111111111111";
let client;
let handle;
let folder;
before(async () => {
  folder = await mkdtemp(join(tmpdir(), "discomposer-bot-"));
  const source = await readFile(new URL("../../../examples/discordjs-bot.mjs", import.meta.url), "utf8");
  const file = join(folder, "example.mjs");
  await writeFile(file, source
    .replace('"discord.js"', JSON.stringify(import.meta.resolve("discord.js")))
    .replace('"discomposer"', JSON.stringify(new URL("../dist/index.js", import.meta.url).href)));
  const login = Client.prototype.login;
  Client.prototype.login = async function () { client = this; return "fixture"; };
  try { await import(pathToFileURL(file).href); }
  finally { Client.prototype.login = login; }
  handle = client.listeners(Events.InteractionCreate)[0];
});
after(async () => {
  await client?.destroy();
  if (folder) await rm(folder, { recursive: true, force: true });
});

function command({ allowed = true, cached = true, position = 5, fails = false } = {}) {
  const calls = [];
  const role = { id: ROLE, name: "News", editable: true, managed: false, position };
  const guild = {
    id: "222222222222222222", ownerId: "owner", name: "Fixture", memberCount: 1,
    iconURL: () => null, bannerURL: () => null,
    roles: { cache: new Collection([[ROLE, role]]) },
  };
  const interaction = {
    commandName: "send", guild, calls,
    member: { id: "manager", guild, roles: { highest: { comparePositionTo: (role) => 10 - role.position } } },
    memberPermissions: new PermissionsBitField(allowed ? PermissionFlagsBits.ManageRoles : 0n),
    options: { getString: () => "ABCDE-12345" },
    isChatInputCommand: () => true, inCachedGuild: () => cached,
    channel: { send: async () => {
      calls.push("send");
      if (fails) throw new Error("fixture delivery failure");
      return { id: "message" };
    } },
    deferReply: async () => { calls.push("defer"); interaction.deferred = true; },
    editReply: async ({ content }) => calls.push("edit:" + content),
    reply: async ({ content }) => { calls.push("reply:" + content); interaction.replied = true; },
  };
  return interaction;
}
const document = { design: { blocks: [{ select: {
  id: "roles", purpose: "role_picker", mode: "select", exclusive: false,
  options: [{ value: ROLE, label: "News", roles: [ROLE] }],
} }] } };

test("role picker commands reject missing permission and DMs before any fetch", async (t) => {
  let fetches = 0;
  t.mock.method(globalThis, "fetch", async () => { fetches++; throw new Error("Unexpected HTTP"); });
  for (const options of [{ allowed: false }, { cached: false }]) {
    const interaction = command(options);
    await handle(interaction);
    assert.deepEqual(interaction.calls, ["reply:Manage Roles in this server is required."]);
  }
  assert.equal(fetches, 0);
});

test("a fetched role above the configuring member is never published", async (t) => {
  t.mock.method(globalThis, "fetch", async () => new Response(JSON.stringify(document)));
  const interaction = command({ position: 20 });
  await handle(interaction);
  assert.equal(interaction.calls[0], "defer");
  assert.match(interaction.calls[1], /one role that you and the bot can manage/);
  assert.ok(!interaction.calls.includes("send"));
});

test("network work is deferred and success follows actual delivery", async (t) => {
  const interaction = command();
  t.mock.method(globalThis, "fetch", async () => {
    assert.equal(interaction.calls[0], "defer");
    interaction.calls.push("fetch");
    return new Response(JSON.stringify(document));
  });
  await handle(interaction);
  assert.deepEqual(interaction.calls, ["defer", "fetch", "send", "edit:Sent."]);
});

test("failed delivery never returns a success confirmation", async (t) => {
  t.mock.method(globalThis, "fetch", async () => new Response(JSON.stringify(document)));
  const interaction = command({ fails: true });
  await handle(interaction);
  assert.deepEqual(interaction.calls, ["defer", "send", "edit:The action could not be completed."]);
});
