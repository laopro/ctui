import { createMemo, createSignal, For, Match, onCleanup, Show, Switch } from "solid-js"
import { createStore, produce } from "solid-js/store"
import { useKeyboard, useRenderer, useTerminalDimensions } from "@opentui/solid"
import { createClipboard, createHostClipboard, createRendererClipboardAdapter, decodePasteBytes } from "@opentui/core"
import { getSessionMessages } from "@anthropic-ai/claude-agent-sdk"
import { createTwoFilesPatch } from "diff"
import fuzzysort from "fuzzysort"
import { basename, extname, relative } from "node:path"
import { Chat, type PermissionChoice } from "./claude"
import { T, syntax } from "./theme"

export const SplitBorder = { topLeft: "", bottomLeft: "", vertical: "┃", topRight: "", bottomRight: "", horizontal: " ", bottomT: "", topT: "", cross: "", leftT: "", rightT: "" }

type Item =
  | { k: "user"; text: string; images?: number }
  | { k: "text"; text: string }
  | { k: "tool"; id: string; name: string; input: Record<string, any>; out?: string; err?: boolean }
  | { k: "info"; text: string; err?: boolean }
type Row = { name: string; desc: string; ui: boolean; path?: string; args?: boolean; aliases?: string[] }

export const MODES = ["default", "acceptEdits", "plan"]
export const MODE_LABEL: Record<string, string> = { default: "Build", acceptEdits: "Edits", plan: "Plan" }
export type Local = { name: string; desc: string; cat: string; key?: string; aliases?: string[]; args?: boolean }
// Mirrors opencode's slash commands (names, aliases, categories); undo/redo/connect don't exist for Claude.
export const LOCAL: Local[] = [
  { name: "sessions", aliases: ["resume", "continue"], desc: "Resume a session", cat: "Session", key: "ctrl+x l" },
  { name: "new", desc: "New session", cat: "Session", key: "ctrl+t" },
  { name: "clear", desc: "Clear this session", cat: "Session" },
  { name: "rename", args: true, desc: "Rename session", cat: "Session" },
  { name: "fork", desc: "Fork session into a new tab", cat: "Session" },
  { name: "compact", desc: "Compact conversation", cat: "Session", key: "ctrl+x c" },
  { name: "diff", desc: "Show git diff", cat: "Session" },
  { name: "open", aliases: ["projects", "project"], desc: "Open a recent project", cat: "Session" },
  { name: "cd", args: true, desc: "Open a folder in a new tab", cat: "Session" },
  { name: "undo", desc: "Undo last message", cat: "Session" },
  { name: "redo", desc: "Redo", cat: "Session" },
  { name: "models", desc: "Switch model", cat: "Agent", key: "ctrl+x m" },
  { name: "agents", desc: "Switch agent", cat: "Agent", key: "tab" },
  { name: "variants", aliases: ["thinking", "effort"], desc: "Switch effort", cat: "Agent" },
  { name: "mcps", aliases: ["mcp"], desc: "Toggle MCPs", cat: "Agent" },
  { name: "skills", desc: "Skills", cat: "Prompt" },
  { name: "status", desc: "View status", cat: "System", key: "ctrl+x s" },
  { name: "connect", desc: "Log in", cat: "System" },
  { name: "themes", desc: "Switch theme", cat: "System", key: "ctrl+x t" },
  { name: "help", desc: "Help", cat: "System" },
  { name: "exit", aliases: ["quit", "q"], desc: "Exit the app", cat: "System", key: "ctrl+d" },
]
export const findLocal = (n: string) => LOCAL.find((l) => l.name === n || l.aliases?.includes(n))
const SAFE_SKIP = new Set(["node_modules", ".git", "dist", ".venv", "__pycache__"])
const brief = (i: Record<string, any>) => String(i.file_path ?? i.command ?? i.pattern ?? i.url ?? i.description ?? "").slice(0, 120)
const ft = (p: string) => ({ ts: "typescript", tsx: "tsx", js: "javascript", jsx: "jsx", py: "python", json: "json", md: "markdown", rs: "rust", go: "go", css: "css", html: "html", sh: "bash" })[extname(p).slice(1)]

export type SessionApi = { chat: Chat; mode: () => string; setMode: (m: string) => void; model: () => string; setModel: (m: string) => void; status: () => string; effort: (l: string) => void; clear: () => void; info: () => string[] }
export type SessionProps = {
  id: number
  cwd: string
  resume?: string
  model?: string
  mode: string
  active: boolean
  blocked: boolean
  sidebar: boolean
  run: (cmd: string, arg?: string) => void
  toast: (m: string) => void
  onSession: (sessionId: string) => void
  onUnread: () => void
  register: (api: SessionApi) => void
}

