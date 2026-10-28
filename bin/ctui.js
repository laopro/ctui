#!/usr/bin/env node
const { spawnSync } = require("node:child_process")
const { join } = require("node:path")
const root = join(__dirname, "..")
const bun = join(root, "node_modules", ".bin", process.platform === "win32" ? "bun.cmd" : "bun")
process.exit(spawnSync(bun, [join(root, "src", "index.tsx"), ...process.argv.slice(2)], { stdio: "inherit", shell: process.platform === "win32" }).status ?? 0)
