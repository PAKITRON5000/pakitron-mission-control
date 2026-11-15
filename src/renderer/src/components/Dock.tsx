import { useEffect, useMemo, useState } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { Check, CheckCheck, ChevronDown, ChevronUp, CircleAlert, CircleCheck, Clock, Gavel, ListChecks, PictureInPicture2, Play, Power, Send, X, Hand, Minus } from 'lucide-react'
import { useStore, useAsync } from '../lib/store'
import { api, type AgentCard, type AccountActivity, type AccountId } from '../lib/api'
import { Avatar, STATE_META, SPRING, accountNum, ACCOUNT_COLOR, workingOn, accName } from './ui'
import { ago } from '../lib/format'
import { t, tn, locale, namesList } from '../../../core/i18n'
import { useDraft } from '../lib/draft'

interface Claim { taskKey: string; account: AccountId; abandoned: boolean }

const FRESH_MS = 20 * 60_000

function isActive(a: AgentCard, act: AccountActivity | undefined, now: number): boolean {
  if (a.state === 'sin-uso') return false
  return a.state === 'trabajando' || a.state === 'esperando' || Boolean(act?.now && now - act.now.at < FRESH_MS && act.now.event !== 'SessionEnd')
}

/** An account that is not at work: one chip, with a start button when it has usage left. */
function RestChip({ a, floating }: { a: AgentCard; floating?: boolean }) {
  const { state, now, toast, setAgentOpen } = useStore()
  const m = STATE_META[a.state]
  const project = state?.projects.find((p) => p.id === state.activeProjectId)
  const back = a.state === 'sin-uso' && a.usage.activeLimit ? whenShort(a.usage.activeLimit.resetsAt, now) : undefined
  const canStart = a.state !== 'sin-uso' && a.sessions.length === 0 && project
  return (
    <span className="inline-flex items-center rounded-full" style={{ background: 'var(--fill)' }}>
      <button className="inline-flex items-center gap-1.5 h-7 pl-1 pr-2.5 rounded-full border-0 bg-transparent t-small" onClick={() => (floating ? void api('focusMain') : setAgentOpen(a.id))} title={`${accName(a.id)} · ${a.stateReason}`}>
        <Avatar id={a.id} size={20} />
        <span style={{ fontWeight: 600 }}>{accountNum(a.id)}</span>
        <span style={{ color: m.color }}>{back ? t('vuelve {when}', { when: back }) : m.label.toLowerCase()}</span>
      </button>
      {canStart && (
        <button className="btn btn-sm btn-icon btn-ghost" style={{ width: 24, height: 24, marginRight: 2, borderRadius: 99, color: 'var(--green)' }} title={t('Poner a trabajar a {name} (abre su terminal y le dice «sigue»)', { name: accName(a.id) })}
          onClick={() => api('putToWork', project!.id, a.id).then(() => toast(t('{name} se pone a trabajar', { name: accName(a.id) })), (e) => toast((e as Error).message))}><Play size={11} /></button>
      )}
    </span>
  )
}

type NoteTone = 'espera' | 'enviada' | 'leida' | 'apuntada' | 'hecha' | 'fallo'
interface SentNote { id: number; body: string; target?: string; status: string; createdAt: number; state: { tone: NoteTone; text: string } }
type NoteRoute = { kind: 'ventana'; account: string } | { kind: 'paso'; account: string } | { kind: 'abrir'; account: string } | { kind: 'solo'; account: string } | { kind: 'espera'; why: string } | { kind: 'todos'; accounts: string[] }

const TONE: Record<NoteTone, { color: string; Icon: typeof Clock }> = {
  espera: { color: 'var(--orange)', Icon: Clock },
  enviada: { color: 'var(--label-3)', Icon: Check },
  leida: { color: 'var(--blue)', Icon: CheckCheck },
  apuntada: { color: 'var(--purple)', Icon: ListChecks },
  hecha: { color: 'var(--green)', Icon: CircleCheck },
  fallo: { color: 'var(--red)', Icon: CircleAlert }
}

