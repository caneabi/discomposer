<h1 align="center">discomposer</h1>

<p align="center">
  Discord message templates for bots: design messages in a visual editor, send them as Components V2 from discord.py or discord.js.
</p>

<p align="center">
  <a href="https://pypi.org/project/discomposer/"><img src="https://img.shields.io/pypi/v/discomposer?label=PyPI" alt="PyPI"></a>
  <a href="https://www.npmjs.com/package/discomposer"><img src="https://img.shields.io/npm/v/discomposer?label=npm" alt="npm"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue" alt="MIT license"></a>
</p>

## How it works

1. Your bot opens a template in the [editor](https://editor.caneabi.dev) and describes what it offers (buttons, dynamic blocks, selections such as ticket categories or role pickers).
2. A server admin designs the message and gets a short code.
3. Your bot fetches the template with the code, validates it, keeps a copy of every image and sends it.

What buttons and selections do stays in your bot. The libraries only build and validate messages.

## Packages

| Package | For | Install |
| --- | --- | --- |
| [packages/python](packages/python) | discord.py 2.6+ | `pip install discomposer` |
| [packages/js](packages/js) | discord.js 14.19+ | `npm install discomposer` |

Both libraries implement the same [template format](spec/FORMAT.md) and are tested against the same [fixtures](spec/fixtures), so a template behaves the same in either language.

## Examples

- [examples/discordpy_bot.py](examples/discordpy_bot.py): role picker bot with discord.py
- [examples/discordjs-bot.mjs](examples/discordjs-bot.mjs): the same bot with discord.js

## Development

```bash
cd packages/python && pip install -e ".[test]" && python -m pytest
cd packages/js && npm ci && npm test
```

Releases are described in [RELEASING.md](RELEASING.md).

## License

MIT. The hosted editor at editor.caneabi.dev is a separate, closed-source service.

discomposer is not affiliated with or endorsed by Discord Inc.
