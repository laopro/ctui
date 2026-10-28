import { expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import { App } from "../src/app"
import { THEMES, themeNames } from "../src/theme"

process.env.CTUI_CONFIG = (process.env.TEMP ?? "/tmp") + "/ctui-bun-test.json"

const mount = async () => {
  try { require("node:fs").rmSync(process.env.CTUI_CONFIG!) } catch {}
  const t = await testRender(() => <App cwd={process.cwd()} mode="default" />, { width: 120, height: 30 })
  await t.renderOnce()
  const frame = async () => (await Bun.sleep(150), await t.renderOnce(), t.captureCharFrame())
  return { t, frame }
}

test("themes have every palette key", () => {
  expect(themeNames.length).toBeGreaterThanOrEqual(32)
  for (const n of themeNames) expect(THEMES[n].primary).toMatch(/^#[0-9a-f]{6}$/i)
})

test("home renders prompt and tab bar", async () => {
  const { frame } = await mount()
  const f = await frame()
  expect(f).toContain("Ask anything")
  expect(f).toContain("1 claude-tui-ts")
})

test("slash menu filters commands", async () => {
  const { t, frame } = await mount()
  await t.mockInput.typeText("/mod")
  expect(await frame()).toContain("/models")
})

test("ctrl+p opens palette, esc closes it, ctrl+t adds a tab", async () => {
  const { t, frame } = await mount()
  await t.mockInput.pressKey("p", { ctrl: true })
  expect(await frame()).toContain("Switch model")
  await t.mockInput.pressEscape()
  expect(await frame()).not.toContain("Switch model")
  await t.mockInput.pressKey("t", { ctrl: true })
  expect(await frame()).toContain("2 claude-tui-ts")
})

test("slash aliases and dialogs", async () => {
  const { t, frame } = await mount()
  await t.mockInput.typeText("/status")
  await t.mockInput.pressEnter()
  expect(await frame()).toContain("session: (new)")
  await t.mockInput.pressEscape()
  await Bun.sleep(150)
  await t.mockInput.typeText("/effort")
  await t.mockInput.pressEnter()
  expect(await frame()).toContain("xhigh")
  await t.mockInput.pressEscape()
  await Bun.sleep(150)
  await t.mockInput.typeText("/sessi")
  expect(await frame()).toContain("/sessions")
})

test("palette is grouped like opencode", async () => {
  const { t, frame } = await mount()
  await t.mockInput.pressKey("p", { ctrl: true })
  const f = await frame()
  for (const s of ["Session", "Agent", "Switch model"]) expect(f).toContain(s)
})
