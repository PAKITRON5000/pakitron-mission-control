import { motion } from 'motion/react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Palette, Plus, Smartphone } from 'lucide-react'
import { t } from '../../../core/i18n'
import { useStore, type Route } from '../lib/store'
import { api } from '../lib/api'
import { NAV, type NavGroup } from './Sidebar'
import { SPRING, ACCOUNT_COLOR, STATE_META, accLabel } from './ui'

/**
 * EV83 (Decidir #127, the user: «es clave tener pestañas arriba y poder moverte rápido entre proyectos estés donde estés»):
 * one tab per project, always in sight, with its colour and what waits in it. Changing tab keeps the screen you are on.
 */
export function ProjectTabs() {
  const { state, toast } = useStore()
  if (!state) return null
  return (
    <div className="no-drag flex items-end gap-1 min-w-0 overflow-x-auto self-end h-full" style={{ scrollbarWidth: 'none' }} role="tablist" aria-label={t('Proyectos')}>
      {state.projects.map((p) => {
        const on = p.id === state.activeProjectId
        const x = state.pending?.[p.id]
        return (
          <button key={p.id} role="tab" aria-selected={on} onClick={() => !on && void api('setActiveProject', p.id)} title={p.root}
            className="relative flex items-center gap-1.5 min-[1200px]:gap-2 px-2.5 min-[1200px]:px-3.5 border-0 min-w-0"
            // EV106: in a narrow window every tab stays in sight, the others shrinking first (their name with «…»).
            style={{ height: 40, borderRadius: '12px 12px 0 0', background: on ? 'var(--bg)' : 'transparent', color: on ? 'var(--label)' : 'var(--label-2)', fontWeight: on ? 700 : 560, flex: on ? '0 0.2 auto' : '0 1 auto', minWidth: on ? 110 : 96 }}>
            {on && <motion.span layoutId="tab-top" transition={SPRING} className="absolute left-2 right-2 top-0 rounded-b" style={{ height: 3, background: p.color }} />}
            <span className="dot flex-none" style={{ background: p.color, boxShadow: on ? `0 0 8px ${p.color}` : undefined }} />
            <span className="truncate min-w-0 max-w-[200px]">{p.name}</span>
            {x?.decisions ? <span className="pill num" style={{ background: 'var(--red)', color: 'white', height: 18, padding: '0 6px' }} title={t('Preguntas en Decidir')}>{x.decisions}</span> : null}
            {x?.review ? <span className="pill num" style={{ background: 'var(--orange)', color: 'white', height: 18, padding: '0 6px' }} title={t('Tareas para revisar')}>{x.review}</span> : null}
            {x?.comments ? <span className="pill num" style={{ background: 'var(--yellow)', color: '#3a2a00', height: 18, padding: '0 6px' }} title={t('Correcciones en Revisar')}>{x.comments}</span> : null}
          </button>
        )
      })}
      <button className="btn btn-sm btn-icon btn-ghost flex-none mb-1.5" title={t('Añadir proyecto')} onClick={() => void api<any>('addProject').then((r) => r && toast(t('Proyecto añadido: {name}', { name: r.name })))}><Plus size={14} /></button>
    </div>
  )
}

/** Ctrl+1…9 open the first nine sections of the menu (EV69). */
const shortcut = (route: Route) => { const i = NAV.filter((x) => x.group !== 'ajustes').findIndex((x) => x.route === route); return i >= 0 && i < 9 ? `Ctrl+${i + 1}` : '' }

const GROUP_LABEL: Record<NavGroup, string> = { tuyo: '', get claude() { return t('Los Claude') }, get proyecto() { return t('Proyecto') }, ajustes: '' }

