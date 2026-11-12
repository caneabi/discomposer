# Editor protocol

discomposer's template format and HTTP protocol are public and MIT-licensed. The hosted
editor at https://editor.discomposer.dev is a separate, closed-source application.
You can implement your own editor or backend using this contract.

## Choose an editor

Configure the URL in your bot, rather than taking a destination from user input:

```js
import { EditorClient, MediaStore } from "discomposer";

const editor = new EditorClient({
  baseUrl: "https://your-editor.example",
  media: new MediaStore("data/media"),
});
```

```python
from discomposer import EditorClient, MediaStore

editor = EditorClient(
    base_url="https://your-editor.example",
    media=MediaStore("data/media"),
)
```

The default remains `https://editor.discomposer.dev`. Trailing slashes are removed.
URLs must use HTTP(S), without credentials, query strings or fragments. Use HTTPS
for a hosted service; HTTP is useful for local development. Image sources inside
templates still require HTTPS. A shared link supplies only the code: its hostname
never changes the bot's configured editor. Codes belong to one backend.

The standard link is `BASE_URL/e/CODE`. Your frontend implements that route and
uses the API below. If frontend and API use separate origins, route the API through
the configured editor origin. The library does not configure browser CORS policy.

## Bot → editor → bot

1. The bot constructs a document with `context` and `design` and calls `open`.
2. The backend validates and stores it; the client returns the editor link.
3. The frontend loads that document and offers the features declared in `context`.
4. Saving posts a new document and creates a new code. Existing codes remain unchanged.
5. The user gives the new code to the bot. There is no callback, webhook or bot token.
6. The bot fetches and validates the document, keeps its own images and persists the
   accepted design. `renderMessage` / `render_message` builds Components V2.
7. The bot handles interactions using its stored design and its own authorization.

`context.buttons` declares supported action IDs, `context.slots` dynamic text IDs,
and `context.selects` supported selection purposes. `design.blocks` contains the
user's chosen layout, labels and options. The [format](FORMAT.md) describes each field.

The editor supplies data, never executable handlers or trusted permissions. A bot
maps supported IDs and purposes to its own code, rejects unsupported actions, and
checks which roles an administrator is allowed to offer. Lookup of an interaction's
selected options uses the stored design, never roles supplied with the interaction.
The declarations in a fetched document are not proof that your bot offered them.

## HTTP endpoints

| Method | Path | Success |
| --- | --- | --- |
| POST | `/api/templates` | `201 {"code":"K7F3M-9QX2A"}` |
| GET | `/api/templates/CODE` | `200` with a complete template document |
| POST | `/api/images` | `201 {"path":"/api/images/SHA256"}` |
| GET / HEAD | `/api/images/SHA256` | `200` with image bytes / headers only |

Template POSTs require `Content-Type: application/json` and at most 64 KiB of UTF-8
JSON. Validate using the same rules as the bot libraries. The backend may normalize
omitted optional values, such as a button's default style. Save all supported
document fields, including `context` and editor hints.

Codes use `[0-9A-HJKMNP-TV-Z]{5}-[0-9A-HJKMNP-TV-Z]{5}`. Lookup accepts lowercase.
Generate codes with cryptographically secure randomness and do not replace an
existing document on a collision.

Image POSTs contain raw bytes, conventionally `application/octet-stream`, at most
8 MiB. PNG, JPEG, GIF and WebP are accepted based on their signatures. SVG is
rejected. IDs are lowercase SHA-256 hex digests (64 characters). Return an API path
on the configured editor, not an arbitrary download destination.

Templates and uploaded images expire after 30 days. Reads refresh retention at
most once daily; this is a rolling, approximate lifetime. Image responses may be
cached for one day. Keep a permanent bot-side copy of accepted designs and images.
`MediaStore` plus `fetch` adopts hosted images as local attachments.

| Status | Meaning |
| --- | --- |
| 400 | Invalid document, code or image ID |
| 404 | Unknown/expired code or image, or unsupported endpoint/method |
| 413 | Request exceeds the byte limit |
| 415 | Template request is not JSON, or image signature is unsupported |
| 429 | Host write policy rejected the request |
| 503 | Backend unavailable, including storage errors |

Errors are JSON objects with an English `error` string. Template responses use
`Cache-Control: no-store`. Clients do not follow redirects or automatically retry
ambiguous writes.

Anyone who knows a code or image URL can read it. These are share links, not
authenticated storage: omit secrets, private channel lists and member lists.
The hosted editor currently allows 60 template writes and 30 image writes per hour
per IP on a best-effort basis; other hosts own their rate-limiting policy.

## Reuse the backend without the frontend

The JS package provides `discomposer/server` and `discomposer/format`. Both entry
points run without loading discord.js or Node filesystem modules. Backend-only
installs do not require discord.js; bot users install both packages.

```ts
import { TemplateServer } from "discomposer/server";

const api = new TemplateServer({
  store: yourStore,
  allowWrite: async (request, kind) => yourLimiter.allow(request, kind),
});

// In your HTTP adapter:
const response = await api.fetch(request);
```

`TemplateServer` owns routes, validation, codes, image hashing, bounded body reads,
response headers and retention refreshes. The host supplies a `TemplateStore`:

- `get(key)` returns `{ value: Uint8Array, savedAt: number, contentType?: string }`
  or `null`. `savedAt` is epoch milliseconds. Expired records must return `null`.
- `put(key, entry, ttlSeconds)` stores/replaces an entry with the supplied expiry.
- `create(key, entry, ttlSeconds)` inserts a new template and returns `false` on an
  existing key. Use an atomic insert/unique constraint to enforce this under concurrency.

Keys are `code:CODE` and `image:SHA256`. Await persistence before returning success.
The service propagates storage failures as `503` and retries only confirmed code
collisions. `allowWrite` is optional; without it, the class applies byte and format
limits but does not impose request quotas. Enforce host limits before public exposure.
The optional second argument to `fetch` accepts a background-task callback, such as
a worker's `waitUntil`. Without it, retention refreshes are awaited.

[examples/template-server.mjs](../examples/template-server.mjs) is a runnable local
Node reference with an expiring, bounded memory store. It has no frontend and loses
data on restart. Replace its store and provide a host write policy for deployment.

## Current format only

The supported blocks are `text`, `image`, `gallery`, `separator`, `link`, `button`,
`slot` and `select`. Historical `roles` and `ticket_menu` blocks are rejected.
Application-specific migration belongs to the application that owns those records.


The role-picker bot examples require Manage Roles for configuration and publishing.
They check imported role IDs against both the configuring member's hierarchy and
the bot's assignable roles. Interaction responses are deferred before network work;
successful delivery is confirmed only after the message has been sent. They only
add selected roles and do not implement removal on clearing a selection.
