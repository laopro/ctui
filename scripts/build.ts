import solidPlugin from "@opentui/solid/bun-plugin"

const r = await Bun.build({
  entrypoints: ["./src/index.tsx"],
  plugins: [solidPlugin],
  compile: { outfile: "./dist/ctui", autoloadBunfig: false },
})
if (!r.success) {
  console.error(r.logs.join("\n"))
  process.exit(1)
}
console.log("built dist/ctui")
