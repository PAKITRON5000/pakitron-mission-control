// EV188 (the user, 15-11 03:55: «hacer una guía inicial saltable si quiere y que puedan repetir desde ajustes, navegando
// por la app explicando qué es cada cosa de manera visual, para que el usuario lo entienda todo y no se abrume»): a few
// steps over the real screens. Each one lights up the part it explains (found by its words on screen, so it works in
// every shape of the app and on the phone) and says in two sentences what it is. «Saltar» at every step. It shows by
// itself the first time on a new install; Ajustes › General › «Ver la guía» brings it back.
import { useEffect, useLayoutEffect, useState } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { X } from 'lucide-react'
import { t } from '../../../core/i18n'
import { useStore } from '../lib/store'
import { api } from '../lib/api'
import { NAV } from './Sidebar'
import { usePhone } from './PhoneShell'

/** Ask for the guide from anywhere (Ajustes, Primeros pasos). */
export const startTour = () => window.dispatchEvent(new Event('pmc-tour'))

const visible = (el: Element) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < window.innerHeight }
const label = (route: string) => (route === 'mas' ? t('Más') : NAV.find((n) => n.route === route)?.label ?? route)
/** The menu's button for a section, in any shape of the app: its words without the badge's number. */
function navButton(route: string): HTMLElement[] {
  const want = label(route)
  const all = [...document.querySelectorAll<HTMLElement>('nav button, aside button, .m-tabs button, [role="navigation"] button')]
  const hit = all.filter((el) => visible(el) && (el.textContent ?? '').replace(/\d+/g, '').trim() === want)
  return hit.slice(0, 1)
}
const all = (sel: string) => [...document.querySelectorAll<HTMLElement>(sel)].filter(visible)

interface Step {
  title: string
  text: string
  /** On the phone, when what it points at is elsewhere there. */
  phoneText?: string
  find?: (phone: boolean) => HTMLElement[]
  /** What it lights up may be further down the screen: brought into sight first. */
  scroll?: boolean
}

function steps(): Step[] {
  return [
    { title: t('Bienvenido a Mission Control'), text: t('Coordina tus cuentas de Claude para que trabajen solas en tus proyectos, sin pisarse y gastando lo justo. En un minuto te enseño cada parte; puedes saltarlo y repetirlo cuando quieras desde Ajustes.') },
    { title: t('Tus proyectos'), text: t('Una pestaña por proyecto; el número es lo que te espera allí. Todo lo de debajo es del proyecto que elijas.'), find: (phone) => all(phone ? '.m-projects' : `[role="tablist"][aria-label="${t('Proyectos')}"]`) },
    { title: t('Inicio'), text: t('El resumen: lo que te preguntan, lo que solo tú puedes pulsar, y el mapa con quién trabaja y dónde.'), scroll: true, find: () => { const m = [...document.querySelectorAll<HTMLElement>('[data-tour="mapa"]')]; return m.length ? m : navButton('inicio') } },
    { title: t('Decidir'), text: t('Cuando un Claude necesita que elijas algo, te lo pregunta aquí, con fotos y opciones. Si no contestas, a su hora toma la opción por defecto y sigue.'), find: () => navButton('decisiones') },
    { title: t('Revisar'), text: t('Lo que han hecho y se ve o se oye: lo miras, señalas encima de la imagen lo que no te gusta, o lo das por bueno.'), find: () => navButton('revisiones') },
    { title: t('Tareas'), text: t('La lista de trabajo del proyecto: lo que falta, lo que está a medias y lo que espera tu visto bueno.'), find: () => navButton('tareas') },
    { title: t('Chats'), text: t('Las conversaciones de tus Claude, como en un móvil: ves qué hacen y les escribes. En el PC también los ves trabajar dentro de la app.'), find: () => navButton('chats') },
    {
      title: t('Escribir a los Claude'), text: t('Aquí les escribes a todos o a uno. Si está quieto, se lo escribe en su ventana; si trabaja, lo lee al acabar su paso; si no hay nadie, abre uno para eso.'),
      phoneText: t('En Chats, arriba, les escribes a todos o a uno. Si está quieto, se lo escribe en su ventana; si trabaja, lo lee al acabar su paso; si no hay nadie, abre uno para eso.'),
      find: (phone) => (phone ? navButton('chats') : all('.dock, .dock-pill'))
    },
    {
      title: t('Relevos'), text: t('Quién sigue cuando un Claude se queda sin uso: la rueda pasa el turno sola y el siguiente sigue donde lo dejó el anterior.'),
      phoneText: t('En «Más», Relevos: quién sigue cuando un Claude se queda sin uso. La rueda pasa el turno sola y el siguiente sigue donde lo dejó el anterior.'),
      find: (phone) => (phone ? navButton('mas') : navButton('relevos'))
    },
    {
      title: t('Tus Claude'), text: t('Cada cuenta con su número y su color; el punto dice si trabaja, te espera o está sin uso. Púlsala para ver su ficha y lo que le queda.'),
      find: (phone) => (phone ? all('[data-tour="mapa"]') : [...document.querySelectorAll<HTMLElement>('.topmenu button')].filter((b) => visible(b) && b.querySelector('.icon-sq.num')))
    },
    {
      title: t('Ajustes'), text: t('Las cuentas, la apariencia, el móvil, qué hacer tras un reinicio… y esta guía, para repetirla.'),
      phoneText: t('En «Más», Ajustes: las cuentas, la apariencia, qué hacer tras un reinicio… y esta guía, para repetirla.'),
      find: (phone) => (phone ? navButton('mas') : navButton('ajustes'))
    },
    { title: t('Listo'), text: t('Lo que gasta tu uso es el trabajo de los Claude, y la app está para que gastes menos. Si algo no se entiende, pregúntaselo al Asistente.') }
  ]
}

