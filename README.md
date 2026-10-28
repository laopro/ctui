# ctui

A terminal UI for Claude, built on the public Claude Agent SDK, with OpenTUI + SolidJS. Not affiliated with, endorsed by, or sponsored by Anthropic.

## Install
```
npm install
npm run build        # optional single binary in dist/ (untested with the SDK)
```
Put `bin/` on your PATH, then run `ctui` in any folder.

## Usage
`ctui [path] [--resume <id>] [-m <model>] [--mode default|acceptEdits|plan] [--theme <name>] [--list-themes] [--version]`

Keys: `ctrl+p` commands · `/` slash commands · `@` files · `tab`/`shift+tab` mode · `esc` interrupt · `ctrl+t` new tab · `ctrl+w` close · `alt+up/down` switch tabs · `ctrl+x` leader (`n l m a t s b c w q`, `1-9`) · `ctrl+d` quit.
Tabs are restored per folder. Config: `%APPDATA%\ctui\config.json`.

## Dev
`npm test` · `npm run typecheck` · `bun scripts/t4.tsx "prompt"` (real Claude smoke test)

MIT. Themes derived from opencode (MIT).