const files = new Map<string, Promise<string[]>>()
function listFiles(cwd: string) {
  if (!files.has(cwd))
    files.set(
      cwd,
      (async () => {
        const out: string[] = []
        try {
          for await (const f of new Bun.Glob("**/*").scan({ cwd, onlyFiles: true }) as AsyncIterable<string>) {
            if (f.split(/[\\/]/).some((s) => SAFE_SKIP.has(s))) continue
            out.push(f.replaceAll("\\", "/"))
            if (out.length >= 5000) break
          }
        } catch {}
        return out
      })(),
    )
  return files.get(cwd)!
}

export function Session(props: SessionProps) {
  const dims = useTerminalDimensions()
  const renderer = useRenderer()
  const clipboard = createClipboard({ host: createHostClipboard(), terminal: createRendererClipboardAdapter(renderer) })
  onCleanup(() => void clipboard.dispose())
  const [images, setImages] = createSignal<{ mime: string; data: string }[]>([])
  const pasteClipboard = async () => {
    const r = await clipboard.read({ preferredTypes: ["image/png", "text/plain"], selection: "clipboard" }).catch(() => undefined)
    if (!r || r.status !== "read") return void (r?.status === "failed" && props.toast("Clipboard read failed"))
    const { mimeType, bytes } = r.representation
    if (mimeType === "image/png") {
      setImages((a) => [...a, { mime: mimeType, data: Buffer.from(bytes).toString("base64") }])
      return props.toast(`Image attached (${images().length})`)
    }
    if (mimeType === "text/plain" && bytes.length) setPrompt(text() + decodePasteBytes(bytes))
  }
  const [items, setItems] = createStore<Item[]>([])
  const [busy, setBusy] = createSignal(false)
  const [mode, setModeS] = createSignal(props.mode)
  const [model, setModelS] = createSignal(props.model ?? "default")
  const [perm, setPerm] = createSignal<{ tool: string; input: Record<string, any>; res: (c: PermissionChoice) => void }>()
  const [started, setStarted] = createSignal(0)
  const [status, setStatus] = createSignal("")
  const [text, setText] = createSignal("")
  const [dismissed, setDismissed] = createSignal("")
  const [sel, setSel] = createSignal(0)
  const [fileList, setFileList] = createSignal<string[]>([])
  const [tick, setTick] = createSignal(0)
  const [ctx, setCtx] = createSignal<{ tokens: number; pct: number; model: string }>()
  const [mcp, setMcp] = createSignal<{ name: string; status: string }[]>([])
  const modelLabel = () => {
    if (model() !== "default") return model()
    const id = ctx()?.model
    return id ? chat.models.find((m) => m.value === id)?.displayName ?? id : "default"
  }
  const history: string[] = []
  let hpos = -1
  let input: any

  const refresh = async () => {
    setTick(tick() + 1)
    const c = await chat.context()
    if (c) setCtx(c)
    setMcp((await chat.mcp()).filter((m) => !m.name.startsWith("claude.ai")))
  }

  const chat: Chat = new Chat(
    { cwd: props.cwd, model: props.model, mode: props.mode, resume: props.resume },
    {
      ready: () => setTimeout(refresh, 3000),
      textStart: () => setItems(items.length, { k: "text", text: "" }),
      textDelta: (d) =>
        setItems(
          produce((a) => {
            const l = a[a.length - 1]
            if (l?.k === "text") l.text += d
          }),
        ),
      thinking: () => {},
      toolUse: (id, name, inp) => setItems(items.length, { k: "tool", id, name, input: inp }),
      toolResult: (id, t, err) =>
        setItems(
          produce((a) => {
            const x = a.find((y) => y.k === "tool" && y.id === id)
            if (x && x.k === "tool") (x.out = t), (x.err = err)
          }),
        ),
      result: (r) => {
        setBusy(false)
        const s = (Date.now() - started()) / 1000
        setStatus(`${s.toFixed(1)}s${r.outTokens ? ` · ${(r.outTokens / s).toFixed(0)} tok/s` : ""}`)
        props.onSession(r.sessionId)
        if (!props.active) props.onUnread()
        void refresh()
      },
      error: (m) => (setBusy(false), setItems(items.length, { k: "info", text: m, err: true })),
      askPermission: (tool, inp) => new Promise((res) => setPerm({ tool, input: inp, res })),
    },
  )
  chat.start()
  onCleanup(() => chat.close())

  props.register({
    chat,
    mode,
    setMode: (m) => (setModeS(m), void chat.setMode(m)),
    model,
    setModel: (m) => (setModelS(m), void chat.setModel(m)),
    status,
    effort: (l) => void chat.effort(l),
    clear: () => (setItems([]), setStatus("")),
    info: () => [
      `cwd: ${props.cwd}`,
      `model: ${model()}`,
      `agent: ${MODE_LABEL[mode()]}`,
      `context: ${ctx() ? ctx()!.tokens.toLocaleString() + " tokens (" + Math.round(ctx()!.pct) + "%)" : "-"}`,
      `session: ${chat.sid ?? "(new)"}`,
      `mcp: ${mcp().map((m) => m.name + "=" + m.status).join(", ") || "none"}`,
    ],
  })

  if (props.resume)
    void getSessionMessages(props.resume, { dir: props.cwd })
      .then((ms: any[]) => {
        const out: Item[] = []
        for (const m of ms) {
          const c = m.message?.content
          if (m.type === "user" && typeof c === "string") out.push({ k: "user", text: c })
          else if (m.type === "assistant" && Array.isArray(c))
            for (const b of c) {
              if (b.type === "text" && b.text) out.push({ k: "text", text: b.text })
              else if (b.type === "tool_use") out.push({ k: "tool", id: b.id, name: b.name, input: b.input ?? {}, out: "" })
            }
        }
        setItems(out)
      })
      .catch(() => {})

  // ---- derived sidebar data
  const todos = createMemo(() => {
    for (let i = items.length - 1; i >= 0; i--) {
      const it = items[i]
      if (it.k === "tool" && it.name === "TodoWrite") return (it.input.todos ?? []) as { content: string; status: string }[]
    }
    return []
  })
  const modified = createMemo(() => {
    const s = new Set<string>()
    for (const it of items) if (it.k === "tool" && ["Edit", "Write", "MultiEdit", "NotebookEdit"].includes(it.name) && it.input.file_path) s.add(it.input.file_path)
    return [...s]
  })

  // ---- autocomplete
  const slash = () => text().match(/^\/(\S*)$/)
  const at = () => text().match(/(?:^|\s)@(\S*)$/)
  const rows = createMemo<Row[]>(() => {
    if (dismissed() === text()) return []
    const s = slash()
    if (s) {
      tick()
      const all: Row[] = [
        ...LOCAL.map((l) => ({ name: l.name, desc: l.desc, ui: true, args: l.args, aliases: l.aliases })),
        ...chat.commands.filter((c) => !findLocal(c.name) && c.name !== "model").map((c) => ({ name: c.name, desc: c.description ?? "", ui: false })),
      ]
      const r = s[1] ? fuzzysort.go(s[1], all.map((x) => ({ ...x, k: [x.name, ...(x.aliases ?? [])].join(" ") })), { key: "k" }).map((x) => x.obj) : all
      return r.slice(0, 10)
    }
    const a = at()
    if (a) {
      const list = fileList()
      if (!list.length) void listFiles(props.cwd).then(setFileList)
      const r = a[1] ? fuzzysort.go(a[1], list, { limit: 10 }).map((x) => x.target) : list.slice(0, 10)
      return r.map((p) => ({ name: p, desc: "", ui: false, path: p }))
    }
    return []
  })

  const setPrompt = (v: string) => {
    input?.setText(v)
    input?.gotoBufferEnd?.()
    setText(v)
  }
  const choose = (r: Row) => {
    if (r.path) return setPrompt(text().replace(/@\S*$/, "@" + r.path + " "))
    if (r.ui && !r.args) {
      setPrompt("")
      return props.run(r.name)
    }
    setPrompt("/" + r.name + " ")
  }

  const submit = () => {
    const r = rows()
    if (r.length) return choose(r[Math.min(sel(), r.length - 1)])
    const v = (input?.plainText ?? "").trim()
    const imgs = images()
    if ((!v && !imgs.length) || busy()) return
    const ui = v.match(/^\/(\w+)(?:\s+([\s\S]*))?$/)
    const lc = ui && findLocal(ui[1])
    if (lc) return (setPrompt(""), props.run(lc.name, ui[2]?.trim()))
    history.push(v)
    hpos = -1
    setPrompt("")
    setImages([])
    setItems(items.length, { k: "user", text: v, images: imgs.length || undefined })
    setBusy(true)
    setStarted(Date.now())
    chat.send(v, imgs)
  }

  useKeyboard((e) => {
    if (!props.active || props.blocked) return
    const p = perm()
    if (p) {
      e.preventDefault()
      const c = ({ o: "once", a: "always", r: "reject", y: "once", n: "reject" } as Record<string, PermissionChoice>)[e.name]
      if (e.name === "return") return (setPerm(undefined), p.res("once"))
      if (e.name === "escape") return (setPerm(undefined), p.res("reject"))
      if (c) (setPerm(undefined), p.res(c))
      return
    }
    if (e.ctrl && e.name === "c") return busy() ? void chat.interrupt() : setPrompt("")
    if (e.ctrl && e.name === "v") return (e.preventDefault(), void pasteClipboard())
    const r = rows()
    if (r.length) {
      if (e.name === "up") return (e.preventDefault(), setSel((sel() - 1 + r.length) % r.length))
      if (e.name === "down") return (e.preventDefault(), setSel((sel() + 1) % r.length))
      if (e.name === "tab") return (e.preventDefault(), choose(r[Math.min(sel(), r.length - 1)]))
      if (e.name === "escape") return (e.preventDefault(), setDismissed(text()))
    }
    if (e.name === "escape" && busy()) return void chat.interrupt()
    if ((e.name === "up" || e.name === "down") && history.length && !text().includes("\n") && (!text() || hpos >= 0)) {
      e.preventDefault()
      hpos = e.name === "up" ? Math.min(hpos + 1, history.length - 1) : hpos - 1
      setPrompt(hpos < 0 ? "" : history[history.length - 1 - hpos])
    }
  })

  const Body = (p: { it: Item }) => (
    <Switch>
      <Match when={p.it.k === "user"}>
        <box border={["left"]} customBorderChars={SplitBorder} borderColor={T().accent} backgroundColor={T().panel} paddingLeft={2} paddingTop={1} paddingBottom={1} marginTop={1}>
          <text fg={T().text}>{(p.it as any).text}</text>
          <Show when={(p.it as any).images}>
            <text fg={T().muted}>🖼 {(p.it as any).images} image(s)</text>
          </Show>
        </box>
      </Match>
      <Match when={p.it.k === "text"}>
        <box marginTop={1} paddingLeft={3}>
          <markdown content={(p.it as any).text} syntaxStyle={syntax()} streaming={busy()} />
        </box>
      </Match>
      <Match when={p.it.k === "tool"}>
        {(() => {
          const t = p.it as Extract<Item, { k: "tool" }>
          const patch = () =>
            t.name === "Edit" && t.input.old_string !== undefined
              ? createTwoFilesPatch(basename(t.input.file_path), basename(t.input.file_path), t.input.old_string, t.input.new_string ?? "", "", "", { context: 2 })
              : undefined
          return (
            <box marginTop={1} paddingLeft={3}>
              <box flexDirection="row" gap={1}>
                <text fg={t.err ? T().red : T().muted}>{t.out === undefined ? "⋯" : t.err ? "✗" : "✓"}</text>
                <text fg={T().text}>{t.name}</text>
                <text fg={T().muted}>{brief(t.input)}</text>
              </box>
              <Show when={patch()}>
                <diff diff={patch()!} view="unified" filetype={ft(t.input.file_path)} syntaxStyle={syntax()} addedBg={T().addBg} removedBg={T().delBg} showLineNumbers={false} />
              </Show>
              <Show when={t.err && t.out}>
                <text fg={T().red}>{t.out!.slice(0, 300)}</text>
              </Show>
            </box>
          )
        })()}
      </Match>
      <Match when={p.it.k === "info"}>
        <text fg={(p.it as any).err ? T().red : T().muted} paddingLeft={3} marginTop={1}>{(p.it as any).text}</text>
      </Match>
    </Switch>
  )

  const showSide = () => props.sidebar && dims().width >= 100
  const Sec = (p: { title: string; children: any }) => (
    <box marginTop={1}>
      <text fg={T().text}>{p.title}</text>
      {p.children}
    </box>
  )

  return (
    <box flexDirection="row" flexGrow={1} visible={props.active}>
      <box flexDirection="column" flexGrow={1}>
        <Show
          when={items.length}
          fallback={
            <box flexGrow={1} alignItems="center" justifyContent="center" flexDirection="column">
              <text fg={T().primary}>{"█▀▀ █   ▄▀█ █ █ █▀▄ █▀▀"}</text>
              <text fg={T().primary}>{"█▄▄ █▄▄ █▀█ █▄█ █▄▀ ██▄"}</text>
              <text fg={T().muted} marginTop={1}>{props.cwd}</text>
            </box>
          }
        >
          <scrollbox flexGrow={1} stickyScroll stickyStart="bottom" paddingLeft={2} paddingRight={2}>
            <For each={items}>{(it) => <Body it={it} />}</For>
          </scrollbox>
        </Show>
        <Show when={perm()}>
          {(p) => (
            <box flexShrink={0} border={["left"]} customBorderChars={SplitBorder} borderColor={T().orange} backgroundColor={T().panel} paddingLeft={2} paddingTop={1} paddingBottom={1}>
              <text fg={T().orange}>Permission required: {p().tool}</text>
              <text fg={T().muted}>{brief(p().input)}</text>
              <text fg={T().text}>[enter/o] once  [a] always  [esc/r] reject</text>
            </box>
          )}
        </Show>
        <Show when={rows().length}>
          <box flexShrink={0} backgroundColor={T().panel} paddingLeft={1} paddingRight={1}>
            <For each={rows()}>
              {(r, i) => (
                <box flexDirection="row" justifyContent="space-between" backgroundColor={i() === Math.min(sel(), rows().length - 1) ? T().primary : undefined} onMouseDown={() => choose(r)}>
                  <text fg={i() === Math.min(sel(), rows().length - 1) ? T().bg : T().text}>
                    {r.path ?? "/" + r.name}
                    <span style={{ fg: i() === Math.min(sel(), rows().length - 1) ? T().bg : T().muted }}>{r.desc ? "  " + r.desc.slice(0, 60) : ""}</span>
                  </text>
                  <text fg={i() === Math.min(sel(), rows().length - 1) ? T().bg : T().muted}>{!r.path && !r.ui ? "skill" : ""}</text>
                </box>
              )}
            </For>
          </box>
        </Show>
        <box flexShrink={0} border={["left"]} customBorderChars={SplitBorder} borderColor={mode() === "plan" ? T().secondary : T().primary} backgroundColor={T().panel} paddingLeft={2} paddingRight={2} paddingTop={1} paddingBottom={1}>
          <Show when={images().length}>
            <text fg={T().muted}>🖼 {images().length} image{images().length > 1 ? "s" : ""} attached · ctrl+v to add more</text>
          </Show>
          <textarea
            ref={(r: any) => (input = r)}
            focused={props.active && !props.blocked && !perm()}
            placeholder="Ask anything…"
            minHeight={1}
            maxHeight={6}
            textColor={T().text}
            focusedTextColor={T().text}
            cursorColor={T().text}
            keyBindings={[
              { name: "return", action: "submit" },
              { name: "return", shift: true, action: "newline" },
              { name: "linefeed", action: "newline" },
              { name: "j", ctrl: true, action: "newline" },
            ]}
            onContentChange={() => (setText(input?.plainText ?? ""), setSel(0))}
            onSubmit={submit}
          />
          <box flexDirection="row" gap={2} marginTop={1}>
            <text fg={T().primary}>{MODE_LABEL[mode()] ?? mode()}</text>
            <text fg={T().text}>{modelLabel()}</text>
            <Show when={busy()}>
              <text fg={T().orange}>working… esc to interrupt</text>
            </Show>
            <Show when={!busy() && status()}>
              <text fg={T().muted}>{status()}</text>
            </Show>
          </box>
        </box>
      </box>
      <Show when={showSide()}>
        <box width={38} flexShrink={0} backgroundColor={T().panel} paddingLeft={2} paddingRight={2} paddingTop={1}>
          <text fg={T().text}>{basename(props.cwd)}</text>
          <Sec title="Context">
            <text fg={T().muted}>{ctx() ? `${ctx()!.tokens.toLocaleString()} tokens · ${Math.round(ctx()!.pct)}%` : "—"}</text>
          </Sec>
          <Show when={mcp().length}>
            <Sec title="MCP">
              <For each={mcp()}>
                {(m) => (
                  <text fg={T().muted}>
                    <span style={{ fg: m.status === "connected" ? T().green : m.status === "failed" ? T().red : T().orange }}>•</span> {m.name}
                  </text>
                )}
              </For>
            </Sec>
          </Show>
          <Show when={todos().length}>
            <Sec title="Todo">
              <For each={todos().slice(0, 8)}>
                {(t) => <text fg={t.status === "completed" ? T().muted : T().text}>{(t.status === "completed" ? "[✓] " : t.status === "in_progress" ? "[•] " : "[ ] ") + t.content.slice(0, 30)}</text>}
              </For>
            </Sec>
          </Show>
          <Show when={modified().length}>
            <Sec title="Modified Files">
              <For each={modified().slice(0, 8)}>{(f) => <text fg={T().muted}>{relative(props.cwd, f).slice(-32)}</text>}</For>
            </Sec>
          </Show>
        </box>
      </Show>
    </box>
  )
}