/** EV154: what you sent, as sent messages, each with where it is now (en espera, escrita, leída, apuntada, hecha). */
function SentNotes({ notes, onCancel }: { notes: SentNote[]; onCancel: (id: number) => void }) {
  const [all, setAll] = useState(false)
  const { now } = useStore()
  if (!notes.length) return null
  const shown = all ? notes : notes.slice(0, 2)
  return (
    <div className="sent-notes" aria-label={t('Lo que has enviado')}>
      <div className="flex items-center gap-2 px-3 pt-2">
        <span className="t-micro c3">{t('Enviado')}</span>
        {notes.length > 2 && <button className="btn-link t-micro ml-auto" onClick={() => setAll(!all)}>{all ? t('Menos') : t('Ver {n}', { n: notes.length })}</button>}
      </div>
      <AnimatePresence initial={false}>
        {shown.map((n) => {
          const tone = TONE[n.state.tone] ?? TONE.espera
          const canCancel = n.status === 'guardada' || n.status === 'pendiente-entrega'
          return (
            <motion.div key={n.id} layout initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={SPRING} className="sent-note">
              <div className="sent-bubble selectable" title={n.body}>
                {n.target && <span className="t-micro block" style={{ color: ACCOUNT_COLOR[n.target as AccountId] }}>{t('Para {name}', { name: accName(n.target) })}</span>}
                <span className="sent-text">{n.body}</span>
              </div>
              <div className="sent-state" style={{ color: tone.color }}>
                <tone.Icon size={12} className="flex-none" />
                <span className="truncate" title={n.state.text}>{n.state.text}</span>
                <span className="c3 flex-none">· {ago(n.createdAt, now)}</span>
                {canCancel && <button className="btn btn-sm btn-icon btn-ghost flex-none" style={{ width: 20, height: 20 }} title={t('Anular: que ningún Claude la reciba')} onClick={() => onCancel(n.id)}><X size={11} /></button>}
              </div>
            </motion.div>
          )
        })}
      </AnimatePresence>
    </div>
  )
}

function routeToast(r: NoteRoute | undefined, target: string): string {
  if (!r) return target ? t('Enviado a {name}', { name: accName(target) }) : t('Enviado')
  if (r.kind === 'ventana') return t('Escrito en la ventana de {name}: ya lo tiene', { name: accName(r.account) })
  if (r.kind === 'paso') return t('{name} lo leerá al acabar su paso', { name: accName(r.account) })
  if (r.kind === 'abrir') return t('Se abre {name} con tu nota', { name: accName(r.account) })
  // EV182: set aside, written to by name: it does this and stops again.
  if (r.kind === 'solo') return t('Se abre {name} solo para tu nota; al acabar se cerrará y seguirá parada', { name: accName(r.account) })
  // EV178: for everyone, it reaches every Claude at work, wherever it is.
  if (r.kind === 'todos') return t('Para todos: lo leerán {names} al acabar su paso, estén en el proyecto que estén', { names: namesList(r.accounts.map((a) => accName(a))) })
  return t('En espera: {why}', { why: r.why })
}

/**
 * The box to write to the Claudes («Para todos» or one), with what was sent and where it is now. In the dock and, on the
 * phone, at the top of Chats (EV183, the user, 15-11 03:10: «poder hablar desde el móvil… así como esta ventana que puedes
 * elegir mandar mensaje a todos»). What is written and not sent stays (EV185).
 */
export function NoteBox({ phone }: { phone?: boolean }) {
  const { state, now, toast } = useStore()
  const pid = state?.activeProjectId
  const agents = useMemo(() => (state?.agents ?? []).filter((a) => a.identity.hasLogin || a.sessions.length > 0), [state?.agents])
  const [note, setNote] = useDraft(pid ? `nota:${pid}` : undefined)
  const [target, setTarget] = useState<string>('')
  const [sending, setSending] = useState(false)
  // EV154: the hooks of the Claudes change a note's state in the database, not through the app: asked again every 10 s.
  const notesQ = useAsync(() => (pid ? api<SentNote[]>('myNotes', pid) : Promise.resolve([])), [pid, Math.floor(now / 10_000), state?.refreshedAt?.agents])
  const sendNote = async () => {
    const text = note.trim()
    if (!text || !pid || sending) return
    setSending(true)
    try {
      const r = await api<{ route?: NoteRoute }>('quickNote', pid, text, target || undefined)
      setNote('')
      notesQ.reload()
      toast(routeToast(r?.route, target))
    } catch (e) { toast((e as Error).message) } finally { setSending(false) }
  }
  const cancelNote = (id: number) => api('cancelNote', id).then(() => { notesQ.reload(); toast(t('Anulada: ningún Claude la recibirá')) }, (e) => toast((e as Error).message))
  // On the phone, bigger to touch, and 16 px so iOS does not zoom in on typing.
  const h = phone ? 40 : 32
  const font = phone ? 16 : undefined
  return (
    <div style={phone ? undefined : { borderTop: '0.5px solid var(--sep)' }}>
      <SentNotes notes={notesQ.data ?? []} onCancel={(id) => void cancelNote(id)} />
      <div className="p-2.5 flex items-center gap-1.5">
        <select className="field" style={{ width: 'auto', minWidth: 92, maxWidth: 130, height: h, padding: '0 6px', fontSize: font ?? 12 }} value={target} onChange={(e) => setTarget(e.target.value)} aria-label={t('Para quién')}>
          <option value="">{t('Para todos')}</option>
          {agents.map((a) => <option key={a.id} value={a.id}>{accName(a.id)}</option>)}
        </select>
        <input className="field flex-1 min-w-0" style={{ height: h, fontSize: font }} placeholder={phone ? t('Mensaje…') : target ? t('Mensaje para {name}…', { name: accName(target) }) : t('Mensaje para los Claude…')} title={t('Le llega directo a un Claude quieto del proyecto; si todos trabajan, al que trabaja al acabar su paso; si no hay nadie, se abre uno libre')} value={note} onChange={(e) => setNote(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void sendNote() }} />
        <button className="btn btn-sm btn-icon btn-primary flex-none" style={{ width: h, height: h }} disabled={!note.trim() || sending} onClick={() => void sendNote()} aria-label={t('Enviar')}><Send size={14} /></button>
      </div>
    </div>
  )
}

