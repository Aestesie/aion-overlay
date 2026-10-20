/**
 * The buffs' icons, for the buffs overlay and the Details window's Buffs tab:
 * src/renderer/public/buffs/<icon>.webp, 48 px.
 *
 *   node scripts/fetch-buff-icons.mjs [--force]
 *
 * Which icon each buff has is A2Tools DPS Meter's table (src/data/abnormals.json, merged with the
 * names into src/shared/abnormals.json: id -> [name, icon file]). The images are the game's own,
 * from its asset CDN; they are bundled so the app makes no requests. A buff icon named after a
 * skill's with "_Buff" added is often not on the CDN: the skill's own is fetched under the buff's
 * name instead, as upstream falls back (public/src/js/skillIcons.js, getAbnormalIconCandidates).
 * Needs ImageMagick (`magick`). Images already present are kept unless --force.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const APP = join(dirname(fileURLToPath(import.meta.url)), '..')
const TABLE = join(APP, 'src', 'shared', 'abnormals.json')
const OUT = join(APP, 'src', 'renderer', 'public', 'buffs')
const CDN = 'https://assets.playnccdn.com/static-aion2-gamedata/resources'
const force = process.argv.includes('--force')

mkdirSync(OUT, { recursive: true })
const table = JSON.parse(readFileSync(TABLE, 'utf8')).abnormals
const icons = [...new Set(Object.values(table).map(([, icon]) => icon).filter((i) => i && /^[A-Za-z0-9_]+$/.test(i)))]
let got = 0
const missing = []
for (const icon of icons) {
  const out = join(OUT, `${icon}.webp`)
  if (!force && existsSync(out)) continue
  let res = await fetch(`${CDN}/${icon}.png`)
  const plain = icon.replace(/_(Buff|Debuff)$/i, '')
  if (!res.ok && plain !== icon) res = await fetch(`${CDN}/${plain}.png`)
  if (!res.ok) {
    missing.push(icon)
    continue
  }
  const tmp = join(OUT, `${icon}.png`)
  writeFileSync(tmp, Buffer.from(await res.arrayBuffer()))
  execFileSync('magick', [tmp, '-resize', '48x48', '-quality', '82', out])
  rmSync(tmp)
  got++
}
console.log(`buff icons: ${got} fetched, ${missing.length} missing, ${icons.length} in the table`)
if (missing.length) console.log(`missing: ${missing.join(' ')}`)
