import { testRender } from "@opentui/solid"
import { App } from "../src/app"
process.env.CTUI_CONFIG = process.env.TEMP + "\\ctui-test4.json"
const t = await testRender(() => <App cwd={process.cwd()} mode="default" />, { width: 120, height: 36 })
await t.renderOnce()
await t.mockInput.typeText(process.argv[2] ?? "lee package.json con Read y dime el nombre")
await t.mockInput.pressEnter()
let sawPerm = false
for (let i = 0; i < 120; i++) {
  await Bun.sleep(500)
  await t.renderOnce()
  const f = t.captureCharFrame()
  if (f.includes("Permission required")) {
    sawPerm = true
    console.log(f)
    await t.mockInput.pressKey("o")
  }
  if (/\d+\.\ds/.test(f)) break
}
console.log("sawPerm", sawPerm)
console.log(t.captureCharFrame())
process.exit(0)
