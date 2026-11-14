import { useEffect, useMemo, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { Search, CornerDownLeft } from 'lucide-react'
import { useStore, type Route } from '../lib/store'
import { api, thumbUrl, type Asset, type Task, type Decision } from '../lib/api'
import { SPRING, accName } from './ui'
import { NAV } from './Sidebar'

interface Item { id: string; group: string; label: string; sub?: string; thumb?: number; run: () => void }

export function Palette() {
  const { palette, setPalette, go, state, openComposer, setAgentOpen, jump } = useStore()
  const [decisions, setDecisions] = useState<Decision[]>([])
  const [q, setQ] = useState('')
  const [sel, setSel] = useState(0)
  const [tasks, setTasks] = useState<Task[]>([])
  const [assets, setAssets] = useState<Asset[]>([])
  const input = useRef<HTMLInputElement>(null)
  const pid = state?.activeProjectId

  useEffect(() => {
    if (!palette) return
    setQ('')
    setSel(0)
    setTimeout(() => input.current?.focus(), 30)
    if (pid) void api<Task[]>('tasks', pid).then(setTasks)
    if (pid) void api<Decision[]>('decisions', pid).then(setDecisions)
  }, [palette, pid])

  useEffect(() => {
    if (!palette || !pid || q.trim().length < 2) { setAssets([]); return }
    const t = setTimeout(() => void api<{ items: Asset[] }>('assets', { projectId: pid, text: q.trim(), limit: 6 }).then((r) => setAssets(r.items)), 160)
    return () => clearTimeout(t)
  }, [q, palette, pid])

  const items = useMemo<Item[]>(() => {
    const s = q.trim().toLowerCase()
    const close = (fn: () => void) => () => { setPalette(false); fn() }
    const out: Item[] = []
    const actions: Item[] = [
      { id: 'a-new', group: 'Acciones', label: 'Nueva instrucción', sub: 'Ctrl + N', run: close(() => openComposer()) },
      { id: 'a-idea', group: 'Acciones', label: 'Nueva idea', run: close(() => openComposer({ kind: 'idea' })) },
      { id: 'a-ref', group: 'Acciones', label: 'Actualizar todo ahora', run: close(() => void api('refresh')) },
      { id: 'a-asis', group: 'Acciones', label: 'Preguntar al asistente', sub: 'Ctrl + J', run: close(() => go('asistente')) }
    ]
    // EV69: each section with its shortcut (Ctrl+1…9, in the order of the menu).
    const keys = NAV.filter((x) => x.group !== 'ajustes')
    const screens: Item[] = NAV.map((n) => { const k = keys.indexOf(n); return { id: 's-' + n.route, group: 'Ir a', label: n.label, sub: k >= 0 && k < 9 ? `Ctrl + ${k + 1}` : undefined, run: close(() => go(n.route as Route)) } })
    const agents: Item[] = (state?.agents ?? []).map((a) => ({ id: 'ag-' + a.id, group: 'Claude', label: accName(a.id), sub: a.stateReason, run: close(() => setAgentOpen(a.id)) }))
    const projects: Item[] = (state?.projects ?? []).map((p) => ({ id: 'p-' + p.id, group: 'Proyectos', label: p.name, sub: p.root, run: close(() => void api('setActiveProject', p.id)) }))
    const match = (i: Item) => !s || `${i.label} ${i.sub ?? ''}`.toLowerCase().includes(s)
    out.push(...actions.filter(match), ...screens.filter(match), ...agents.filter(match), ...projects.filter(match))
    if (s) {
      // Each result leads to where it lives, scrolled to and glowing: nothing has to be searched for twice.
      const ds = decisions.filter((d) => `${d.taskExtId ?? ''} ${d.title} ${d.question}`.toLowerCase().includes(s)).slice(0, 5)
      out.unshift(...ds.map((d) => ({ id: 'd-' + d.id, group: 'Decisiones', label: d.title, sub: d.status === 'pendiente' ? 'Pendiente de decidir' : 'Decidida', run: close(() => jump('decisiones', { kind: 'decision', id: d.id })) })))
      const ts = tasks.filter((t) => `${t.extId ?? ''} ${t.title}`.toLowerCase().includes(s)).sort((a, b) => a.priority - b.priority).slice(0, 8)
      out.push(...ts.map((t) => ({ id: 't-' + t.id, group: 'Tareas', label: `${t.extId ? t.extId + ' · ' : ''}${t.title}`, sub: t.section, run: close(() => jump('tareas', { kind: 'task', id: t.id })) })))
      out.push(...assets.map((a) => ({ id: 'as-' + a.id, group: 'Galería', label: a.name, sub: a.rel, thumb: a.kind === 'image' ? a.id : undefined, run: close(() => jump('galeria', { kind: 'asset', id: a.id, q: a.name })) })))
      const raw = q.trim()
      out.push(
        { id: 'q-t', group: 'Buscar en', label: `Todas las tareas con «${raw}»`, run: close(() => jump('tareas', { kind: 'task', id: -1, q: raw })) },
        { id: 'q-g', group: 'Buscar en', label: `La galería con «${raw}»`, run: close(() => jump('galeria', { kind: 'asset', id: -1, q: raw })) }
      )
    }
    return out
  }, [q, tasks, assets, decisions, state, go, openComposer, setAgentOpen, setPalette, jump])

  useEffect(() => { setSel(0) }, [q])
  const groups = [...new Set(items.map((i) => i.group))]

  return (
    <AnimatePresence>
      {palette && (
        <>
          <motion.div className="scrim" style={{ background: 'rgb(0 0 0 / 0.18)' }} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setPalette(false)} />
          <motion.div
            className="palette"
            style={{ x: '-50%' }}
            initial={{ opacity: 0, y: -8, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -8, scale: 0.98 }} transition={SPRING}
            role="dialog" aria-label="Buscar"
            onKeyDown={(e) => {
              if (e.key === 'Escape') setPalette(false)
              if (e.key === 'ArrowDown') { e.preventDefault(); setSel((x) => Math.min(items.length - 1, x + 1)) }
              if (e.key === 'ArrowUp') { e.preventDefault(); setSel((x) => Math.max(0, x - 1)) }
              if (e.key === 'Enter') items[sel]?.run()
            }}
          >
            <div className="flex items-center gap-3 px-4 h-14 border-b" style={{ borderColor: 'var(--sep)' }}>
              <Search size={17} className="c3" />
              <input ref={input} className="flex-1 bg-transparent border-0 outline-none t-head" style={{ fontWeight: 480 }} placeholder="Buscar tareas, imágenes, Claude, pantallas…" value={q} onChange={(e) => setQ(e.target.value)} />
              <span className="kbd">Esc</span>
            </div>
            <div className="overflow-y-auto p-2">
              {groups.map((g) => (
                <div key={g} className="mb-1">
                  <div className="t-micro c3 px-3 pt-2 pb-1">{g}</div>
                  {items.filter((i) => i.group === g).map((i) => {
                    const idx = items.indexOf(i)
                    return (
                      <button
                        key={i.id}
                        className="w-full text-left flex items-center gap-3 px-3 py-2 rounded-lg border-0"
                        style={{ background: idx === sel ? 'var(--accent)' : 'transparent', color: idx === sel ? 'white' : undefined }}
                        onMouseMove={() => setSel(idx)}
                        onClick={i.run}
                      >
                        {i.thumb && <img src={thumbUrl(i.thumb, 120)} className="w-10 h-7 rounded object-cover" alt="" />}
                        <span className="t-body truncate">{i.label}</span>
                        {i.sub && <span className="t-small truncate ml-auto max-w-[45%]" style={{ opacity: 0.6 }}>{i.sub}</span>}
                        {idx === sel && <CornerDownLeft size={13} className="flex-none" />}
                      </button>
                    )
                  })}
                </div>
              ))}
              {items.length === 0 && <div className="t-small c3 px-4 py-6 text-center">Nada coincide con «{q}».</div>}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}
