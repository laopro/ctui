import { createSignal, For, type JSX, Show } from "solid-js"
import { createStore, produce } from "solid-js/store"
import { useKeyboard, useRenderer, useTerminalDimensions } from "@opentui/solid"
import { forkSession, listSessions, renameSession } from "@anthropic-ai/claude-agent-sdk"
import { basename, resolve } from "node:path"
import { existsSync } from "node:fs"
import { LOCAL, MODES, MODE_LABEL, Session, type SessionApi } from "./session"
import { Message, Select, type SelItem } from "./dialog"
import { T, THEMES, themeName, themeNames, setThemeName } from "./theme"
import { loadConfig, saveConfig } from "./config"

type Tab = { id: number; cwd: string; resume?: string; title: string; unread: boolean }
export type AppProps = { cwd: string; model?: string; mode: string; resume?: string }

export function App(props: AppProps) {
  const dims = useTerminalDimensions()
  const renderer = useRenderer()
  let nextId = 1
  const apis = new Map<number, SessionApi>()
  const closed: { cwd: string; resume?: string }[] = []
  const saved = props.resume ? undefined : loadConfig().tabs?.[props.cwd]
  const initial: Tab[] = (saved?.tabs?.length ? saved.tabs : [{ cwd: props.cwd, resume: props.resume }]).map((t: any) => ({
    id: nextId++,
    cwd: t.cwd,
    resume: t.resume,
    title: basename(t.cwd),
    unread: false,
  }))
  const [tabs, setTabs] = createStore<Tab[]>(initial)
  const [active, setActive] = createSignal(initial[Math.min(saved?.active ?? 0, initial.length - 1)].id)
  const [dialog, setDialog] = createSignal<() => JSX.Element>()
  const [toast, setToast] = createSignal("")
  const [leader, setLeader] = createSignal(false)
  const [sidebar, setSidebar] = createSignal(true)
  let toastT: any, leaderT: any

  const flash = (m: string) => {
    setToast(m)
    clearTimeout(toastT)
    toastT = setTimeout(() => setToast(""), 2500)
  }
  const persist = () => {
    const cfg = loadConfig()
    cfg.tabs = { ...cfg.tabs, [props.cwd]: { active: Math.max(0, tabs.findIndex((t) => t.id === active())), tabs: tabs.map((t) => ({ cwd: t.cwd, resume: t.resume })) } }
    saveConfig(cfg)
  }
  const cur = () => apis.get(active())
  const quit = () => {
    persist()
    for (const a of apis.values()) a.chat.close()
    renderer.destroy()
    process.exit(0)
  }
  const select = (id: number) => {
    setActive(id)
    setTabs((t) => t.id === id, "unread", false)
    persist()
  }
  const newTab = (cwd = props.cwd, resume?: string) => {
    const ex = resume ? tabs.find((t) => t.resume === resume) : undefined
    if (ex) return select(ex.id)
    const id = nextId++
    setTabs(tabs.length, { id, cwd, resume, title: resume ? "resumed" : basename(cwd), unread: false })
    select(id)
  }
  const closeTab = (id = active()) => {
    const i = tabs.findIndex((t) => t.id === id)
    if (i < 0) return
    if (tabs.length === 1) return quit()
    closed.push({ cwd: tabs[i].cwd, resume: tabs[i].resume })
    apis.delete(id)
    setTabs(produce((a) => void a.splice(i, 1)))
    if (active() === id) select(tabs[Math.max(0, i - 1)].id)
    else persist()
  }
  const cycle = (d: number) => {
    const i = tabs.findIndex((t) => t.id === active())
    select(tabs[(i + d + tabs.length) % tabs.length].id)
  }
  const close = () => setDialog(undefined)
  const pick = (title: string, items: SelItem[], onPick: (v: any) => void, extra: Partial<Parameters<typeof Select>[0]> = {}) =>
    setDialog(() => () => <Select title={title} items={items} onPick={(v) => (close(), onPick(v))} onClose={close} {...extra} />)

  const openModels = async () => {
    const a = cur()
    if (!a) return
    for (let i = 0; i < 10 && !a.chat.models.length; i++) await new Promise((r) => setTimeout(r, 300))
    const ms = a.chat.models
    if (!ms.length) return flash("Still starting up — try again in a moment")
    pick("Select model", ms.map((m) => ({ title: m.displayName, desc: m.description?.slice(0, 40), value: m.value })), (v) => a.setModel(v))
  }
  const openModes = () => {
    const a = cur()
    if (a) pick("Select agent", MODES.map((m) => ({ title: MODE_LABEL[m], desc: m, value: m })), (v) => a.setMode(v))
  }
  const openThemes = () => {
    const orig = themeName()
    const apply = (n: string) => THEMES[n] && setThemeName(n)
    pick(
      "Themes",
      themeNames.map((n) => ({ title: n, value: n })),
      (n) => (apply(n), saveConfig({ ...loadConfig(), theme: n })),
      { onMove: apply, onClose: () => (apply(orig), close()) },
    )
  }
  const openSessions = async () => {
    const dir = cur() ? tabs.find((t) => t.id === active())!.cwd : props.cwd
    const ss: any[] = await listSessions({ dir, limit: 50 }).catch(() => [])
    if (!ss.length) return flash("No sessions in this folder")
    pick(
      "Sessions",
      ss.map((s) => ({ title: (s.customTitle || s.summary || s.firstPrompt || s.sessionId).slice(0, 56), footer: new Date(s.lastModified).toLocaleString(), value: s.sessionId })),
      (id) => newTab(dir, id),
      { width: 90 },
    )
  }
  const openMcp = async () => {
    const a = cur()
    if (!a) return
    const ms = (await a.chat.mcp()).filter((m) => !m.name.startsWith("claude.ai"))
    if (!ms.length) return flash("No MCP servers")
    pick("MCP servers", ms.map((m) => ({ title: m.name, footer: m.status, value: m })), (m) => void a.chat.toggleMcp(m.name, m.status === "disabled"))
  }
  const help = () => setDialog(() => () => <Message title="Help" body={"ctrl+p commands · / slash · @ files · tab mode\nctrl+x then: n new, l sessions, m model, a agent, t theme, b sidebar, w close, q quit, 1-9 tab\nctrl+t new tab · ctrl+w close · alt+up/down switch · ctrl+d quit"} onClose={close} />)

  const text = (title: string, body: string) => setDialog(() => () => <Message title={title} body={body} onClose={close} />)
  const curTab = () => tabs.find((t) => t.id === active())!
  const needSession = () => {
    const sid = cur()?.chat.sid
    if (!sid) flash("Send a message first")
    return sid
  }
  const run = (name: string, arg?: string) => {
    const a = cur()
    const dir = curTab().cwd
    ;({
      models: openModels,
      agents: openModes,
      themes: openThemes,
      sessions: openSessions,
      mcps: openMcp,
      new: () => newTab(dir),
      clear: () => {
        const old = active()
        newTab(dir)
        closeTab(old)
      },
      rename: () => {
        const sid = needSession()
        if (!sid) return
        if (!arg) return flash("Usage: /rename <title>")
        void renameSession(sid, arg, { dir }).then(() => setTabs((t) => t.id === active(), "title", arg))
      },
      fork: () => {
        const sid = needSession()
        if (sid) void forkSession(sid, { dir }).then((r) => newTab(dir, r.sessionId))
      },
      compact: () => a?.chat.send("/compact"),
      diff: async () => {
        const p = Bun.spawn(["git", "diff", "--stat"], { cwd: dir, stdout: "pipe", stderr: "pipe" })
        text("Git diff", (await new Response(p.stdout).text()).trim() || "No changes")
      },
      open: () => {
        const dirs = Object.keys(loadConfig().tabs ?? {})
        if (!dirs.length) return flash("No recent projects")
        pick("Projects", dirs.map((d) => ({ title: basename(d), desc: d, value: d })), (d) => newTab(d), { width: 90 })
      },
      cd: () => {
        const p = resolve(dir, arg ?? "")
        if (!arg || !existsSync(p)) return flash(arg ? "Folder not found" : "Usage: /cd <folder>")
        newTab(p)
      },
      variants: () => a && pick("Effort", ["low", "medium", "high", "xhigh", "max"].map((l) => ({ title: l, value: l })), (l) => (a.effort(l), flash("Effort: " + l))),
      skills: () => {
        const cs = a?.chat.commands ?? []
        if (!cs.length) return flash("No skills loaded yet")
        pick("Skills", cs.map((c) => ({ title: "/" + c.name, desc: c.description?.slice(0, 60), value: c.name })), (n) => a!.chat.send("/" + n), { width: 90 })
      },
      paste: () => a?.paste(),
      undo: () => flash("Undo isn't available with Claude yet"),
      redo: () => flash("Redo isn't available with Claude yet"),
      connect: () => text("Log in", "Run `claude` once and use /login, or set ANTHROPIC_API_KEY."),
      help,
      exit: quit,
      status: () => a && text("Status", a.info().join("\n")),
    } as Record<string, () => void>)[name]?.()
  }

  const palette = () => {
    const a = cur()
    const items: SelItem[] = []
    for (const cat of ["Session", "Agent", "Prompt", "System"]) {
      items.push({ title: cat, cat: true })
      for (const l of LOCAL.filter((x) => x.cat === cat && !x.args)) items.push({ title: l.desc, footer: l.key ?? "/" + l.name, value: l.name })
    }
    items.push({ title: "Skills & commands", cat: true })
    for (const c of a?.chat.commands ?? []) items.push({ title: "/" + c.name, desc: c.description?.slice(0, 48), value: "send:" + c.name })
    pick("Commands", items, (v: string) => (v.startsWith("send:") ? a?.chat.send("/" + v.slice(5)) : run(v)))
  }

  const leaderKeys: Record<string, () => void> = {
    n: () => newTab(),
    l: () => void openSessions(),
    m: openModels,
    a: openModes,
    x: () => run("clear"),
    f: () => run("fork"),
    t: openThemes,
    s: () => run("status"),
    b: () => setSidebar(!sidebar()),
    c: () => run("compact"),
    w: () => closeTab(),
    q: quit,
  }

  useKeyboard((e) => {
    if (dialog()) return
    if (leader()) {
      setLeader(false)
      clearTimeout(leaderT)
      if (/^[1-9]$/.test(e.name)) return void (tabs[+e.name - 1] && select(tabs[+e.name - 1].id))
      return leaderKeys[e.name]?.()
    }
    if (e.ctrl && e.name === "x") return (setLeader(true), clearTimeout(leaderT), void (leaderT = setTimeout(() => setLeader(false), 2500)))
    if (e.ctrl && e.name === "p") return palette()
    if (e.ctrl && e.name === "d") return quit()
    if (e.ctrl && e.name === "t") return e.shift ? void (closed.length && newTab(closed[closed.length - 1].cwd, closed.pop()!.resume)) : newTab()
    if (e.ctrl && e.name === "w") return closeTab()
    if (e.meta && (e.name === "down" || e.name === "up")) return cycle(e.name === "down" ? 1 : -1)
    if (e.name === "tab" && e.shift) {
      const a = cur()
      if (a) a.setMode(MODES[(MODES.indexOf(a.mode()) + 1) % MODES.length])
    }
  })

  return (
    <box flexDirection="column" width={dims().width} height={dims().height} backgroundColor={T().bg}>
      <box flexShrink={0} flexDirection="row" gap={1} paddingLeft={1} backgroundColor={T().panel}>
        <For each={tabs}>
          {(t, i) => (
            <box flexDirection="row" gap={1} backgroundColor={t.id === active() ? T().elem : undefined} paddingLeft={1} paddingRight={1} onMouseDown={(e: any) => (e.button === 1 ? closeTab(t.id) : select(t.id))}>
              <text fg={t.id === active() ? T().text : T().muted}>
                {i() + 1} {t.title}
                {t.unread ? " ●" : ""}
              </text>
              <text fg={T().muted} onMouseDown={(e: any) => (e.stopPropagation?.(), closeTab(t.id))}>x</text>
            </box>
          )}
        </For>
        <text fg={T().muted} onMouseDown={() => newTab()}> + </text>
      </box>
      <For each={tabs}>
        {(t) => (
          <Session
            id={t.id}
            cwd={t.cwd}
            resume={t.resume}
            model={props.model}
            mode={props.mode}
            active={t.id === active()}
            blocked={!!dialog()}
            sidebar={sidebar()}
            run={run}
            toast={flash}
            register={(a) => apis.set(t.id, a)}
            onSession={(sid) => (setTabs((x) => x.id === t.id, "resume", sid), persist())}
            onUnread={() => setTabs((x) => x.id === t.id, "unread", true)}
          />
        )}
      </For>
      <Show when={leader() || toast()}>
        <box position="absolute" right={2} top={1} backgroundColor={T().elem} paddingLeft={1} paddingRight={1}>
          <text fg={leader() ? T().primary : T().text}>{leader() ? "ctrl+x …" : toast()}</text>
        </box>
      </Show>
      {dialog()?.()}
    </box>
  )
}
