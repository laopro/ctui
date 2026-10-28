// Thin wrapper over the Claude Agent SDK: one long-lived streaming-input query per tab.
import { query, type Query, type SDKMessage } from "@anthropic-ai/claude-agent-sdk"

export type PermissionChoice = "once" | "always" | "reject"

export type ChatEvents = {
  textStart(): void
  textDelta(delta: string): void
  toolUse(id: string, name: string, input: Record<string, any>): void
  thinking(text: string): void
  toolResult(id: string, text: string, isError: boolean): void
  result(r: { sessionId: string; costUsd: number; outTokens: number; text?: string }): void
  error(message: string): void
  askPermission(tool: string, input: Record<string, any>): Promise<PermissionChoice>
  ready(): void
}

export type ChatOptions = {
  cwd: string
  model?: string
  mode: string
  resume?: string
}

export class Chat {
  q?: Query
  commands: { name: string; description: string; argumentHint: string }[] = []
  models: { value: string; displayName: string; description: string }[] = []
  private inbox: any[] = []
  private wake?: () => void
  private closed = false
  private always = new Set<string>()
  streamed = false
  sid?: string

  constructor(
    readonly opts: ChatOptions,
    readonly ev: ChatEvents,
  ) {
    this.sid = opts.resume
  }

  start() {
    const self = this
    async function* input() {
      while (!self.closed) {
        if (self.inbox.length) yield self.inbox.shift()
        else await new Promise<void>((r) => (self.wake = r))
      }
    }
    this.q = query({
      prompt: input() as any,
      options: {
        cwd: this.opts.cwd,
        model: this.opts.model || undefined,
        permissionMode: this.opts.mode as any,
        allowDangerouslySkipPermissions: true,
        settingSources: ["user", "project", "local"],
        includePartialMessages: true,
        resume: this.opts.resume,
        canUseTool: async (tool: string, inp: Record<string, any>) => {
          const safe = ["Read", "Glob", "Grep", "WebSearch", "WebFetch", "TodoWrite", "ToolSearch", "Skill", "Task", "Agent"]
          if (safe.includes(tool) || this.always.has(tool)) return { behavior: "allow", updatedInput: inp }
          const choice = await this.ev.askPermission(tool, inp)
          if (choice === "always") this.always.add(tool)
          return choice === "reject"
            ? { behavior: "deny", message: "Denied by the user" }
            : { behavior: "allow", updatedInput: inp }
        },
      } as any,
    })
    void this.loop()
    void this.q.supportedCommands().then((c) => (this.commands = c as any)).catch(() => {})
    void this.q.supportedModels().then((m) => (this.models = m as any)).catch(() => {})
  }

  send(text: string, images: { mime: string; data: string }[] = []) {
    const content = images.length
      ? [...images.map((img) => ({ type: "image", source: { type: "base64", media_type: img.mime, data: img.data } })), { type: "text", text }]
      : text
    this.inbox.push({ type: "user", message: { role: "user", content }, parent_tool_use_id: null })
    this.wake?.()
  }

  async interrupt() {
    await this.q?.interrupt().catch(() => {})
  }

  async effort(level: string) {
    await this.q?.applyFlagSettings({ effortLevel: level as any }).catch(() => {})
  }

  async setMode(mode: string) {
    await this.q?.setPermissionMode(mode as any).catch(() => {})
  }

  async setModel(model: string) {
    await this.q?.setModel(model === "default" ? undefined : model).catch(() => {})
  }

  async context(): Promise<{ tokens: number; pct: number; model: string } | undefined> {
    try {
      const u: any = await this.q?.getContextUsage()
      return u ? { tokens: u.totalTokens, pct: u.percentage, model: u.model } : undefined
    } catch {
      return undefined
    }
  }

  async mcp(): Promise<{ name: string; status: string }[]> {
    try {
      return ((await this.q?.mcpServerStatus()) as any) ?? []
    } catch {
      return []
    }
  }

  async toggleMcp(name: string, enabled: boolean) {
    await this.q?.toggleMcpServer(name, enabled).catch(() => {})
  }

  close() {
    this.closed = true
    this.wake?.()
    try {
      this.q?.close()
    } catch {}
  }

  private async loop() {
    try {
      this.ev.ready()
      for await (const m of this.q!) this.handle(m)
    } catch (e: any) {
      if (this.closed) return
      const msg = String(e?.message ?? e)
      this.ev.error(
        /unauthorized|401|invalid.*api.key|not.*logged.?in|authentication/i.test(msg)
          ? "Not logged in. Run `claude` once and use /login, or set ANTHROPIC_API_KEY."
          : msg,
      )
    }
  }

  private handle(m: SDKMessage) {
    const msg: any = m
    if (msg.type === "stream_event") {
      const e = msg.event
      if (e?.type === "content_block_start" && e.content_block?.type === "text") {
        this.streamed = true
        this.ev.textStart()
      } else if (e?.type === "content_block_delta" && e.delta?.type === "text_delta") {
        this.ev.textDelta(e.delta.text ?? "")
      }
    } else if (msg.type === "assistant") {
      for (const b of msg.message?.content ?? []) {
        if (b.type === "tool_use") this.ev.toolUse(b.id, b.name, b.input ?? {})
        else if (b.type === "thinking" && b.thinking) this.ev.thinking(b.thinking)
        else if (b.type === "text" && !this.streamed) {
          this.ev.textStart()
          this.ev.textDelta(b.text)
        }
      }
      this.streamed = false
    } else if (msg.type === "user") {
      const c = msg.message?.content
      if (Array.isArray(c))
        for (const b of c)
          if (b.type === "tool_result") {
            const t = typeof b.content === "string" ? b.content : (b.content ?? []).map((x: any) => x.text ?? "").join(" ")
            this.ev.toolResult(b.tool_use_id, t, !!b.is_error)
          }
    } else if (msg.type === "result") {
      this.sid = msg.session_id
      this.ev.result({
        sessionId: msg.session_id,
        costUsd: msg.total_cost_usd ?? 0,
        outTokens: msg.usage?.output_tokens ?? 0,
        text: msg.result,
      })
    }
  }
}
