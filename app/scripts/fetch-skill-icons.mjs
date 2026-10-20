/**
 * The skills' icons, for the meter's skill windows: src/renderer/public/skills/<icon>.webp, 48 px.
 *
 *   node scripts/fetch-skill-icons.mjs [--force]
 *
 * Which icon each skill has is A2Tools DPS Meter's table (src/data/skill_icons.json, copied to
 * src/shared/skillIcons.json: the first four digits of a skill's code -> the game's icon file).
 * The images are the game's own, from its asset CDN; they are bundled so the app makes no
 * requests. Needs ImageMagick (`magick`) to shrink them. Images already present are kept unless
 * --force; re-run when the table is updated.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const APP = join(dirname(fileURLToPath(import.meta.url)), '..')
const TABLE = join(APP, 'src', 'shared', 'skillIcons.json')
const OUT = join(APP, 'src', 'renderer', 'public', 'skills')
const CDN = 'https://assets.playnccdn.com/static-aion2-gamedata/resources'
const force = process.argv.includes('--force')

mkdirSync(OUT, { recursive: true })
const icons = [...new Set(Object.values(JSON.parse(readFileSync(TABLE, 'utf8'))))]
let got = 0
let missing = 0
for (const icon of icons) {
  const out = join(OUT, `${icon}.webp`)
  if (!force && existsSync(out)) continue
  const res = await fetch(`${CDN}/${icon}.png`)
  if (!res.ok) {
    missing++
    console.warn(`${icon}: HTTP ${res.status}`)
    continue
  }
  const tmp = join(OUT, `${icon}.png`)
  writeFileSync(tmp, Buffer.from(await res.arrayBuffer()))
  execFileSync('magick', [tmp, '-resize', '48x48', '-quality', '82', out])
  rmSync(tmp)
  got++
}
console.log(`skill icons: ${got} fetched, ${missing} missing, ${icons.length} in the table`)
