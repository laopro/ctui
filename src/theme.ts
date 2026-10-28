// Colour palettes derived from opencode's themes (https://github.com/sst/opencode, MIT).
import { createSignal } from "solid-js"
import { SyntaxStyle } from "@opentui/core"
import themes from "./themes.json"
import { loadConfig } from "./config"

export type Palette = {
  primary: string
  secondary: string
  accent: string
  error: string
  warning: string
  success: string
  info: string
  text: string
  textMuted: string
  background: string
  backgroundPanel: string
  backgroundElement: string
  border: string
}

export const THEMES = themes as Record<string, Palette>
export const themeNames = Object.keys(THEMES)

export function blend(a: string, b: string, t: number): string {
  const p = (h: string, i: number) => parseInt(h.slice(i, i + 2), 16)
  const mix = (i: number) =>
    Math.round(p(a, i) * t + p(b, i) * (1 - t))
      .toString(16)
      .padStart(2, "0")
  return `#${mix(1)}${mix(3)}${mix(5)}`
}

const initial = process.env.CTUI_THEME || (loadConfig().theme as string) || "opencode"
export const [themeName, setThemeName] = createSignal(THEMES[initial] ? initial : "opencode")

// Accessor used everywhere: T().text, T().muted, ...
export function T() {
  const p = THEMES[themeName()] ?? THEMES.opencode
  return {
    bg: p.background,
    panel: p.backgroundPanel,
    elem: p.backgroundElement,
    border: p.border,
    muted: p.textMuted,
    text: p.text,
    primary: p.primary,
    secondary: p.secondary,
    accent: p.accent,
    red: p.error,
    orange: p.warning,
    green: p.success,
    cyan: p.info,
    addBg: blend(p.success, p.backgroundPanel, 0.2),
    delBg: blend(p.error, p.backgroundPanel, 0.2),
  }
}

let cache: { name: string; style: SyntaxStyle } | undefined
export function syntax(): SyntaxStyle {
  const name = themeName()
  if (cache?.name === name) return cache.style
  const p = THEMES[name] ?? THEMES.opencode
  const r = (scope: string[], fg: string, style: Record<string, any> = {}) => ({ scope, style: { foreground: fg, ...style } })
  const style = SyntaxStyle.fromTheme([
    r(["default"], p.text),
    r(["comment", "comment.documentation"], p.textMuted, { italic: true }),
    r(["string", "symbol", "character.special", "character"], p.success),
    r(["number", "boolean", "constant", "float"], p.warning),
    r(["keyword", "keyword.return", "keyword.conditional", "keyword.repeat"], p.accent, { italic: true }),
    r(["keyword.function", "function.method", "function", "constructor", "variable.member"], p.primary),
    r(["type", "module", "class", "namespace"], p.info),
    r(["variable", "property", "parameter", "field"], p.text),
    r(["operator", "keyword.operator", "punctuation", "punctuation.delimiter", "punctuation.bracket"], p.textMuted),
    r(["markup.heading", "markup.heading.2", "markup.heading.3", "markup.heading.4", "markup.heading.5", "markup.heading.6"], p.accent, { bold: true }),
    r(["markup.heading.1"], p.accent, { bold: true, underline: true }),
    r(["markup.bold", "markup.strong"], p.warning, { bold: true }),
    r(["markup.italic"], p.warning, { italic: true }),
    r(["markup.list"], p.primary),
    r(["markup.quote"], p.warning, { italic: true }),
    r(["markup.raw", "markup.raw.block", "markup.raw.inline"], p.success),
    r(["markup.link", "markup.link.url", "string.special", "string.special.url"], p.primary, { underline: true }),
    r(["markup.link.label", "label"], p.info, { underline: true }),
    r(["markup.strikethrough"], p.textMuted),
  ] as any)
  cache = { name, style }
  return style
}
