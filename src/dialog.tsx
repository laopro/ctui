import { createMemo, createSignal, For, Show } from "solid-js"
import { useKeyboard, useTerminalDimensions } from "@opentui/solid"
import fuzzysort from "fuzzysort"
import { T } from "./theme"

export type SelItem = { title: string; desc?: string; footer?: string; value?: any; cat?: boolean }

// Searchable list dialog (opencode's DialogSelect): type to filter, up/down, enter picks, esc closes.
export function Select(props: {
  title: string
  items: SelItem[]
  width?: number
  onPick: (v: any) => void
  onMove?: (v: any) => void
  onClose: () => void
}) {
  const dims = useTerminalDimensions()
  const [q, setQ] = createSignal("")
  const [sel, setSel] = createSignal(0)
  const rows = createMemo(() => {
    const needle = q().trim()
    if (!needle) return props.items
    const real = props.items.filter((i) => !i.cat)
    return fuzzysort.go(needle, real, { keys: ["title", "desc"] }).map((r) => r.obj)
  })
  const pickable = () => rows().filter((r) => !r.cat)
  const move = (d: number) => {
    const n = pickable().length
    if (!n) return
    const i = (sel() + d + n) % n
    setSel(i)
    props.onMove?.(pickable()[i].value)
  }
  useKeyboard((e) => {
    if (e.name === "escape") return props.onClose()
    if (e.name === "up" || (e.ctrl && e.name === "p")) return move(-1)
    if (e.name === "down" || (e.ctrl && e.name === "n")) return move(1)
    if (e.name === "return") {
      const it = pickable()[sel()]
      if (it) props.onPick(it.value)
      return
    }
    if (e.name === "backspace") return (setQ(q().slice(0, -1)), setSel(0))
    if (!e.ctrl && !e.meta && e.sequence.length === 1 && e.sequence >= " ") (setQ(q() + e.sequence), setSel(0))
  })
  const w = () => Math.min(props.width ?? 60, dims().width - 4)
  const max = () => Math.max(5, Math.min(14, dims().height - 10))
  const start = () => {
    const idx = rows().indexOf(pickable()[sel()])
    return Math.max(0, Math.min(idx - Math.floor(max() / 2), rows().length - max()))
  }
  return (
    <box position="absolute" left={0} top={0} width={dims().width} height={dims().height} alignItems="center" paddingTop={Math.floor(dims().height / 5)} backgroundColor="#00000099">
      <box width={w()} backgroundColor={T().panel} paddingLeft={2} paddingRight={2} paddingTop={1} paddingBottom={1}>
        <box flexDirection="row" justifyContent="space-between">
          <text fg={T().text}>{props.title}</text>
          <text fg={T().muted}>esc</text>
        </box>
        <text fg={q() ? T().text : T().muted} marginTop={1} marginBottom={1}>{q() || "Search"}▏</text>
        <For each={rows().slice(start(), start() + max())}>
          {(r) => {
            const on = () => !r.cat && pickable()[sel()] === r
            return (
              <Show
                when={!r.cat}
                fallback={<text fg={T().accent} marginTop={1}>{r.title}</text>}
              >
                <box
                  flexDirection="row"
                  justifyContent="space-between"
                  backgroundColor={on() ? T().primary : undefined}
                  onMouseDown={() => props.onPick(r.value)}
                  onMouseMove={() => setSel(pickable().indexOf(r))}
                >
                  <text fg={on() ? T().bg : T().text}>
                    {r.title}
                    <span style={{ fg: on() ? T().bg : T().muted }}>{r.desc ? "  " + r.desc : ""}</span>
                  </text>
                  <text fg={on() ? T().bg : T().muted}>{r.footer ?? ""}</text>
                </box>
              </Show>
            )
          }}
        </For>
        <Show when={!pickable().length}>
          <text fg={T().muted}>No results</text>
        </Show>
      </box>
    </box>
  )
}

export function Message(props: { title: string; body: string; onClose: () => void }) {
  const dims = useTerminalDimensions()
  useKeyboard((e) => (e.name === "escape" || e.name === "return") && props.onClose())
  return (
    <box position="absolute" left={0} top={0} width={dims().width} height={dims().height} alignItems="center" paddingTop={Math.floor(dims().height / 4)} backgroundColor="#00000099">
      <box width={Math.min(64, dims().width - 4)} backgroundColor={T().panel} padding={2}>
        <text fg={T().text}>{props.title}</text>
        <text fg={T().muted} marginTop={1}>{props.body}</text>
      </box>
    </box>
  )
}
