// Lists the text wrapped in t(), plural() or tr(), or given to the components that translate their
// own (SettingRow, Section, PageHeader, option lists), that has no Spanish in src/shared/i18n.es.ts.
// Only literal strings are checked: run it after adding text. `npm run i18n:check`
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const root = new URL('../src/', import.meta.url).pathname
const es = readFileSync(join(root, 'shared/i18n.es.ts'), 'utf8')
const keys = new Set()
for (const m of es.matchAll(/^\s*(?:'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"):/gm)) keys.add((m[1] ?? m[2]).replace(/\\(.)/g, '$1'))

const files = []
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p)
    else if (/\.(vue|ts)$/.test(name) && !name.startsWith('i18n')) files.push(p)
  }
}
walk(root)

const missing = new Map()
const plurals = /\bplural\([^,]+,\s*(?:'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"),\s*(?:'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)")/g
for (const f of files) {
  const src = readFileSync(f, 'utf8')
  const found = []
  for (const m of src.matchAll(/\b(?:t|tr)\(\s*(?:'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)")/g)) found.push(m[1] ?? m[2])
  for (const m of src.matchAll(plurals)) found.push(m[1] ?? m[2], m[3] ?? m[4])
  // What's new: each changelog line is shown translated.
  if (f.endsWith('changelog.ts')) for (const m of src.matchAll(/^\s+'((?:[^'\\]|\\.)*)',$/gm)) found.push(m[1])
  // Text the shared components translate themselves: SettingRow's label, hint and warning,
  // Section's and PageHeader's title and about, and option lists' labels.
  if (f.endsWith('.vue')) {
    for (const m of src.matchAll(/\s(?:label|hint|warning|about)="([^"]+)"/g)) found.push(m[1])
    for (const m of src.matchAll(/<(?:Section|PageHeader)\b[^>]*?\stitle="([^"]+)"/g)) found.push(m[1])
    for (const m of src.matchAll(/\b(?:label|hint|about|name|where|title):\s*(?:'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)")/g)) found.push(m[1] ?? m[2])
  }
  for (const raw of found) {
    const text = raw.replace(/\\(.)/g, '$1')
    if (!keys.has(text)) missing.set(text, f.replace(root, ''))
  }
}
for (const [text, file] of missing) console.log(`${file}: ${text}`)
console.log(missing.size ? `${missing.size} without Spanish` : 'All text has Spanish.')
process.exit(missing.size ? 1 : 0)
