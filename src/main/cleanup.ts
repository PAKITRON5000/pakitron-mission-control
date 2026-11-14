import { t } from '../core/i18n'
// A clean project (EV100), the measuring: in the background and in small steps (the main process must never stall; a
// game project's copies hold tens of GB), each copy of a project is walked once: the caches and builds that come back by
// themselves, and the heavy files, each put in its pile by core/cleanup.ts. Nothing is moved or deleted here.
import { readdir, lstat, rename, cp, rm } from 'node:fs/promises'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { shell } from 'electron'
import { execFile } from 'node:child_process'
import { dirname, join, relative, sep } from 'node:path'
import type { Service } from './service'
import { classify, asideFate, type Entry, type Pile } from '../core/cleanup'
import { addEvent } from '../core/db'
import { readMarks } from '../core/cleanmarks'
import { paths } from '../core/paths'
import { isSessionWorking } from '../core/working'

export interface CleanItem { path: string; rel: string; copy: string; kind: 'dir' | 'file'; size: number; mtime: number; pile: Pile; why: string }
export interface CleanView { at: number; running: boolean; items: CleanItem[]; totals: Record<Pile, number>; scanned: number }

const SKIP = new Set(['.git', '.svn', '.vs', '.idea'])
const REGEN = /^(Library|Temp|obj|Logs|MemoryCaptures|__pycache__|\.pytest_cache|\.vite|\.cache|\.parcel-cache|\.next|node_modules|Builds?|dist|out|win-unpacked|release)$/i
const HEAVY = 50 * 1024 * 1024
const yieldNow = () => new Promise<void>((r) => setImmediate(r))

/** Total size of a folder, walking it in steps (yields every 400 entries). */
async function dirSize(path: string): Promise<{ size: number; mtime: number }> {
  let size = 0
  let mtime = 0
  const stack = [path]
  let n = 0
  while (stack.length) {
    const d = stack.pop()!
    let list: import('node:fs').Dirent[] = []
    try { list = await readdir(d, { withFileTypes: true }) } catch { continue }
    for (const x of list) {
      const p = join(d, x.name)
      if (x.isDirectory()) { stack.push(p); continue }
      try { const s = await lstat(p); size += s.size; if (s.mtimeMs > mtime) mtime = s.mtimeMs } catch { /* gone */ }
      if (++n % 400 === 0) await yieldNow()
    }
  }
  return { size, mtime }
}

function gitTracked(cwd: string): Promise<Set<string>> {
  return new Promise((resolve) => execFile('git', ['ls-files', '-z'], { cwd, windowsHide: true, timeout: 30_000, maxBuffer: 64 << 20 }, (err, out) => {
    resolve(err ? new Set() : new Set(String(out).split('\0').filter(Boolean).map((x) => x.toLowerCase())))
  }))
}

