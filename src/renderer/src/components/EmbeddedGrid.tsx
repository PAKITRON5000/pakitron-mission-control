// EV156 (the user, 14-11 ~12:10: «poder añadir el claude dentro de la app, para verlo, igual que lo veo en el cmd… ver
// todos los claude más fácilmente, pero tener la opción de despegarlos o volverlos a anclar»): in Chats, every Claude
// that lives inside the app, all at once, each one as its console shows it and typed into right there. «Despegar» puts
// one in a window of its own; «Anclar» (or closing that window) brings it back here. Closing the app leaves them running.
import { t } from '../../../core/i18n'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ExternalLink, GripVertical, Maximize2, Minimize2, MoveHorizontal, Pin, Plus, RotateCcw, Send, X } from 'lucide-react'
import { useStore } from '../lib/store'
import { api, type AccountId } from '../lib/api'
import { ago } from '../lib/format'
import { useDraft } from '../lib/draft'
import { ptyKey, ptyType } from '../lib/remoteBridge'
import { ACCOUNT_COLOR, Avatar, accName } from './ui'
import { AppTerminal } from './AppTerminal'
import { usePhone } from './PhoneShell'

export interface Embedded {
  id: string
  pid: number
  meta: { account: string; projectId?: string; cwd: string; title: string; resume?: string }
  startedAt: number
  alive: boolean
  exitCode?: number
  endedAt?: number
  lastDataAt: number
  popped: boolean
  sessionId?: string
  status?: string
  projectName?: string
  /** EV201: the project it works in now, when it is not the one it was opened in (main › embedList). */
  workProjectId?: string
}

/** The app on the PC, and (EV197) the phone, which draws them through its connection to the PC. */
export const hasTerminals = () => Boolean(window.pmc?.pty)
/** A finger, not a mouse: the phone, or a touch screen. */
const touchScreen = () => window.pmc?.platform === 'remote' || Boolean(window.matchMedia?.('(pointer: coarse)').matches)

const watched = () => !document.documentElement.classList.contains('pmc-still')

