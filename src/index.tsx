import { render } from "@opentui/solid"
import { resolve } from "node:path"
import { App } from "./app"
import { themeNames, setThemeName, THEMES } from "./theme"

const a = process.argv.slice(2)
const val = (f: string) => {
  const i = a.indexOf(f)
  return i >= 0 ? a[i + 1] : undefined
}
if (a.includes("--version")) (console.log("ctui 0.2.0"), process.exit(0))
if (a.includes("--list-themes")) (console.log(themeNames.join("\n")), process.exit(0))
const theme = val("--theme")
if (theme && THEMES[theme]) setThemeName(theme)
const path = a.find((x, i) => !x.startsWith("-") && !["-m", "--mode", "--theme", "--resume"].includes(a[i - 1] ?? ""))

await render(
  () => <App cwd={resolve(process.env.CTUI_CWD ?? process.cwd(), path ?? ".")} model={val("-m")} mode={val("--mode") ?? "default"} resume={val("--resume")} />,
  { exitOnCtrlC: false, targetFps: 30 },
)
