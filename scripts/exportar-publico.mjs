// EV129: prepares the public copy of Mission Control and checks it holds nothing of the person who uses it. Publishes
// nothing: it only writes a folder and says what it found.
//
//   node scripts/exportar-publico.mjs [carpeta de salida]     (by default %TEMP%\mission-control-publico)
//
// 1. Copies what git tracks, without this installation's working documents (relay, tasks, state, decisions, the
//    original order, research notes, the project's own CLAUDE.md): those are the history of one person's work.
// 2. Searches the copy for that person's data, read from the app itself so it works for anyone: the Windows user name,
//    every account's e-mail and alias, every project's name and folders, the data folder, plus any word in
//    %LOCALAPPDATA%\PakitronMC\privado.txt (one per line).
// 3. Lists each hit as file:line and ends with code 1 while there is any. A new repository is made from this folder,
//    never from this one: git history keeps everything that was ever written here.
import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const out = process.argv[2] ?? join(tmpdir(), 'mission-control-publico')
const data = process.env.PMC_DATA_DIR ?? join(process.env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local'), 'PakitronMC')

/** This installation's working documents: never public. */
const PRIVATE = [/^docs\/(RELEVO|TASKS|ESTADO|STATE|DECISIONS|REPASO-PEDIDOS|MISION|PROYECTO)\.md$/i, /^docs\/archivo\//, /^docs\/research\//, /^ENCARGO\.md$/i, /^CLAUDE\.md$/i, /^docs\/permiso-permanente\.md$/i, /^scripts\/neutralizar-comentarios\.mjs$/, /^tests\/real\.smoke\.test\.ts$/]

// ---- what counts as the person's data ------------------------------------------------------------------------------
const words = new Set()
const add = (w) => { const s = String(w ?? '').trim(); if (s.length >= 4) words.add(s) }
// The Windows user name alone is not searched: it can be the author's public name, as here (Decidir #141: «no me
// importa que se sepa que es mía»); the user's folder is (homedir).
add(homedir())
add(homedir().replace(/\\/g, '/'))
add(data)
try {
  for (const a of JSON.parse(readFileSync(join(data, 'accounts.json'), 'utf8'))) {
    add(a.emailExpected); add(String(a.emailExpected ?? '').split('@')[0])
    // The alias itself, not what is said about it in brackets («(madre)» is a word anyone uses).
    add(String(a.alias ?? '').split('(')[0])
    if (a.configDir) add(a.configDir)
  }
} catch { /* no accounts yet */ }
try {
  const { DatabaseSync } = await import('node:sqlite')
  const db = new DatabaseSync(join(data, 'mission.db'), { readOnly: true })
  for (const p of db.prepare('SELECT id, name, config FROM projects').all()) {
    if (p.id !== 'mission-control') {
      add(p.name)
      // The same name written as code writes it (13-11: a project's name in a folder, «mi-juego», went unseen).
      const parts = String(p.name ?? '').toLowerCase().split(/\s+/).filter(Boolean)
      if (parts.length > 1) for (const sep of ['', '-', '_']) add(parts.join(sep))
    }
    // The app's own folder is not the person's data, wherever the export runs from (from a clean copy elsewhere, its
    // name came up 30 times on 14-11 at 17:33).
    if (p.id === 'mission-control') continue
    try {
      const c = JSON.parse(p.config)
      for (const r of [c.root, ...(c.copies ?? []).map((x) => x.path)]) if (r && !String(r).startsWith(root)) add(r)
      // A project's own folder name says whose it is («Game»); the folders inside it («Assets», «tools») do not.
      if (c.root && !String(c.root).startsWith(root)) add(String(c.root).split(/[\\/]+/).filter(Boolean).pop())
    } catch { /* no config */ }
  }
  db.close()
} catch { /* no database */ }
try { for (const l of readFileSync(join(data, 'privado.txt'), 'utf8').split(/\r?\n/)) add(l) } catch { /* none */ }
// What the user wants seen (publico-permitido.txt, one per line): his public name or handle, as in NOTICE (Decidir #143).
// Whole e-mails are still searched even when their first part is allowed.
try { for (const l of readFileSync(join(data, 'publico-permitido.txt'), 'utf8').split(/\r?\n/)) for (const w of [...words]) if (l.trim() && w.toLowerCase() === l.trim().toLowerCase()) words.delete(w) } catch { /* none */ }

// ---- the copy ------------------------------------------------------------------------------------------------------
const tracked = execFileSync('git', ['ls-files'], { cwd: root, encoding: 'utf8' }).split('\n').filter(Boolean)
const files = tracked.filter((f) => !PRIVATE.some((re) => re.test(f)))
if (existsSync(out)) rmSync(out, { recursive: true, force: true })
mkdirSync(out, { recursive: true })
for (const f of files) {
  const to = join(out, f)
  mkdirSync(dirname(to), { recursive: true })
  cpSync(join(root, f), to)
}

// ---- the search ----------------------------------------------------------------------------------------------------
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\\\\/g, '[\\\\/]+').replace(/\//g, '[\\\\/]+')
const re = new RegExp([...words].sort((a, b) => b.length - a.length).map(esc).join('|'), 'i')
const hits = []
for (const f of files) {
  const p = join(out, f)
  if (statSync(p).size > 4 << 20) continue
  const text = readFileSync(p, 'utf8')
  if (text.includes('\u0000')) continue
  text.split(/\r?\n/).forEach((line, i) => { const m = re.exec(line); if (m) hits.push({ file: f, line: i + 1, word: m[0], text: line.trim().slice(0, 140) }) })
}
const byFile = new Map()
for (const h of hits) byFile.set(h.file, [...(byFile.get(h.file) ?? []), h])
for (const [f, hs] of [...byFile].sort((a, b) => b[1].length - a[1].length)) {
  console.log(`${f} (${hs.length})`)
  for (const h of hs.slice(0, 6)) console.log(`  ${h.line}: «${h.word}» · ${h.text}`)
}
console.log(`\n${files.length} archivos copiados en ${out} (sin ${tracked.length - files.length} documentos de trabajo); se buscaron ${words.size} datos: ${hits.length} ${hits.length === 1 ? 'aparición' : 'apariciones'} en ${byFile.size} ${byFile.size === 1 ? 'archivo' : 'archivos'}.`)
if (hits.length) process.exitCode = 1