/** The Claudes inside the app, asked every 3 s while someone looks (`on`: only while the sheet that needs it is open). */
export function useEmbedded(on = true): [Embedded[] | undefined, () => void] {
  const { state } = useStore()
  const [list, setList] = useState<Embedded[]>()
  const read = () => { void api<Embedded[]>('embedList').then(setList, () => setList([])) }
  useEffect(() => {
    if (!on || !hasTerminals()) return
    read()
    const timer = setInterval(() => { if (watched()) read() }, 3000)
    return () => clearInterval(timer)
    // The main process says when one opens or ends (a new state): read again then too.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, on])
  return [list, read]
}

// EV184 (the user, 15-11 03:35: «cuando se haga grande, recuerde el tamaño y pueda seguir navegando por la app con los
// iconos de arriba… y al volver seguir siendo grande»): which one is big is kept (also when the app is closed and opened
// again: the Claudes inside it go on), and big it covers only the screen's content, never the bars above.
const BIG_KEY = 'pmc.embBig'
const readBig = (): string | null => { try { return localStorage.getItem(BIG_KEY) } catch { return null } }
const writeBig = (id?: string) => { try { if (id) localStorage.setItem(BIG_KEY, id); else localStorage.removeItem(BIG_KEY) } catch { /* only this time */ } }

/** Where the screen's content is (below the bars, left of an open dock), for a big terminal to cover just that. */
function contentBox(from: HTMLElement | null): { top: number; left: number; right: number; bottom: number } | undefined {
  const el = (from?.closest('main.content') ?? document.querySelector('main.content')) as HTMLElement | null
  if (!el) return undefined
  const r = el.getBoundingClientRect()
  // The dock, open on a wide window, sits over the content's right padding.
  const pad = parseFloat(getComputedStyle(el).paddingRight) || 0
  const gap = 12
  return { top: r.top + gap, left: r.left + gap, right: window.innerWidth - r.right + gap + (pad > 100 ? pad : 0), bottom: window.innerHeight - r.bottom + gap }
}

// EV192 (the user, 15-11 04:20: «podrían ser ajustables en cuanto a tamaño y poder cambiarlos de posición»): each one's
// height and width (one column or two) and the order of all, kept per account in this computer.
// EV200 (the user, 15-11 15:20: «no son suficientemente anchos para ver lo que queda de créditos de la semana se lee
// "seman..."… que predeterminado se viera y segundo poder ensancharlos así como se pueden estirar»): `w`, its own width,
// by its right edge (`wide`: the whole row).
interface Layout { h?: number; wide?: boolean; w?: number }
const LAYOUT_KEY = 'pmc.embLayout'
const ORDER_KEY = 'pmc.embOrder'
const readJson = <T,>(k: string, d: T): T => { try { return (JSON.parse(localStorage.getItem(k) ?? '') as T) ?? d } catch { return d } }
const writeJson = (k: string, v: unknown) => { try { localStorage.setItem(k, JSON.stringify(v)) } catch { /* only this time */ } }
const MIN_H = 220
const MAX_H = 1600
const MIN_W = 320
// EV200: as wide as Mission Control's status line under it needs (account · model · context · 5 h · week: 78-83
// columns), about 90 columns at the terminal's 13 px (7,2 px each, plus its scrollbar and padding).
const TILE_W = 680
const GAP = 12

function Tile({ s, focus, onChanged, onMove }: { s: Embedded; focus: boolean; onChanged: () => void; onMove: (dragged: string, before: string) => void }) {
  const { toast, state } = useStore()
  const [big, setBigState] = useState(() => readBig() === s.id)
  const setBig = (v: boolean) => { setBigState(v); if (v) writeBig(s.id); else if (readBig() === s.id) writeBig() }
  const [area, setArea] = useState<ReturnType<typeof contentBox>>()
  const [sure, setSure] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  // The conversation it is, kept after it ends (Claude Code stops listing it), for «Retomar aquí».
  const conv = useRef<string | undefined>(s.sessionId ?? s.meta.resume)
  if (s.sessionId) conv.current = s.sessionId
  useEffect(() => { if (focus) box.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }) }, [focus])
  useEffect(() => { if (!sure) return; const x = setTimeout(() => setSure(false), 3500); return () => clearTimeout(x) }, [sure])
  useEffect(() => {
    if (!big) return
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape' && e.shiftKey) setBig(false) }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [big])
  // EV184: big, it follows the content's place when the window, the bars or the dock change.
  useLayoutEffect(() => {
    if (!big) { setArea(undefined); return }
    const fit = () => setArea(contentBox(box.current))
    fit()
    const el = box.current?.closest('main.content') ?? document.querySelector('main.content')
    const ro = typeof ResizeObserver !== 'undefined' && el ? new ResizeObserver(fit) : undefined
    if (ro && el) ro.observe(el)
    window.addEventListener('resize', fit)
    return () => { ro?.disconnect(); window.removeEventListener('resize', fit) }
  }, [big])
  const account = s.meta.account as AccountId
  const proj = state?.projects.find((p) => p.id === (s.workProjectId ?? s.meta.projectId))
  const openedIn = s.workProjectId ? state?.projects.find((p) => p.id === s.meta.projectId)?.name : undefined
  const project = s.projectName ?? proj?.name
  // EV190 (the user, 15-11 04:08: «deberían ser más visuales para distinguir rápido entre cual es cual y cual trabaja en
  // cada proyecto… para no equivocarse como me acaba de pasar»): each one in its account's colour, with its number big, and
  // its project as a tag in the project's colour.
  const tint = ACCOUNT_COLOR[account]
  const [layout, setLayoutState] = useState<Layout>(() => readJson<Record<string, Layout>>(LAYOUT_KEY, {})[account] ?? {})
  const setLayout = (patch: Layout) => setLayoutState((cur) => { const next = { ...cur, ...patch }; writeJson(LAYOUT_KEY, { ...readJson<Record<string, Layout>>(LAYOUT_KEY, {}), [account]: next }); return next })
  const [over, setOver] = useState(false)
  // Height by dragging the bar at the bottom, width by the right edge (EV200), both by the corner; the terminal refits
  // itself as it changes (its ResizeObserver).
  const startResize = (e: React.PointerEvent, sides: { x?: boolean; y?: boolean } = { y: true }) => {
    e.preventDefault()
    e.stopPropagation()
    const el = box.current
    if (!el) return
    const x0 = e.clientX
    const y0 = e.clientY
    const h0 = el.offsetHeight
    const w0 = el.offsetWidth
    const maxW = el.parentElement?.clientWidth ?? 4000
    let h = h0
    let w = w0
    document.documentElement.classList.add('emb-sizing')
    const move = (ev: PointerEvent) => {
      if (sides.y) { h = Math.round(Math.min(MAX_H, Math.max(MIN_H, h0 + ev.clientY - y0))); el.style.height = `${h}px` }
      if (sides.x) { w = Math.round(Math.min(maxW, Math.max(MIN_W, w0 + ev.clientX - x0))); el.style.width = `${w}px`; el.classList.remove('is-wide') }
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      document.documentElement.classList.remove('emb-sizing')
      setLayout({ ...(sides.y ? { h } : {}), ...(sides.x ? { w, wide: false } : {}) })
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }
  const resetWidth = () => { setLayout({ w: undefined, wide: false }); if (box.current) box.current.style.width = '' }
  // What Claude Code says of it (`claude agents`); just opened, before it is listed, whether its screen is moving.
  const busy = s.alive && (s.status ? s.status === 'busy' : Date.now() - s.lastDataAt < 4000)
  const asks = s.alive && s.status === 'waiting'
  const status = !s.alive ? t('Terminó') : asks ? t('Te pregunta algo') : busy ? t('Trabajando') : t('Quieto, esperando')
  const color = !s.alive ? 'var(--gray)' : asks ? 'var(--orange)' : busy ? 'var(--green)' : 'var(--blue)'
  const call = (m: string, ...a: unknown[]) => api(m, ...a).then(onChanged, (e: Error) => toast(e.message))
  const close = () => {
    if (!s.alive) return void call('embedForget', s.id)
    if (!sure) { setSure(true); return }
    void call('embedKill', s.id).then(() => toast(t('Cerrado {v0}', { v0: accName(account) })))
  }
  const resume = () => {
    if (!conv.current) return
    void api('embedResume', account, s.meta.cwd, conv.current).then(() => { void api('embedForget', s.id); onChanged(); toast(t('Retomando aquí')) }, (e: Error) => toast(e.message))
  }
  return (
    <div ref={box} className={`emb-tile ${focus ? 'is-focus' : ''} ${big ? 'is-big' : ''} ${layout.wide && !big ? 'is-wide' : ''} ${over ? 'is-over' : ''}`}
      style={{ borderColor: tint, ['--acc' as any]: tint, ...(layout.h && !big ? { height: layout.h } : {}), ...(layout.w && !layout.wide && !big ? { width: layout.w } : {}), ...(big && area ? { top: area.top, left: area.left, right: area.right, bottom: area.bottom } : {}) }}
      onDragOver={(e) => { if (e.dataTransfer.types.includes('text/pmc-emb')) { e.preventDefault(); setOver(true) } }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => { setOver(false); const from = e.dataTransfer.getData('text/pmc-emb'); if (from && from !== account) onMove(from, account) }}>
      <div className="emb-head">
        {!big && <span className="emb-grip" draggable title={t('Arrástralo para cambiarlo de sitio')} onDragStart={(e) => { e.dataTransfer.setData('text/pmc-emb', account); e.dataTransfer.effectAllowed = 'move' }}><GripVertical size={14} /></span>}
        <span className="emb-num" style={{ background: tint }} aria-hidden>{account.slice(6)}</span>
        <div className="min-w-0 flex-1">
          <div className="emb-title flex items-center gap-2 min-w-0">
            <span className="truncate">{accName(account)}</span>
            {project && <span className="emb-proj" style={{ ['--proj' as any]: proj?.color ?? '#8e8e93' }} title={openedIn ? t('Trabaja en {name} (su ventana se abrió en {v0})', { name: project, v0: openedIn }) : t('Trabaja en {name}', { name: project })}><i />{project}</span>}
          </div>
          <div className="emb-sub"><span style={{ color, fontWeight: 600 }}>{status}</span> · {s.alive ? t('abierto {v0}', { v0: ago(s.startedAt) }) : ago(s.endedAt ?? s.lastDataAt)}</div>
        </div>
        {!s.popped && !big && <button className={`emb-icon ${layout.wide ? 'on' : ''}`} title={layout.wide ? t('A su ancho') : t('A todo el ancho')} onClick={() => { const wide = !layout.wide; setLayout({ wide, w: undefined }); if (box.current) box.current.style.width = '' }}><MoveHorizontal size={13} /></button>}
        {!s.popped && <button className="emb-icon" title={big ? t('Volver a su sitio (Mayús+Esc)') : t('Verlo en grande dentro de la app')} onClick={() => setBig(!big)}>{big ? <Minimize2 size={13} /> : <Maximize2 size={13} />}</button>}
        {s.popped
          ? <button title={t('Vuelve a dibujarlo aquí y cierra su ventana (sigue trabajando)')} onClick={() => void call('embedDock', s.id)}><Pin size={13} /> {t('Anclar')}</button>
          : <button title={t('Lo saca a una ventana propia; al cerrarla vuelve aquí. Sigue trabajando igual')} onClick={() => { setBig(false); void call('embedPopOut', s.id) }}><ExternalLink size={13} /> {t('Despegar')}</button>}
        {/* EV190 (the user, 15-11 04:12: «las x de cerrar claude, el cuadro rojo, que es Peligroso, hay que recalcarlo»): apart
            from the other buttons, always red, and the second click says whom it closes and what is lost. */}
        <span className="emb-sep" aria-hidden />
        <button className={`emb-icon ${s.alive ? 'emb-close' : ''} ${sure ? 'is-sure' : ''}`}
          title={s.alive ? t('Cerrar a {name}: para lo que esté haciendo y se pierde lo que no haya guardado', { name: accName(account) }) : t('Quitarlo de aquí')} aria-label={s.alive ? t('Cerrar a {name}', { name: accName(account) }) : t('Quitarlo de aquí')} onClick={close}>
          {sure ? t('¿Cerrar a {name}? Se pierde lo no guardado. Pulsa otra vez', { name: accName(account) }) : <X size={14} strokeWidth={2.6} />}
        </button>
      </div>
      <div className="emb-body">
        {s.popped
          ? <div className="emb-away">
              <div>{t('Está en su propia ventana.')}</div>
              <div className="flex gap-2">
                <button className="btn btn-sm" onClick={() => void call('embedPopOut', s.id)}>{t('Traer su ventana')}</button>
                <button className="btn btn-sm" onClick={() => void call('embedDock', s.id)}><Pin size={13} /> {t('Anclar aquí')}</button>
              </div>
            </div>
          : <AppTerminal id={s.id} autoFocus={focus} />}
        {!s.alive && (
          <div className="emb-ended">
            <span className="flex-1">{s.exitCode === -1
              // The app lost its terminal process (closed from the Task Manager, the PC short of memory): it ended with it.
              ? t('Se cerró junto con el proceso de las terminales de la app.')
              : t('Este Claude terminó{v0}.', { v0: s.exitCode ? t(' (código {v0})', { v0: s.exitCode }) : '' })}</span>
            {conv.current && <button className="btn btn-sm" onClick={resume}><RotateCcw size={13} /> {t('Retomar aquí')}</button>}
            <button className="btn btn-sm btn-ghost" onClick={() => void call('embedForget', s.id)}>{t('Quitar')}</button>
          </div>
        )}
      </div>
      {!big && !s.popped && (
        <>
          <div className="emb-resize" onPointerDown={(e) => startResize(e)} onDoubleClick={() => { setLayout({ h: undefined }); if (box.current) box.current.style.height = '' }} title={t('Arrastra para hacerlo más alto o más bajo (doble clic: como era)')}><span /></div>
          <div className="emb-resize-x" onPointerDown={(e) => startResize(e, { x: true })} onDoubleClick={resetWidth} title={t('Arrastra para hacerlo más ancho o más estrecho (doble clic: como era)')}><span /></div>
          <div className="emb-resize-xy" onPointerDown={(e) => startResize(e, { x: true, y: true })} onDoubleClick={() => { resetWidth(); setLayout({ h: undefined }); if (box.current) box.current.style.height = '' }} title={t('Arrastra para cambiar el ancho y el alto (doble clic: como era)')} />
        </>
      )}
    </div>
  )
}

/** «Dónde se abren los Claude que abra la app»: their own window, as until now, or here. */
export function SessionsWhere() {
  const { state, refresh, toast } = useStore()
  const where = state?.settings.sessionsWhere ?? 'app'
  const set = (v: 'ventana' | 'app') => void api('setSettings', { sessionsWhere: v }).then(refresh, (e: Error) => toast(e.message))
  return (
    <span className="emb-where" title={t('Dónde se abren los Claude que abre la app (relevos, la rueda, Poner a trabajar, Nuevo chat)')}>
      <button className={where === 'ventana' ? 'on' : ''} onClick={() => set('ventana')}>{t('En su ventana')}</button>
      <button className={where === 'app' ? 'on' : ''} onClick={() => set('app')}>{t('Dentro de la app')}</button>
    </span>
  )
}

export function EmbeddedGrid({ focusId, onNew }: { focusId?: string; onNew: () => void }) {
  const phone = usePhone() || window.pmc?.platform === 'remote'
  if (!hasTerminals()) return null
  return phone ? <PhoneTerminals focusId={focusId} onNew={onNew} /> : <DeskGrid focusId={focusId} onNew={onNew} />
}

function DeskGrid({ focusId, onNew }: { focusId?: string; onNew: () => void }) {
  const [list, read] = useEmbedded()
  const { state } = useStore()
  const here = (state?.settings.sessionsWhere ?? 'app') === 'app'
  // EV192: in the order the user left them (by account; new ones at the end, as they came).
  const [order, setOrder] = useState<string[]>(() => readJson<string[]>(ORDER_KEY, []))
  const rank = (s: Embedded) => { const i = order.indexOf(s.meta.account); return i < 0 ? 1e6 : i }
  const items = (list ?? []).map((s, i) => ({ s, i })).sort((a, b) => rank(a.s) - rank(b.s) || a.i - b.i).map((x) => x.s)
  const move = (dragged: string, before: string) => {
    const now = items.map((x) => x.meta.account).filter((a, i, all) => all.indexOf(a) === i).filter((a) => a !== dragged)
    const at = now.indexOf(before)
    now.splice(at < 0 ? now.length : at, 0, dragged)
    setOrder(now)
    writeJson(ORDER_KEY, now)
  }
  // EV200: as many side by side as fit at their usual width (TILE_W), sharing the row; one with its own width keeps it.
  const grid = useRef<HTMLDivElement>(null)
  const [col, setCol] = useState<number>()
  const shown = items.length > 0
  useLayoutEffect(() => {
    const el = grid.current
    if (!el) return
    const fit = () => {
      const w = el.clientWidth
      if (!w) return
      const n = Math.max(1, Math.floor((w + GAP) / (TILE_W + GAP)))
      setCol(Math.floor((w - GAP * (n - 1)) / n))
    }
    fit()
    const ro = new ResizeObserver(fit)
    ro.observe(el)
    return () => ro.disconnect()
  }, [shown])
  return (
    <section className="mb-4">
      <div className="flex items-center gap-2 flex-wrap mb-1">
        <div className="m-group flex-1" style={{ margin: 0 }}>{t('Dentro de la app')}{items.length ? ` · ${items.length}` : ''}</div>
        <span className="t-small c3">{t('Abrir los Claude:')}</span>
        <SessionsWhere />
        <button className="btn btn-sm" onClick={onNew}><Plus size={13} /> {t('Abrir uno aquí')}</button>
      </div>
      <div className="t-small c3 px-1 mb-2">
        {items.length
          ? t('Cada uno como en su ventana: pincha dentro para escribirle. «Despegar» lo saca a una ventana propia; al cerrarla vuelve aquí. Si cierras la app, siguen trabajando.')
          : here
            ? t('Aquí ves y escribes a los Claude como en su ventana, todos a la vez. Los que abra la app (relevos, la rueda, Poner a trabajar) aparecerán aquí; o abre uno con «Abrir uno aquí».')
            : t('Aquí ves y escribes a los Claude como en su ventana, todos a la vez. Abre uno con «Abrir uno aquí», o elige «Dentro de la app» para que se abran aquí los que abra la app.')}
      </div>
      {shown && <div ref={grid} className="emb-grid" style={col ? { ['--emb-col' as any]: `${col}px` } : undefined}>{items.map((s) => <Tile key={s.id} s={s} focus={s.id === focusId} onChanged={read} onMove={move} />)}</div>}
    </section>
  )
}

// ---- EV197: on the phone -------------------------------------------------------------------------------------------
// The user, 15-11 13:20: «en el móvil poder ver la pestaña de chats como la veo aquí en el pc, con los cmd como se ven
// aquí… sería clave». The same Claudes inside the app, each one as its console on the PC shows it, one at a time (a
// phone's screen holds one readable), picked by its number; under it the keys a Claude asks for (Esc, Enter, the arrows,
// 1-2-3, Shift+Tab) and a box to write to it. «Pantalla completa» gives it the whole screen, and the box rises with the
// keyboard.
const FONT_KEY = 'pmc.phoneTermFont'
const PHONE_KEYS: { key: string; label: string; title: () => string }[] = [
  { key: 'esc', label: 'Esc', title: () => t('Esc: para lo que está haciendo o cierra lo que pregunta') },
  { key: 'up', label: '↑', title: () => t('Arriba') },
  { key: 'down', label: '↓', title: () => t('Abajo') },
  { key: 'enter', label: '', title: () => t('Intro: acepta lo marcado') },
  { key: '1', label: '1', title: () => t('Opción 1') },
  { key: '2', label: '2', title: () => t('Opción 2') },
  { key: '3', label: '3', title: () => t('Opción 3') },
  { key: 'left', label: '←', title: () => t('Izquierda') },
  { key: 'right', label: '→', title: () => t('Derecha') },
  { key: 'tab', label: 'Tab', title: () => t('Tab') },
  { key: 'shift-tab', label: '⇧Tab', title: () => t('Mayús+Tab: cambia de modo (aceptar cambios, planear)') },
  { key: 'backspace', label: '⌫', title: () => t('Borrar') }
]

function PhoneTerminals({ focusId, onNew }: { focusId?: string; onNew: () => void }) {
  const [list, read] = useEmbedded()
  const { state, toast } = useStore()
  const items = list ?? []
  const [sel, setSel] = useState<string | undefined>(focusId)
  useEffect(() => { if (focusId) setSel(focusId) }, [focusId])
  const cur = items.find((s) => s.id === sel) ?? items.find((s) => s.alive) ?? items[0]
  const [font, setFontState] = useState(() => readJson<number>(FONT_KEY, 11))
  const setFont = (n: number) => { const v = Math.max(8, Math.min(16, n)); setFontState(v); writeJson(FONT_KEY, v) }
  const [full, setFull] = useState(false)
  const [text, setText] = useDraft(cur ? `pty:${cur.id}` : undefined)
  const [sending, setSending] = useState(false)
  const layer = useRef<HTMLDivElement>(null)
  const box = useRef<HTMLTextAreaElement>(null)
  const touch = touchScreen()

  // Full screen, it is exactly as tall as what can be seen: with the keyboard up, the box rises with it (as Conversation).
  useEffect(() => {
    const view = window.visualViewport
    if (!full || !view) return
    const fit = () => {
      if (!layer.current) return
      const typing = view.height < window.screen.height * 0.72
      layer.current.style.height = typing ? `${view.height}px` : ''
      layer.current.style.bottom = typing ? 'auto' : ''
      layer.current.style.transform = view.offsetTop > 0.5 ? `translateY(${view.offsetTop}px)` : ''
    }
    fit()
    view.addEventListener('resize', fit)
    view.addEventListener('scroll', fit)
    return () => { view.removeEventListener('resize', fit); view.removeEventListener('scroll', fit) }
  }, [full])
  useEffect(() => {
    if (!full) return
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape' && e.target !== box.current) setFull(false) }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [full])

  const remote = window.pmc?.platform === 'remote'
  const key = (k: string) => { if (!cur) return; void (remote ? ptyKey(cur.id, k) : api('ptyKey', cur.id, k)).catch((e: Error) => toast(e.message)) }
  const send = async () => {
    const said = text.trim()
    if (!cur || !said || sending) return
    setSending(true)
    try {
      await (remote ? ptyType(cur.id, said) : api('ptyType', cur.id, said))
      // EV199: scrolled up through what it wrote, it goes back to the end to see the answer come (AppTerminal).
      window.dispatchEvent(new CustomEvent('pmc-pty-sent', { detail: cur.id }))
      setText('')
      if (box.current) box.current.style.height = ''
    } catch (e) { toast((e as Error).message) }
    setSending(false)
  }
  const statusOf = (s: Embedded) => {
    const busy = s.alive && (s.status ? s.status === 'busy' : Date.now() - s.lastDataAt < 4000)
    const asks = s.alive && s.status === 'waiting'
    return { label: !s.alive ? t('Terminó') : asks ? t('Te pregunta algo') : busy ? t('Trabajando') : t('Quieto, esperando'), color: !s.alive ? 'var(--gray)' : asks ? 'var(--orange)' : busy ? 'var(--green)' : 'var(--blue)' }
  }

  const account = cur?.meta.account as AccountId | undefined
  const proj = cur ? state?.projects.find((p) => p.id === (cur.workProjectId ?? cur.meta.projectId)) : undefined
  const st = cur ? statusOf(cur) : undefined
  const resume = () => {
    const conv = cur?.sessionId ?? cur?.meta.resume
    if (!cur || !account || !conv) return
    void api<{ id: string }>('embedResume', account, cur.meta.cwd, conv).then((r) => { void api('embedForget', cur.id); setSel(r.id); read(); toast(t('Retomando aquí')) }, (e: Error) => toast(e.message))
  }

  const body = cur && account && st && (
    <div ref={layer} className={`pt-box ${full ? 'is-full' : ''}`} style={{ ['--acc' as any]: ACCOUNT_COLOR[account] }}>
      <div className="emb-head">
        <span className="emb-num" style={{ background: ACCOUNT_COLOR[account] }} aria-hidden>{account.slice(6)}</span>
        <div className="min-w-0 flex-1">
          <div className="emb-title flex items-center gap-2 min-w-0">
            <span className="truncate">{accName(account)}</span>
            {(cur.projectName ?? proj?.name) && <span className="emb-proj" style={{ ['--proj' as any]: proj?.color ?? '#8e8e93' }}><i />{cur.projectName ?? proj?.name}</span>}
          </div>
          <div className="emb-sub"><span style={{ color: st.color, fontWeight: 600 }}>{st.label}</span> · {cur.alive ? t('abierto {v0}', { v0: ago(cur.startedAt) }) : ago(cur.endedAt ?? cur.lastDataAt)}</div>
        </div>
        <button className="emb-icon" title={t('Letra más pequeña')} aria-label={t('Letra más pequeña')} onClick={() => setFont(font - 1)}>A−</button>
        <button className="emb-icon" title={t('Letra más grande')} aria-label={t('Letra más grande')} onClick={() => setFont(font + 1)}>A+</button>
        <button className="emb-icon" title={full ? t('Volver a Chats') : t('Pantalla completa')} aria-label={full ? t('Volver a Chats') : t('Pantalla completa')} onClick={() => setFull(!full)}>{full ? <Minimize2 size={14} /> : <Maximize2 size={14} />}</button>
      </div>
      <div className="emb-body pt-term">
        <AppTerminal key={cur.id} id={cur.id} fontSize={font} touch={touch} />
        {!cur.alive && (
          <div className="emb-ended">
            <span className="flex-1">{t('Este Claude terminó.')}</span>
            {(cur.sessionId ?? cur.meta.resume) && <button className="btn btn-sm" onClick={resume}><RotateCcw size={13} /> {t('Retomar aquí')}</button>}
            <button className="btn btn-sm btn-ghost" onClick={() => void api('embedForget', cur.id).then(read)}>{t('Quitar')}</button>
          </div>
        )}
      </div>
      {cur.alive && (
        <>
          <div className="pt-keys" role="toolbar" aria-label={t('Teclas')}>
            {PHONE_KEYS.map((k) => <button key={k.key} title={k.title()} aria-label={k.title()} onClick={() => key(k.key)}>{k.key === 'enter' ? t('Intro') : k.label}</button>)}
          </div>
          <div className="m-compose pt-compose">
            <textarea ref={box} rows={1} value={text} placeholder={t('Escribe a {v0}…', { v0: accName(account) })} enterKeyHint="send"
              onChange={(e) => { setText(e.target.value); e.target.style.height = 'auto'; e.target.style.height = `${Math.min(e.target.scrollHeight, 120)}px` }}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !touch) { e.preventDefault(); void send() } }} />
            <button className="m-send" disabled={!text.trim() || sending} onClick={() => void send()} aria-label={t('Enviar')}><Send size={18} /></button>
          </div>
        </>
      )}
    </div>
  )

  return (
    <section className="mb-4">
      <div className="flex items-center gap-2 mb-1">
        <div className="m-group flex-1" style={{ margin: 0 }}>{t('Dentro de la app')}{items.length ? ` · ${items.length}` : ''}</div>
        <button className="btn btn-sm" onClick={onNew}><Plus size={13} /> {t('Abrir uno')}</button>
      </div>
      <div className="t-small c3 px-1 mb-2">
        {items.length
          ? t('Cada Claude como en su ventana del PC: lo ves trabajar y le escribes abajo. Elige cuál con su número.')
          : t('Aquí verás a los Claude que trabajan dentro de la app del PC, como en su ventana. Abre uno con «Abrir uno».')}
      </div>
      {items.length > 0 && (
        <div className="pt-pick" role="tablist" aria-label={t('Qué Claude ver')}>
          {items.map((s) => {
            const a = s.meta.account as AccountId
            const x = statusOf(s)
            return (
              <button key={s.id} role="tab" aria-selected={s.id === cur?.id} className={s.id === cur?.id ? 'on' : ''} style={{ ['--acc' as any]: ACCOUNT_COLOR[a] }} onClick={() => setSel(s.id)} title={`${accName(a)} · ${x.label}`}>
                <span className="emb-num" style={{ background: ACCOUNT_COLOR[a], width: 24, height: 24, fontSize: 13, borderRadius: 7 }}>{a.slice(6)}</span>
                <span className="pt-pickName">{accName(a)}</span>
                <span className="pt-pickDot" style={{ background: x.color }} />
              </button>
            )
          })}
        </div>
      )}
      {full && body ? createPortal(body, document.body) : body}
    </section>
  )
}

/** The popped-out window (`#/terminal/<id>`): only that Claude, with «Anclar» to bring it back into the app. */
export function TerminalWindow({ id }: { id: string }) {
  const [s, setS] = useState<Embedded>()
  const [ended, setEnded] = useState(false)
  useEffect(() => {
    const read = () => void api<Embedded[]>('embedList').then((l) => { const x = l.find((e) => e.id === id); setS(x); if (x && !x.alive) setEnded(true) }, () => undefined)
    read()
    const timer = setInterval(read, 4000)
    return () => clearInterval(timer)
  }, [id])
  useEffect(() => { if (s) document.title = `${accName(s.meta.account)}${s.projectName ? ` · ${s.projectName}` : ''}` }, [s?.meta.account, s?.projectName])
  return (
    <div className="emb-window">
      <div className="emb-head">
        {s && <Avatar id={s.meta.account as AccountId} size={22} />}
        <div className="min-w-0 flex-1">
          <div className="emb-title">{s ? `${accName(s.meta.account)}${s.projectName ? ` · ${s.projectName}` : ''}` : '…'}</div>
          <div className="emb-sub">{ended ? t('Terminó') : t('Sigue trabajando aunque cierres esta ventana: vuelve a Chats')}</div>
        </div>
        <button title={t('Lo vuelve a poner en Chats, dentro de la app')} onClick={() => void api('embedDock', id)}><Pin size={13} /> {t('Anclar')}</button>
      </div>
      <div className="emb-body">
        <AppTerminal id={id} autoFocus fontSize={14} onExit={() => setEnded(true)} />
      </div>
    </div>
  )
}

/** For the «Nuevo chat» sheet: start it inside the app. */
export const startInApp = (account: AccountId, projectId: string, text: string) => api('embedNew', account, projectId, text)