function whenShort(ms: number, now: number): string {
  const d = new Date(ms)
  const hm = d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })
  if (ms - now < 18 * 3600_000 && d.getDate() === new Date(now).getDate()) return t('a las {hm}', { hm: hm })
  return t('el {day} {hm}', { day: d.toLocaleDateString(locale(), { weekday: 'short' }).replace('.', ''), hm })
}

function AgentLive({ a, act, claims, floating }: { a: AgentCard; act?: AccountActivity; claims: Claim[]; floating?: boolean }) {
  const { now, toast, state, setAgentOpen } = useStore()
  const [open, setOpen] = useState(false)
  const [confirm, setConfirm] = useState(false)
  const m = STATE_META[a.state]
  const cur = act?.now
  const live = a.state === 'trabajando' && cur && now - cur.at < 3 * 60_000
  const mine = claims.filter((c) => c.account === a.id && !c.abandoned).map((c) => c.taskKey)
  const doing = workingOn(a, act, mine, now)
  const color = ACCOUNT_COLOR[a.id]
  const run = async (fn: () => Promise<unknown>, ok: string) => { try { await fn(); toast(ok) } catch (e) { toast((e as Error).message) } }
  const project = state?.projects.find((p) => p.id === state.activeProjectId)
  const openSheet = () => (floating ? void api('focusMain') : setAgentOpen(a.id))
  return (
    <div className="agent-live">
      <button className="border-0 bg-transparent p-0 flex-none self-start" onClick={openSheet} title={t('Ver {name}', { name: accName(a.id) })}><Avatar id={a.id} size={34} /></button>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="t-head">{accName(a.id)}</span>
          <span className="t-small flex items-center gap-1" style={{ color: m.color }}><span className={`dot ${a.state === 'trabajando' ? 'live-dot' : ''}`} style={{ background: m.color, color: m.color }} />{m.label}</span>
          {mine.length > 0 && <span className="t-small c3 truncate">· {mine.slice(0, 3).join(', ')}</span>}
        </div>
        <button className="w-full text-left border-0 p-0 mt-1.5 block rounded-xl" onClick={() => setOpen(!open)} title={t('Ver qué ha ido haciendo')}
          style={{ background: `color-mix(in srgb, ${color} 13%, transparent)`, padding: '8px 10px' }}>
          <span className="t-micro block" style={{ color }}>{doing.fresh ? t('Ahora') : t('Lo último')}{doing.since ? ` · ${t('desde las {hm}', { hm: new Date(doing.since).toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' }) })}` : ''}</span>
          <span className="block" style={{ fontSize: 15, fontWeight: 620, lineHeight: 1.3, letterSpacing: '-0.01em' }}>{doing.text}</span>
          {cur && (
            <span className="t-small c3 flex items-center gap-1 mt-1 min-w-0">
              {live && <span className="typing mr-0.5 flex-none" style={{ color }}><i /><i /><i /></span>}
              <span className="truncate">{cur.text}</span>
              <span className="flex-none">· {live ? t('ahora') : ago(cur.at, now)}</span>
              {open ? <ChevronUp size={12} className="flex-none" /> : <ChevronDown size={12} className="flex-none" />}
            </span>
          )}
        </button>
        <AnimatePresence initial={false}>
          {open && act && (
            <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={SPRING} className="overflow-hidden">
              {act.lastMessage && (
                <div className="mt-2 rounded-xl px-3 py-2 t-small c2 selectable whitespace-pre-wrap" style={{ background: 'var(--fill)', maxHeight: 180, overflowY: 'auto' }}>
                  <div className="t-micro c3 mb-1">{t('Lo último que dijo · {ago}', { ago: ago(act.lastMessage.at, now) })}</div>
                  {act.lastMessage.text}
                </div>
              )}
              {act.focusHistory.length > 0 && (
                <div className="mt-2 flex flex-col gap-1">
                  <div className="t-micro c3">{t('Antes')}</div>
                  {act.focusHistory.slice(0, 4).map((f, i) => (
                    <div key={i} className="t-small c2 flex gap-2"><span className="num flex-none w-12 c3">{new Date(f.at).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}</span><span className="truncate">{f.text}</span></div>
                  ))}
                </div>
              )}
              <div className="mt-2 flex flex-col gap-1">
                <div className="t-micro c3">{t('Últimos pasos')}</div>
                {act.recent.slice(1, 7).map((r, i) => (
                  <div key={i} className="t-small c3 flex gap-2"><span className="num flex-none w-12">{new Date(r.at).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}</span><span className="truncate">{r.text}</span></div>
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
        <div className="flex flex-wrap gap-1.5 mt-2">
          {a.sessions.length === 0 && a.state !== 'sin-uso' && project && (
            <button className="btn btn-sm btn-primary" onClick={() => run(() => api('putToWork', project.id, a.id), t('{name} se pone a trabajar', { name: accName(a.id) }))}><Play size={12} /> {t('Iniciar')}</button>
          )}
          {a.sessions.length > 0 && !confirm && (
            <button className="btn btn-sm" onClick={() => setConfirm(true)}><Power size={12} /> {t('Cerrar…')}</button>
          )}
          {confirm && (
            <>
              <button className="btn btn-sm btn-primary" title={t('En su próximo paso lee que debe dejar el relevo al día, liberar sus tareas y parar')} onClick={() => { setConfirm(false); void run(() => api('stopClaude', a.id, 'pedir'), t('{name} cerrará al terminar el paso en curso', { name: accName(a.id) })) }}><Hand size={12} /> {t('Pedir que cierre')}</button>
              <button className="btn btn-sm" style={{ color: 'var(--red)' }} title={t('Corta su proceso ahora: lo que estuviera escribiendo puede quedar a medias')} onClick={() => { setConfirm(false); void run(() => api('stopClaude', a.id, 'ya'), t('Sesión de {name} cerrada', { name: accName(a.id) })) }}><X size={12} /> {t('Cerrar ya')}</button>
              <button className="btn btn-sm btn-ghost" onClick={() => setConfirm(false)}>{t('No')}</button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

/** The Claudes at work, on every screen (or in its own always-on-top window), with a box to jot a note for them. */
export function Dock({ floating }: { floating?: boolean }) {
  const { state, now, toast, go, route } = useStore()
  // Open, it covers the right of the screen below ~1800 px (every capture of 12-11): there it starts as its small pill
  // unless the user opened it before; on wider windows the content makes room for it (styles.css › .dock-open).
  const [collapsed, setCollapsed] = useState(() => {
    if (floating) return false
    let saved: string | null = null
    try { saved = localStorage.getItem('pmc.dock') } catch { /* private */ }
    return saved ? saved === 'min' : window.innerWidth < 1800
  })
  useEffect(() => {
    if (floating) return
    const open = Boolean(state && !state.floating && !collapsed)
    document.documentElement.classList.toggle('dock-open', open)
    return () => document.documentElement.classList.remove('dock-open')
  }, [floating, collapsed, state?.floating, Boolean(state)])
  const pid = state?.activeProjectId
  const claimsQ = useAsync(() => (pid ? api<Claim[]>('claims', pid) : Promise.resolve([])), [pid, Math.floor(now / 60_000), state?.refreshedAt?.agents])
  // EV126: an account with no session on this PC (the empty slot of a new PC) is not a Claude yet.
  const agents = useMemo(() => (state?.agents ?? []).filter((a) => a.identity.hasLogin || a.sessions.length > 0), [state?.agents])
  const act = state?.activity ?? {}
  const active = useMemo(() => agents.filter((a) => isActive(a, act[a.id], now)), [agents, act, now])
  const rest = agents.filter((a) => !active.includes(a))
  const working = agents.filter((a) => a.state === 'trabajando').length
  // EV111: how many Claude windows are open (not background sessions), to see at a glance that none is left over.
  const windows = agents.reduce((n, a) => n + a.sessions.filter((s) => s.pid && s.kind !== 'background').length, 0)
  const windowsText = windows ? ` · ${tn(windows, '{n} ventana', '{n} ventanas')}` : ''
  const pending = state?.decisionsPending ?? 0
  const setMin = (v: boolean) => { setCollapsed(v); try { localStorage.setItem('pmc.dock', v ? 'min' : 'open') } catch { /* private */ } }
  if (!state) return null
  if (!floating && state.floating) return null
  // Nobody to show or to write to yet (a new PC): Primeros pasos says what is missing.
  if (!floating && !agents.length) return null
  // On the assistant's own screen the box to write in runs along the bottom: the dock covered its send button (13-11),
  // and «¿Quién trabaja?» is one of the assistant's own questions there.
  if (!floating && route === 'asistente') return null
  if (!floating && collapsed) {
    return (
      <motion.button className="dock-pill" onClick={() => setMin(false)} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={SPRING} title={t('Ver los Claude')}>
        <span className="flex -space-x-1.5">{(active.length ? active : agents).slice(0, 4).map((a) => <span key={a.id} style={{ boxShadow: '0 0 0 2px var(--bg-elev)', borderRadius: 9 }}><Avatar id={a.id} size={24} /></span>)}</span>
        <span className="t-small" style={{ fontWeight: 600 }}>{working ? t('{n} trabajando', { n: working }) : t('Claudes')}</span>
        {pending > 0 && <span className="pill num" style={{ background: 'var(--red)', color: 'white' }}>{pending}</span>}
        <ChevronUp size={14} className="c3" />
      </motion.button>
    )
  }
  const body = (
    <>
      <div className="dock-head">
        <span className="t-head">{t('Claudes')}</span>
        <span className="t-small c3" title={t('Ventanas de Claude abiertas en este PC (sin contar las de fondo)')}>{working ? t('{n} trabajando', { n: working }) : t('nadie trabajando')}{windowsText}</span>
        <div className="ml-auto flex items-center gap-1">
          {pending > 0 && (
            <button className="btn btn-sm" style={{ background: 'color-mix(in srgb, var(--red) 16%, transparent)', color: 'var(--red)' }} onClick={() => (floating ? void api('focusMain', '#/decisiones') : go('decisiones'))} title={t('Decisiones que esperan')}>
              <Gavel size={12} /> {pending}
            </button>
          )}
          <button className="btn btn-sm btn-icon btn-ghost" title={floating ? t('Volver a la ventana principal') : t('Sacar a una ventana flotante (siempre encima)')} onClick={() => void api('toggleFloating')}><PictureInPicture2 size={14} /></button>
          {floating
            ? <button className="btn btn-sm btn-icon btn-ghost" title={t('Cerrar la ventana flotante')} onClick={() => void api('closeWindow')}><X size={14} /></button>
            : <button className="btn btn-sm btn-icon btn-ghost" title={t('Minimizar')} onClick={() => setMin(true)}><Minus size={14} /></button>}
        </div>
      </div>
      <div className="dock-body" style={floating ? { maxHeight: 'none', flex: 1 } : undefined}>
        {active.map((a) => <AgentLive key={a.id} a={a} act={act[a.id]} claims={claimsQ.data ?? []} floating={floating} />)}
        {active.length === 0 && <div className="px-4 py-3 t-small c3">{t('Ningún Claude está trabajando ahora.')}</div>}
        {rest.length > 0 && (
          <div className="flex flex-wrap gap-1.5 px-3 py-2.5" style={{ borderTop: active.length ? '0.5px solid var(--sep)' : undefined }}>
            {rest.map((a) => <RestChip key={a.id} a={a} floating={floating} />)}
          </div>
        )}
      </div>
      <NoteBox />
    </>
  )
  if (floating) return <div className="floating-app">{body}</div>
  return (
    <motion.div className="dock" initial={{ opacity: 0, y: 14, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={SPRING} role="complementary" aria-label={t('Claudes activos')}>
      {body}
    </motion.div>
  )
}