export function createCleanup(d: { service: Service }) {
  const { service } = d
  const views = new Map<string, CleanView>()

  function named(projectId: string): Set<string> {
    // File names that open tasks mention: still wanted.
    const out = new Set<string>()
    for (const t of service.tasks.get(projectId) ?? []) {
      if (t.status === 'terminada') continue
      for (const m of `${t.title} ${t.detail}`.matchAll(/[\w.-]+\.[a-z0-9]{2,5}\b/gi)) out.add(m[0].toLowerCase())
    }
    return out
  }

  async function scan(projectId: string): Promise<CleanView> {
    const p = service.project(projectId)
    if (!p) throw new Error(t('Proyecto desconocido'))
    const cur = views.get(projectId)
    if (cur?.running) return cur
    const view: CleanView = { at: Date.now(), running: true, items: [], totals: { sobra: 0, dudoso: 0, queda: 0 }, scanned: 0 }
    views.set(projectId, view)
    const now = Date.now()
    const noted = new Set((service.db.prepare("SELECT DISTINCT a.path FROM assets a JOIN comments c ON c.asset_id = a.id WHERE a.project_id = ? AND c.status != 'aprobado'").all(projectId) as { path: string }[]).map((r) => r.path.split(sep).join('/')))
    const names = named(projectId)
    const marks = readMarks()
    const working = service.agents.flatMap((a) => a.sessions.filter((s) => isSessionWorking(s)).map((s) => s.cwd.toLowerCase()))
    const copies = [{ path: p.root, label: t('Copia principal'), main: true }, ...p.copies.filter((c) => c.path.toLowerCase() !== p.root.toLowerCase()).map((c) => ({ ...c, main: false }))]
    try {
      for (const c of copies) {
        // In use: someone works there now, or a Claude wrote a file in it these 7 days (the game project's «rachas» is its working
        // copy even when nobody is on it right now; its Unity Library must never go).
        let recent = false
        try { recent = Boolean(service.db.prepare("SELECT 1 FROM events WHERE kind = 'archivo' AND at > ? AND lower(detail) LIKE ? LIMIT 1").get(now - 7 * 86400_000, c.path.toLowerCase() + '%')) } catch { /* no events */ }
        const active = recent || working.some((w) => w.startsWith(c.path.toLowerCase()))
        const tracked = await gitTracked(c.path)
        const stack: string[] = [c.path]
        while (stack.length) {
          const dir = stack.pop()!
          let list: import('node:fs').Dirent[] = []
          try { list = await readdir(dir, { withFileTypes: true }) } catch { continue }
          for (const x of list) {
            const full = join(dir, x.name)
            const rel = relative(c.path, full).split(sep).join('/')
            if (x.isDirectory()) {
              if (SKIP.has(x.name)) continue
              // A nested copy (a worktree inside .claude) is measured as its own copy.
              if (copies.some((o) => o.path.toLowerCase() === full.toLowerCase())) continue
              if (REGEN.test(x.name)) {
                const s = await dirSize(full)
                const e: Entry = { rel, path: full, kind: 'dir', size: s.size, mtime: s.mtime, copy: { main: c.main, active } }
                const k = classify(e, { now, noted, named: names, marks })
                if (s.size > 20 * 1024 * 1024) view.items.push({ path: full, rel, copy: c.label, kind: 'dir', size: s.size, mtime: s.mtime, ...k })
                view.totals[k.pile] += s.size
                continue
              }
              stack.push(full)
              continue
            }
            view.scanned++
            if (view.scanned % 400 === 0) await yieldNow()
            let st
            try { st = await lstat(full) } catch { continue }
            // Small files count as kept, unless a Claude marked them disposable.
            if (st.size < HEAVY && !marks.has(full.split(sep).join('/').toLowerCase())) { view.totals.queda += st.size; continue }
            const e: Entry = { rel, path: full, kind: 'file', size: st.size, mtime: st.mtimeMs, copy: { main: c.main, active } }
            const k = classify(e, { now, noted, named: names, marks, tracked: (r) => tracked.has(r.toLowerCase()) })
            view.items.push({ path: full, rel, copy: c.label, kind: 'file', size: st.size, mtime: st.mtimeMs, ...k })
            view.totals[k.pile] += st.size
          }
        }
      }
    } finally {
      view.running = false
      view.at = Date.now()
      view.items.sort((a, b) => (a.pile === b.pile ? b.size - a.size : a.pile === 'sobra' ? -1 : b.pile === 'sobra' ? 1 : a.pile === 'dudoso' ? -1 : 1))
      service.push()
    }
    return view
  }

  // ---- acting, always recoverable: the bin for what comes back by itself, a folder of Mission Control for the doubtful --

  const asideDir = (pid: string) => join(paths.root(), 'apartado', pid)
  const indexFile = (pid: string) => join(asideDir(pid), 'index.json')
  type Aside = { from: string; to: string; at: number; size: number; why: string; name: string }
  const readIndex = (pid: string): Aside[] => { try { return JSON.parse(readFileSync(indexFile(pid), 'utf8')) } catch { return [] } }
  const writeIndex = (pid: string, list: Aside[]) => { mkdirSync(asideDir(pid), { recursive: true }); writeFileSync(indexFile(pid), JSON.stringify(list, null, 1)) }
  /** Only what the last measure put in that pile, and inside the project: nothing else is ever touched from here. */
  function itemOf(pid: string, path: string, pile: Pile): CleanItem {
    const it = views.get(pid)?.items.find((x) => x.path === path && x.pile === pile)
    if (!it) throw new Error(t('Mídelo otra vez: no está en ese montón'))
    return it
  }

  /** «Sobra seguro» → Windows' recycle bin (recoverable from there). */
  async function trash(pid: string, path: string): Promise<string> {
    const it = itemOf(pid, path, 'sobra')
    await shell.trashItem(it.path)
    const v = views.get(pid)!
    v.items = v.items.filter((x) => x !== it)
    v.totals.sobra = Math.max(0, v.totals.sobra - it.size)
    addEvent(service.db, { projectId: pid, at: Date.now(), kind: 'limpieza', title: t('A la papelera: {rel} ({v0} MB) · {why}', { rel: it.rel, v0: Math.round(it.size / 1048576), why: it.why }), detail: it.path, source: 'Mission Control' })
    service.push()
    return it.rel
  }

  /** «Dudoso» → set aside (moved, never deleted) with its card, to come back with one click. */
  async function aside(pid: string, path: string): Promise<string> {
    const it = itemOf(pid, path, 'dudoso')
    const to = join(asideDir(pid), it.copy.replace(/[^\w -]+/g, '_'), ...it.rel.split('/'))
    mkdirSync(dirname(to), { recursive: true })
    try { await rename(it.path, to) } catch { await cp(it.path, to, { recursive: true }); await rm(it.path, { recursive: true, force: true }) }
    writeIndex(pid, [...readIndex(pid), { from: it.path, to, at: Date.now(), size: it.size, why: it.why, name: it.rel.split('/').pop() ?? it.rel }])
    const v = views.get(pid)!
    v.items = v.items.filter((x) => x !== it)
    v.totals.dudoso = Math.max(0, v.totals.dudoso - it.size)
    addEvent(service.db, { projectId: pid, at: Date.now(), kind: 'limpieza', title: t('Apartado: {rel} ({v0} MB) · {why}', { rel: it.rel, v0: Math.round(it.size / 1048576), why: it.why }), detail: `${it.path} → ${to}`, source: 'Mission Control' })
    service.push()
    return it.rel
  }

  async function restore(pid: string, from: string): Promise<string> {
    const list = readIndex(pid)
    const a = list.find((x) => x.from === from)
    if (!a) throw new Error(t('Ya no está apartado'))
    mkdirSync(dirname(a.from), { recursive: true })
    try { await rename(a.to, a.from) } catch { await cp(a.to, a.from, { recursive: true }); await rm(a.to, { recursive: true, force: true }) }
    writeIndex(pid, list.filter((x) => x !== a))
    addEvent(service.db, { projectId: pid, at: Date.now(), kind: 'limpieza', title: t('Devuelto a su sitio: {name}', { name: a.name }), detail: a.from, source: 'Mission Control' })
    service.push()
    return a.name
  }

  /**
   * What is set aside, looked at again (every 6 h): back to its place if a task names it again; to the bin after weeks
   * with nothing asking for it, only when the user turned smart deletion on for the project.
   */
  async function watchAside(): Promise<void> {
    const now = Date.now()
    for (const p of service.projects) {
      const names = named(p.id)
      const open = (service.tasks.get(p.id) ?? []).some((t) => t.status !== 'terminada' && t.status !== 'idea')
      for (const a of readIndex(p.id)) {
        const fate = asideFate({ at: a.at, name: a.name }, { now, named: names, tasksOpen: open })
        if (fate === 'volver') { try { await restore(p.id, a.from) } catch { /* next round */ } }
        else if (fate === 'borrar' && service.settings.smartClean?.[p.id]) {
          try {
            await shell.trashItem(a.to)
            writeIndex(p.id, readIndex(p.id).filter((x) => x.from !== a.from))
            addEvent(service.db, { projectId: p.id, at: now, kind: 'limpieza', title: t('A la papelera tras estar apartado sin que nadie lo pidiera: {name}', { name: a.name }), detail: a.from, source: 'Mission Control' })
          } catch { /* next round */ }
        }
      }
    }
  }

  return {
    scan,
    /** What is known: the last measure (and whether one is going on now), and what is set aside. */
    view: (projectId: string) => { const v = views.get(projectId); return v ? { ...v, aside: readIndex(projectId) } : { at: 0, running: false, items: [], totals: { sobra: 0, dudoso: 0, queda: 0 }, scanned: 0, aside: readIndex(projectId), never: true } },
    start: (projectId: string) => { void scan(projectId).catch((e) => service.log(`limpieza: ${(e as Error).message}`)); return true },
    trash, aside, restore, watchAside
  }
}

export type Cleanup = ReturnType<typeof createCleanup>
