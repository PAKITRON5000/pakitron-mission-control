// EV161: what is still missing in English. Lists every t('…') and tn(n, '…', '…') in src whose Spanish text has no
// entry in src/locales/en.ts, by file, and the entries nobody uses any more. Ends with code 1 while something is missing.
//   node scripts/idiomas.mjs [carpeta]        (by default, all of src; e.g. src/renderer/src/screens/Home.tsx)
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..')
const target = join(root, process.argv[2] ?? 'src')

// The dictionary, read as text: one 'key': 'value' per line.
const enDir = join(root, 'src', 'locales', 'en')
let dictText = readFileSync(join(root, 'src', 'locales', 'en.ts'), 'utf8')
try { for (const f of readdirSync(enDir)) if (f.endsWith('.ts')) dictText += '\n' + readFileSync(join(enDir, f), 'utf8') } catch { /* no folder yet */ }
const unq = (s) => s.replace(/\\(['\\])/g, '$1')
const keys = new Set()
for (const m of dictText.matchAll(/^\s*'((?:[^'\\]|\\.)*)'\s*:/gm)) keys.add(unq(m[1]))

const walk = (p) => statSync(p).isDirectory() ? readdirSync(p).flatMap((f) => walk(join(p, f))) : /\.(ts|tsx)$/.test(p) && !p.includes('locales') && !p.endsWith('i18n.ts') ? [p] : []
const used = new Map()
const lit = `'((?:[^'\\\\]|\\\\.)*)'`
const reT = new RegExp(`\\bt\\(\\s*${lit}`, 'g')
const reTn = new RegExp(`\\btn\\([^,]+,\\s*${lit}\\s*,\\s*${lit}`, 'g')
for (const f of walk(target)) {
  const text = readFileSync(f, 'utf8')
  const rel = relative(root, f).replace(/\\/g, '/')
  const add = (k) => { if (!used.has(k)) used.set(k, new Set()); used.get(k).add(rel) }
  for (const m of text.matchAll(reT)) add(unq(m[1]))
  for (const m of text.matchAll(reTn)) { add(unq(m[1])); add(unq(m[2])) }
}
const missing = [...used].filter(([k]) => !keys.has(k))
const byFile = new Map()
for (const [k, files] of missing) for (const f of files) byFile.set(f, [...(byFile.get(f) ?? []), k])
for (const [f, ks] of [...byFile].sort()) {
  console.log(`${f} (${ks.length})`)
  for (const k of ks) console.log(`  '${k.replace(/'/g, "\\'")}': '',`)
}
const unused = process.argv[2] ? [] : [...keys].filter((k) => !used.has(k))
if (unused.length) console.log(`\nEn en.ts sin usar (${unused.length}): ${unused.slice(0, 20).join(' · ')}${unused.length > 20 ? ' …' : ''}`)
console.log(`\n${used.size} textos con t(); ${missing.length} sin traducir al inglés.`)
if (missing.length) process.exitCode = 1