/** The sections, in a row under the tabs, grouped like the old sidebar; the accounts in use at the right. */
export function SectionMenu() {
  const { state, route, param, go, setAgentOpen } = useStore()
  const strip = useRef<HTMLDivElement>(null)
  const bar = useRef<HTMLElement>(null)
  // When the sections do not fit in one row they go to two, all in sight (13-11, capture at 900 px: Cuentas to Memoria
  // were hidden past the edge of a row that only scrolled with the mouse wheel, and nothing said they were there). Each
  // section keeps its width either way, and the sum is taken the same way in both, so it never flips back and forth. In
  // two rows the accounts, Temas and Ajustes flow at the end of the second (at 900 px they took a third of the row and
  // the sections needed three).
  const [wrap, setWrap] = useState(false)
  useLayoutEffect(() => {
    const nav = bar.current
    if (!nav) return
    const check = () => {
      const items = [...nav.querySelectorAll('.topmenu-scroll .topmenu-item, .topmenu-scroll .topmenu-sep')] as HTMLElement[]
      const right = nav.lastElementChild as HTMLElement | null
      const need = items.reduce((w, g) => w + g.offsetWidth, 0) + 4 * items.length + (right?.offsetWidth ?? 0)
      setWrap(need > nav.clientWidth - 24 + 1)
      // Where the menu ends, for what floats under it (the assistant's panel).
      document.documentElement.style.setProperty('--menu-bottom', `${Math.round(nav.getBoundingClientRect().bottom)}px`)
    }
    check()
    const ro = new ResizeObserver(check)
    ro.observe(nav)
    return () => ro.disconnect()
  }, [Boolean(state)])
  // The section on screen is always in sight in the row, even when the window is narrow and the row scrolls.
  useEffect(() => { strip.current?.querySelector('.topmenu-item.on')?.scrollIntoView({ block: 'nearest', inline: 'nearest' }) }, [route, Boolean(state)])
  if (!state) return null
  const allDecisions = Object.values(state.pending ?? {}).reduce((n, x) => n + x.decisions, 0)
  const badge: Partial<Record<Route, number>> = { tareas: state.summary?.tasks.review || undefined, revisiones: state.commentsToReview || undefined, decisiones: allDecisions || undefined }
  const groups: NavGroup[] = ['tuyo', 'claude', 'proyecto']
  return (
    <nav ref={bar} className={`topmenu no-drag${wrap ? ' wrap' : ''}`} aria-label={t('Apartados')}>
      {/* EV106: only the sections scroll when the window is narrow; the accounts, Personalizar and Ajustes stay in sight. */}
      <div ref={strip} className="topmenu-scroll" onWheel={(e) => { const el = e.currentTarget; if (el.scrollWidth > el.clientWidth && Math.abs(e.deltaY) > Math.abs(e.deltaX)) el.scrollLeft += e.deltaY }}>
      {groups.map((g, gi) => (
        <div key={g} className="flex items-center gap-0.5 flex-none">
          {gi > 0 && <span className="topmenu-sep" aria-hidden />}
          {GROUP_LABEL[g] && <span className="topmenu-label">{GROUP_LABEL[g]}</span>}
          {NAV.filter((n) => n.group === g).map((n) => {
            const I = n.icon
            const on = route === n.route
            return (
              <button key={n.route} className={`topmenu-item ${on ? 'on' : ''}`} onClick={() => go(n.route)} aria-current={on ? 'page' : undefined} title={shortcut(n.route) ? `${n.label} · ${shortcut(n.route)}` : n.label}>
                {on && <motion.span layoutId="menu-on" transition={SPRING} className="absolute inset-0 rounded-[12px]" style={{ background: 'var(--fill-2)' }} />}
                <span className="icon-sq relative" style={{ background: n.color, color: n.color === 'var(--yellow)' ? '#3a2a00' : 'white', boxShadow: on ? `0 3px 10px color-mix(in srgb, ${n.color} 45%, transparent)` : undefined }}><I size={17} strokeWidth={2.3} /></span>
                <span className="relative topmenu-text">{n.label}</span>
                {badge[n.route] ? <span className="topmenu-badge pill num">{badge[n.route]}</span> : null}
              </button>
            )
          })}
        </div>
      ))}
      </div>
      <div className="flex items-center gap-1.5 flex-none pr-1 pl-2">
        {/* EV126: an account with no session on this PC (the empty slot of a new PC) is not a Claude yet. */}
        {state.agents.filter((a) => a.state !== 'baja' && a.state !== 'apartada' && (a.identity.hasLogin || a.sessions.length > 0)).map((a) => (
          <button key={a.id} className="relative border-0 bg-transparent p-0" onClick={() => setAgentOpen(a.id)} title={`${accLabel(a.id)} · ${STATE_META[a.state].label}`}>
            <span className="icon-sq num" style={{ background: ACCOUNT_COLOR[a.id], width: 32, height: 32, borderRadius: 10, fontSize: 14, fontWeight: 760 }}>{a.id.slice(6)}</span>
            <span className={`absolute -right-[2px] -bottom-[2px] w-[11px] h-[11px] rounded-full ${a.state === 'trabajando' ? 'live-dot' : ''}`} style={{ background: STATE_META[a.state].color, color: STATE_META[a.state].color, boxShadow: '0 0 0 2px var(--chrome)' }} />
          </button>
        ))}
        <span className="topmenu-sep" aria-hidden />
        {/* EV87: the themes one click away (the user, 13-11: «¿y dónde se cambia de tema?»): Ajustes opens on Apariencia. */}
        <button className="topmenu-item" onClick={() => { go('ajustes', 'general'); setTimeout(() => document.getElementById('apariencia')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60) }} title={t('Tamaño de letra y temas (Ctrl + / Ctrl − cambian el tamaño)')}><span className="icon-sq relative" style={{ background: 'var(--fill-2)', color: 'var(--label)' }}><Palette size={17} /></span><span className="relative topmenu-text">{t('Temas')}</span></button>
        {/* EV158 (the user, 14-11: «volver a darme las instrucciones en algún sitio que lo lea claro… que no recuerdo el link»): the phone's link, QR and steps one click away. */}
        <button className={`topmenu-item ${route === 'ajustes' && param === 'avisos' ? 'on' : ''}`} onClick={() => go('ajustes', 'avisos')} title={t('Abrir Mission Control en el móvil: su enlace, el código QR y los pasos')}><span className="icon-sq relative" style={{ background: 'var(--fill-2)', color: 'var(--label)' }}><Smartphone size={17} /></span><span className="relative topmenu-text">{t('Móvil')}</span></button>
        {NAV.filter((n) => n.group === 'ajustes').map((n) => {
          const I = n.icon
          return <button key={n.route} className={`topmenu-item ${route === n.route ? 'on' : ''}`} onClick={() => go(n.route)} title={n.label}><span className="icon-sq relative" style={{ background: 'var(--fill-2)', color: 'var(--label)' }}><I size={17} /></span><span className="relative topmenu-text">{n.label}</span></button>
        })}
      </div>
    </nav>
  )
}