interface Box { top: number; left: number; width: number; height: number }

export function Tour() {
  const { state, go, route } = useStore()
  const phone = usePhone() || window.pmc?.platform === 'remote'
  const [i, setI] = useState<number>()
  const [box, setBox] = useState<Box>()
  const list = steps()
  // The first time on a new install (a PC with one project at most, Primeros pasos not hidden); never twice.
  useEffect(() => {
    if (!state || i !== undefined) return
    if (!state.settings.tourDone && !state.settings.firstRunDone && state.projects.length <= 1) { go('inicio'); setI(0) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [Boolean(state)])
  useEffect(() => {
    const f = () => { go('inicio'); setI(0) }
    window.addEventListener('pmc-tour', f)
    return () => window.removeEventListener('pmc-tour', f)
  }, [go])
  const step = i === undefined ? undefined : list[i]
  // Where the part it explains is, now and when the window changes.
  useLayoutEffect(() => {
    if (!step) return
    const fit = () => {
      const els = step.find?.(phone) ?? []
      if (!els.length) { setBox(undefined); return }
      if (step.scroll && !visible(els[0])) els[0].scrollIntoView({ block: 'start' })
      // Only what can be seen of it: a part of the screen taller than the window (the map) is lit from under the bars.
      const bars = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--menu-bottom')) || 0
      const rs = els.map((e) => { const r = e.getBoundingClientRect(); const floor = e.closest('main') ? bars : 0; return { top: Math.max(r.top, floor), left: r.left, bottom: Math.min(r.bottom, window.innerHeight), right: r.right } })
      const top = Math.min(...rs.map((r) => r.top)); const left = Math.min(...rs.map((r) => r.left))
      const bottom = Math.max(...rs.map((r) => r.bottom)); const right = Math.max(...rs.map((r) => r.right))
      // Kept inside the window on every side (the dock's pill sits at the very edge).
      const pad = 6
      const L = Math.max(4, left - pad); const T = Math.max(4, top - pad)
      const R = Math.min(window.innerWidth - 4, right + pad); const B = Math.min(window.innerHeight - 4, bottom + pad)
      setBox({ top: T, left: L, width: Math.max(0, R - L), height: Math.max(0, B - T) })
    }
    // The screen may still be drawing (going to Inicio): look again a moment later.
    fit()
    const again = setTimeout(fit, 350)
    window.addEventListener('resize', fit)
    return () => { clearTimeout(again); window.removeEventListener('resize', fit) }
  }, [i, phone])
  useEffect(() => {
    if (i === undefined) return
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') end(); if (e.key === 'ArrowRight') next(); if (e.key === 'ArrowLeft' && i > 0) setI(i - 1) }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  })
  // Not in the always-on-top window of the dock: only the main window explains the app.
  if (!step || i === undefined || route === 'flotante') return null
  const end = () => { setI(undefined); setBox(undefined); document.querySelector('main.content')?.scrollTo({ top: 0 }); if (!state?.settings.tourDone) void api('setSettings', { tourDone: true }).catch(() => undefined) }
  const next = () => (i + 1 < list.length ? setI(i + 1) : end())
  const W = Math.min(380, window.innerWidth - 32)
  // The card under what it lights up if it fits, above if not, inside it at the bottom when it is as tall as the window,
  // and in the middle when it lights up nothing.
  const CARD_H = 230
  const where = !box ? 'centro' : box.top + box.height + 16 + CARD_H < window.innerHeight ? 'debajo' : box.top - 16 - CARD_H > 0 ? 'encima' : 'dentro'
  const x = box ? Math.min(Math.max(16, box.left + box.width / 2 - W / 2), window.innerWidth - W - 16) : 0
  const cardStyle: React.CSSProperties = !box ? { width: W, left: '50%', top: '50%', transform: 'translate(-50%, -50%)' }
    : where === 'debajo' ? { width: W, left: x, top: box.top + box.height + 14 }
    : where === 'encima' ? { width: W, left: x, bottom: window.innerHeight - box.top + 14 }
    : { width: W, left: x, bottom: Math.max(16, window.innerHeight - (box.top + box.height) + 16) }
  return (
    <div className="tour" role="dialog" aria-modal="true" aria-label={t('Guía de Mission Control')}>
      {/* Clicks on the app below do nothing while the guide is open: it only explains. */}
      <div className="tour-catch" onClick={(e) => e.stopPropagation()} style={box ? undefined : { background: 'rgb(0 0 0 / 0.55)' }} />
      {box && <motion.div className="tour-light" initial={false} animate={{ top: box.top, left: box.left, width: box.width, height: box.height }} transition={{ type: 'spring', stiffness: 380, damping: 34 }} />}
      <AnimatePresence mode="wait">
        <motion.div key={i} className="tour-card" style={cardStyle} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.18 }}>
          <div className="flex items-start gap-2">
            <div className="min-w-0 flex-1">
              <div className="t-micro c3">{t('{n} de {total}', { n: i + 1, total: list.length })}</div>
              <div className="t-head mt-0.5" style={{ fontWeight: 700 }}>{step.title}</div>
            </div>
            <button className="btn btn-sm btn-icon btn-ghost flex-none" onClick={end} aria-label={t('Cerrar la guía')}><X size={15} /></button>
          </div>
          <div className="t-body c2 mt-1.5 leading-relaxed">{phone && step.phoneText ? step.phoneText : step.text}</div>
          <div className="tour-dots" aria-hidden>{list.map((_, k) => <span key={k} className={k === i ? 'on' : ''} />)}</div>
          <div className="flex items-center gap-2 mt-3">
            {i + 1 < list.length && <button className="btn btn-sm btn-ghost" onClick={end}>{t('Saltar la guía')}</button>}
            <span className="flex-1" />
            {i > 0 && <button className="btn btn-sm" onClick={() => setI(i - 1)}>{t('Anterior')}</button>}
            <button className="btn btn-sm btn-primary" onClick={next}>{i + 1 < list.length ? t('Siguiente') : t('Empezar')}</button>
          </div>
        </motion.div>
      </AnimatePresence>
    </div>
  )
}
