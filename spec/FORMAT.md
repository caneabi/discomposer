# Template format v1

A template is a JSON document that the editor stores and a bot fetches with a code. The format is not tied to any bot: everything a bot offers on top (its own buttons, dynamic blocks, selections) is described in the document's `context`.

[schema.json](schema.json) and the [fixtures](fixtures/) are authoritative. The editor and both libraries are tested against the same fixtures.

## Document

| Field | Meaning |
| --- | --- |
| `version` | `1`. If missing, v1 is assumed. |
| `design` | Required. `blocks` (at most 20), `content` (text above the container, at most 2000 characters, e.g. for pings), `color` (0 to 0xFFFFFF), `keepBotImage` (`large`, `small`). `content` and all text blocks together may have at most 3500 characters. |
| `context` | What the bot offers; the editor shows it for selection. |
| `title`, `kind`, `template`, `note`, `returnHint`, `sender`, `messageType` | Shown in the editor. Bots may ignore them. |

Unknown fields make the document invalid.

## Blocks

Every block is an object with exactly one key.

| Block | Value |
| --- | --- |
| `text` | Markdown. Variables such as `{user}` are replaced when rendering. |
| `image` | Small image next to the first text: an HTTPS URL, `{server_icon}` or `{server_banner}`. |
| `gallery` | Full-width image. Same sources as `image`. |
| `separator` | `true` |
| `link` | `{ label, url, emoji? }` |
| `button` | `{ id, label, emoji?, style? }`. `id` must be a button from `context.buttons`; the bot decides what it does. |
| `slot` | ID of a dynamic block from `context.slots`, filled by the bot when sending. |
| `select` | A selection with a purpose, see below. |

### Selections (`select`)

```json
{ "select": {
  "id": "tickets", "purpose": "ticket_categories",
  "mode": "select", "exclusive": true, "placeholder": "What is it about?",
  "options": [ { "value": "support", "label": "Support", "emoji": "🛟", "description": "Questions", "roles": ["123456789012345678"] } ]
} }
```

- `purpose` belongs to the bot (e.g. `role_picker`, `ticket_categories`). The libraries only report which option was chosen and which roles it carries.
- `mode`: `select` (select menu) or `buttons` (one button per option).
- `exclusive`: at most one option at a time.
- `value` is unique within the selection, `id` within the document.
- 1 to 25 options, up to 10 roles each.
- Roles must be taken from the stored template, never from the interaction.

## Context

| Field | Content |
| --- | --- |
| `channels`, `roles`, `emojis` | `{ id, name }` for suggestions and the preview. |
| `buttons` | `{ id, label, icon? }` buttons with a bot function. `icon` is an HTTPS preview image used when no emoji is set. The editor inserts these buttons automatically. |
| `slots` | `{ id, label, sample? }` dynamic blocks. `sample` is the preview text. |
| `selects` | `{ purpose, label, roles, modes?, exclusive?, hint? }` selection types the bot understands. `roles`: `none`, `optional` or `single` (exactly one role per option; `value` is then the role ID). `modes` limits the display options, `exclusive` fixes that setting, `hint` explains it in the editor. |
| `accessory` | ID of a button shown next to the first text. |
| `footer` | `{ label?, rows }` fixed controls of the bot as rows of images (at most 5 × 5), preview only. |

## Fixtures

- `valid.json`: valid documents.
- `invalid.json`: invalid documents. `REPEAT_<n>` is replaced by `n` characters in tests.
