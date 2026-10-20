/**
 * Build the engine the installed app runs: `cargo build --release` in ../engine, copied to
 * ../build/engine (electron-builder ships that folder as resources/engine). Needs Rust (rustup).
 */
import { execFileSync } from 'node:child_process'
import { copyFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const exe = process.platform === 'win32' ? 'lokthar-engine.exe' : 'lokthar-engine'
execFileSync('cargo', ['build', '--release', '--locked'], { cwd: join(ROOT, 'engine'), stdio: 'inherit' })
const out = join(ROOT, 'build', 'engine')
mkdirSync(out, { recursive: true })
copyFileSync(join(ROOT, 'engine', 'target', 'release', exe), join(out, exe))
