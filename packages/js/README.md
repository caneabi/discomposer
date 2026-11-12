<h1 align="center">discomposer for discord.js</h1>

<p align="center">
  Validate, fetch and send Discord message templates as Components V2.<br>
  Design the message in the <a href="https://editor.discomposer.dev">visual editor</a>, send it from your bot with a code.
</p>

[Website](https://discomposer.dev) · [Editor](https://editor.discomposer.dev) · [Documentation](https://docs.discomposer.dev)

<p align="center">
  <a href="https://www.npmjs.com/package/discomposer"><img src="https://img.shields.io/npm/v/discomposer?color=7b61ff" alt="npm"></a>
  <a href="https://github.com/caneabi/discomposer/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-MIT-ff7a59" alt="MIT license"></a>
  <img src="https://img.shields.io/badge/types-included-7b61ff" alt="TypeScript types included">
</p>

discomposer only builds messages. What a button or selection does (open a ticket, hand out a role) stays in your bot.

## Install

```bash
npm install discomposer discord.js
```

Requires Node.js 22+ and discord.js 14.19+.

## Fetch a template and send it

```js
import { ButtonBuilder, ButtonStyle, MessageFlags } from "discord.js";
import { EditorClient, MediaStore, renderMessage, selectRows } from "discomposer";

const editor = new EditorClient({ media: new MediaStore("data/media") });

async function send(channel, code) {
  const design = await editor.fetch(code); // validates and copies editor/Discord CDN images
  const components = renderMessage(design, {
    guild: channel.guild,
    buttons: { ticket: (b) => new ButtonBuilder().setCustomId("mybot:ticket").setLabel(b.label).setStyle(ButtonStyle.Primary) },
    slots: { online: "12 members online" },
    selects: (menu) => selectRows(menu, `mybot:${menu.id}`),
  });
  await channel.send({ components, files: editor.media.filesFor(design), flags: MessageFlags.IsComponentsV2 });
}
```

`renderMessage` returns the text outside the box (if any) and the filled container. Use `render` for just the container.

## Offer your bot's features in the editor

```js
import { guildContext } from "discomposer";

const link = await editor.open({
  title: "Ticket panel",
  context: {
    ...guildContext(guild),
    buttons: [{ id: "ticket", label: "Open ticket" }],
    selects: [{ purpose: "ticket_categories", label: "Ticket categories", roles: "optional" }],
  },
  design: { blocks: [{ text: "## Support" }] },
});
```

## Handle a selection

Values and roles only ever come from the stored template, never from the interaction:

```js
import { categoryRoles, chosenCategory, ticketOverwrites } from "discomposer";

const option = chosenCategory(savedDesign, "tickets", interaction.values[0]);
if (option) {
  const roles = categoryRoles(interaction.guild, option);
  await interaction.guild.channels.create({
    name: `ticket-${interaction.user.username}`,
    permissionOverwrites: ticketOverwrites(interaction.guild, interaction.member, roles),
  });
}
```

## Use your own editor or backend

Backend-only installs do not require discord.js. Bot users install both packages;
discord.js is an optional peer for the separate bot entry point.

```js
const editor = new EditorClient({
  baseUrl: "https://your-editor.example",
  media: new MediaStore("data/media"),
});
```

Shared links supply a code; they never change the configured host. Both `baseUrl`
and the default editor use the same open [HTTP protocol](https://github.com/caneabi/discomposer/blob/main/spec/API.md).
To build a backend without a UI, use `TemplateServer` from `discomposer/server`
with your own storage adapter. `discomposer/format` exports the format and validator
without loading Discord or filesystem code. The standard package entry still
provides the bot integration. The hosted frontend remains closed source.

The bot-facing client uses the network and `MediaStore` reads/writes its configured
local image directory. These capabilities are part of their documented purpose;
the package does not launch subprocesses or evaluate template code.

## API overview

| Area | Functions |
| --- | --- |
| Format | `validate`, `validateDesign`, `findSelect`, `selectsFor`, `chosenOptions` |
| Sending | `render`, `renderMessage`, `outsideText`, `selectRows`, `addItem`, `fillVariables`, `VARIABLES` |
| Editor | `EditorClient` (`open`, `fetch`, `fetchDocument`, `upload`, `adoptImages`, `exposeAttachments`), `guildContext`, `parseCode` |
| Images | `MediaStore` (`save`, `filesFor`) |
| Tickets | `ticketCategories`, `chosenCategory`, `categoryRoles`, `missingRoles`, `ticketOverwrites`, `transcriptMarkdown` |

Errors: `TemplateError` (format), `EditorError` (editor, network), `MediaError` (images). Messages are written for end users.

The template format is specified in [spec/FORMAT.md](https://github.com/caneabi/discomposer/blob/main/spec/FORMAT.md). A Python version for discord.py is available as [`discomposer` on PyPI](https://pypi.org/project/discomposer/).

discomposer is not affiliated with or endorsed by Discord Inc.



Use one MediaStore instance per directory. Saves through that instance serialize
quota checks and publish complete files through an atomic rename. Separate processes
sharing a directory need coordination supplied by the application.


Image adoption copies editor uploads and Discord CDN images. Other HTTPS image URLs
remain external references and depend on their host remaining available.
