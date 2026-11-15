// Every conversation of every Claude: which are open and what each is doing; opened, it reads like a chat and writing to it
// is the same as typing in its window on the PC.
import { t, tn } from '../../../core/i18n'
import { ScreenIcon } from '../components/Sidebar'
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ChevronLeft, Send, Square, Plus, ChevronDown, ChevronRight, Paperclip, X, RotateCcw } from 'lucide-react'
import { useStore } from '../lib/store'
import { api, type AccountId } from '../lib/api'
import { Avatar, Empty, STATE_META, accName } from '../components/ui'
import { ago, whenFull } from '../lib/format'
import { EmbeddedGrid, SessionsWhere, hasTerminals, startInApp } from '../components/EmbeddedGrid'
import { NoteBox } from '../components/Dock'
import { usePhone } from '../components/PhoneShell'
import { useDraft } from '../lib/draft'

export interface Chat {
  sessionId: string
  account?: AccountId
  alias: string
  cwd: string
  title: string
  status: 'working' | 'waiting' | 'limit' | 'idle' | 'closed'
  live: boolean
  /** EV141: a background session (its short id, for «Ver»: claude attach). */
  background?: string
  /** EV156: it lives inside the app (its terminal's id, in «Dentro de la app»). */
  inApp?: string
  doing?: string
  waitingFor?: string
  last?: string
  lastAt: number
  /** EV201: the project it works in now, when it is not its window's folder. */
  workProjectId?: string
}
/**
 * EV118: a chat Claude Code named with a slug («video-72», «mi-proyecto-ca») is shown by its project or
 * folder name; a real title (the first words of the conversation) stays.
 */
export function chatTitle(c: { title: string; cwd: string; workProjectId?: string }, projects: { id?: string; name: string; root: string }[] = []): string {
  if (!/^[a-z0-9]+(-[a-z0-9]+)+$/.test(c.title.trim())) return c.title
  // EV201: named after the project it works in now, not the folder its window was opened in.
  const work = c.workProjectId ? projects.find((x) => x.id === c.workProjectId) : undefined
  if (work) return work.name
  const cwd = c.cwd.toLowerCase().replace(/[\\/]+$/, '')
  const p = projects.find((x) => cwd.startsWith(x.root.toLowerCase().replace(/[\\/]+$/, '')))
  return p?.name ?? (c.cwd.split(/[\\/]/).filter(Boolean).pop() || c.title)
}
interface Message { id: string; role: 'user' | 'claude'; text: string; at: number; steps?: string[] }
interface Tail { messages: Message[]; midTurn: boolean; live: string[]; mtime: number; asking?: { question: string; options: string[] } }
interface Shot { id: number; name: string; data: string; note: string }

/** A picture from the phone, no bigger than it needs to be to read it. */
/** EV115: someone is looking at the window (App.tsx › useStill marks <html> «pmc-still» when nobody is). */
const watched = () => !document.documentElement.classList.contains('pmc-still')

function shrink(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      const k = Math.min(1, 1800 / Math.max(img.width, img.height))
      const canvas = document.createElement('canvas')
      canvas.width = Math.round(img.width * k)
      canvas.height = Math.round(img.height * k)
      canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height)
      URL.revokeObjectURL(url)
      resolve(canvas.toDataURL('image/jpeg', 0.86))
    }
    img.onerror = () => reject(new Error(t('No se pudo leer {name}', { name: file.name })))
    img.src = url
  })
}

/** How much of its credits a Claude has used, in few words. */
function useCredits(account?: AccountId): string {
  const { state } = useStore()
  const snap = (state as any)?.agents?.find((a: any) => a.id === account)?.usage?.snapshot
  const now = Date.now()
  const part = (label: string, w?: { usedPct: number; resetsAt: number }) => (w && w.resetsAt > now ? `${label} ${Math.round(w.usedPct)} %` : '')
  // EV175: said as /usage says it, «usado», not a bare number.
  const parts = [part(t('5 h'), snap?.fiveHour), part(t('semana'), snap?.sevenDay)].filter(Boolean).join(' · ')
  return parts ? t('usado: {v0}', { v0: parts }) : ''
}

const STATUS: Record<Chat['status'], { readonly label: string; color: string }> = {
  working: { get label() { return t('Trabajando') }, color: 'var(--green)' },
  waiting: { get label() { return t('Te pregunta algo') }, color: 'var(--orange)' },
  limit: { get label() { return t('Sin uso: sigue cuando vuelva') }, color: 'var(--red)' },
  idle: { get label() { return t('Abierto, sin trabajar') }, color: 'var(--blue)' },
  closed: { get label() { return t('Cerrado') }, color: 'var(--gray)' }
}

function Dot({ status }: { status: Chat['status'] }) {
  return <span className={`m-dot ${status === 'working' ? 'm-dot--live' : ''}`} style={{ background: STATUS[status].color }} />
}

/** Bold and code, the two marks Claude uses all the time; the rest stays as written. */
function Rich({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*\n]+\*\*|`[^`\n]+`)/g)
  return <>{parts.map((p, i) => (p.startsWith('**') && p.endsWith('**') && p.length > 4 ? <b key={i}>{p.slice(2, -2)}</b> : p.startsWith('`') && p.endsWith('`') && p.length > 2 ? <code key={i}>{p.slice(1, -1)}</code> : p))}</>
}

function Bubble({ m }: { m: Message }) {
  const [open, setOpen] = useState(false)
  return (
    <div className={`m-msg m-msg--${m.role}`}>
      {m.steps && m.steps.length > 0 && (
        <button className="m-steps" onClick={() => setOpen(!open)}>
          {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />} {m.steps.length} {m.steps.length === 1 ? 'paso' : 'pasos'}
        </button>
      )}
      {open && <div className="m-stepsList">{m.steps!.map((s, i) => <div key={i}>{s}</div>)}</div>}
      <div className="m-bubble"><Rich text={m.text} /></div>
    </div>
  )
}

function Conversation({ chat, onBack }: { chat: Chat; onBack: () => void }) {
  const { toast, state } = useStore()
  const [tail, setTail] = useState<Tail>()
  const [info, setInfo] = useState(chat)
  // EV185: what is written and not sent stays, per conversation.
  const [text, setText] = useDraft(`chat:${chat.sessionId}`)
  const [sending, setSending] = useState(false)
  const end = useRef<HTMLDivElement>(null)
  const pinned = useRef(true)
  const box = useRef<HTMLTextAreaElement>(null)
  const layer = useRef<HTMLDivElement>(null)

  // The chat is exactly as tall as what can be seen: when the keyboard comes up, the message box rises with it.
  useEffect(() => {
    const view = window.visualViewport
    if (!view) return
    const fit = () => {
      if (!layer.current) return
      // Only the keyboard shortens it: otherwise it keeps to the whole screen, which iOS reports short in an installed app.
      const typing = view.height < window.screen.height * 0.72
      layer.current.style.height = typing ? `${view.height}px` : ''
      layer.current.style.bottom = typing ? 'auto' : ''
      // Only when there is something to move: a layer shifted for nothing comes out blurred on an iPhone.
      layer.current.style.transform = view.offsetTop > 0.5 ? `translateY(${view.offsetTop}px)` : ''
      if (pinned.current) end.current?.scrollIntoView()
    }
    fit()
    view.addEventListener('resize', fit)
    view.addEventListener('scroll', fit)
    return () => { view.removeEventListener('resize', fit); view.removeEventListener('scroll', fit) }
  }, [])

  useEffect(() => {
    let alive = true
    const read = async () => {
      const t = await api<Tail | null>('chatRead', chat.sessionId, chat.cwd)
      if (alive && t) setTail(t)
    }
    const readInfo = async () => {
      const now = (await api<Chat[]>('chats')).find((c) => c.sessionId === chat.sessionId)
      if (alive && now) setInfo(now)
    }
    void read()
    void readInfo()
    // EV115: nobody looking (App.tsx › useStill), nothing asked: a second after they look again, it is up to date.
    const fast = setInterval(() => { if (!watched()) return; void read().catch(() => undefined) }, 1000)
    const slow = setInterval(() => { if (!watched()) return; void readInfo().catch(() => undefined) }, 5000)
    return () => { alive = false; clearInterval(fast); clearInterval(slow) }
  }, [chat.sessionId, chat.cwd])

  // EV177: Esc goes back to the list too (the user had to restart the app when «Volver» did not take the click). Not while
  // something is half written in the box: there Esc only leaves the box.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return
      // Esc in something open over the chat (the palette, the assistant) is theirs.
      if (e.target instanceof Node && e.target !== document.body && !layer.current?.contains(e.target)) return
      if (e.target === box.current && box.current?.value) { box.current.blur(); return }
      onBack()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onBack])

  const count = tail?.messages.length ?? 0
  const liveCount = tail?.live.length ?? 0
  useEffect(() => { if (pinned.current) end.current?.scrollIntoView() }, [count, liveCount])

  const [shots, setShots] = useState<Shot[]>([])
  const credits = useCredits(chat.account)
  const pick = async (files: FileList | null) => {
    if (!files) return
    const added: Shot[] = []
    for (const file of Array.from(files)) {
      try { added.push({ id: Date.now() + added.length, name: file.name, data: await shrink(file), note: '' }) } catch (e) { toast((e as Error).message) }
    }
    setShots((s) => [...s, ...added])
  }
  const send = async () => {
    const said = text.trim()
    if ((!said && !shots.length) || sending) return
    setSending(true)
    try {
      const saved: string[] = []
      for (const shot of shots) {
        const path = await api<string>('chatUpload', shot.name, shot.data)
        saved.push(shot.note.trim() ? `${path} (nota: ${shot.note.trim()})` : path)
      }
      const body = saved.length ? t('{said} [Capturas del móvil, míralas con Read: {v0}]', { said: said, v0: saved.join(' ; ') }).trim() : said
      const how = await api<string>('chatSend', chat.sessionId, chat.cwd, chat.account, body)
      setText('')
      setShots([])
      pinned.current = true
      if (box.current) box.current.style.height = ''
      if (how === 'opened') toast(t('Chat cerrado: lo he abierto en el PC con tu mensaje'))
      // EV141: a session with no window.
      else if (how === 'queued') toast(t('Está trabajando sin ventana: le llega tu mensaje en su siguiente paso'))
      else if (how === 'resumed') toast(t('Sigue sin ventana con tu mensaje'))
    } catch (e) {
      toast((e as Error).message)
    }
    setSending(false)
  }
  const key = (k: string) => api('chatKey', chat.sessionId, k).catch((e: Error) => toast(e.message))
  const asking = tail?.asking
  const stuck = info.status === 'waiting' || Boolean(asking)

  return (
    <div className="m-chat" ref={layer}>
      <header className="m-chatHead">
        <button className="m-icon" onClick={onBack} aria-label={t('Volver')}><ChevronLeft size={24} /></button>
        {chat.account && <Avatar id={chat.account} size={32} />}
        <div className="min-w-0 flex-1">
          <div className="m-chatTitle truncate">{chatTitle(info, state?.projects)}</div>
          <div className="m-chatSub truncate"><Dot status={info.status} /> {info.doing || info.waitingFor || `${chat.account ? accName(chat.account) : chat.alias} · ${STATUS[info.status].label}`}</div>
          {credits && <div className="m-chatCredits truncate">{credits}</div>}
        </div>
        {info.live && info.status === 'working' && <button className="m-icon" onClick={() => void key('esc')} aria-label={t('Parar')}><Square size={18} /></button>}
        {!info.live && chat.account && hasTerminals() && <button className="btn btn-sm flex-none" title={t('La retoma dentro de la app, en «Dentro de la app», donde la dejó')} onClick={() => void api<{ id: string }>('embedResume', chat.account, chat.cwd, chat.sessionId).then((r) => { onBack(); window.location.hash = `#/chats/${encodeURIComponent('pty:' + r.id)}` }, (e: Error) => toast(e.message))}><RotateCcw size={13} /> {t('Retomar aquí')}</button>}
        {!info.live && chat.account && <button className="btn btn-sm flex-none" title={t('Abre una ventana con esta conversación, donde la dejó')} onClick={() => void api('resumeSession', chat.account, chat.cwd, chat.sessionId).then(() => toast(t('Retomando en una ventana nueva')), (e: Error) => toast(e.message))}><RotateCcw size={13} /> {t('Retomar')}</button>}
        {/* EV141 (Decidir #148): a background session has no window; «Ver» opens one on it, to watch it and write to it. */}
        {chat.background && chat.account && <button className="btn btn-sm flex-none" title={t('Abre una ventana con esta sesión de fondo: la ves y le escribes como a cualquier Claude')} onClick={() => void api('attachBackground', chat.account, chat.background).then(() => toast(t('Abriendo la sesión en una ventana')), (e: Error) => toast(e.message))}>{t('Ver')}</button>}
        {/* EV151: an open session with a window: its window in front of the others. */}
        {info.live && info.inApp && hasTerminals() && <button className="btn btn-sm flex-none" title={t('Su terminal, dentro de la app: lo ves como en su ventana y le escribes allí')} onClick={() => { onBack(); window.location.hash = `#/chats/${encodeURIComponent('pty:' + info.inApp)}` }}>{t('Ver terminal')}</button>}
        {info.live && !chat.background && !info.inApp && <button className="btn btn-sm flex-none" title={t('Pone su ventana delante de las demás, para mirarla o escribirle')} onClick={() => void api('frontSession', chat.sessionId).then(() => toast(t('Ventana delante')), (e: Error) => toast(e.message))}>{t('Ver ventana')}</button>}
      </header>
      <div className="m-msgs" onScroll={(e) => { const el = e.currentTarget; pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80 }}>
        {!tail && <div className="m-note">{t('Cargando…')}</div>}
        {tail?.messages.map((m) => <Bubble key={m.id} m={m} />)}
        {(info.status === 'working' || tail?.midTurn) && (
          <div className="m-liveBox">
            {tail?.live.slice(-4).map((s, i) => <div key={`${liveCount - i}`} className="m-liveStep">{s}</div>)}
            <div className="m-typing"><i /><i /><i /></div>
          </div>
        )}
        <div ref={end} />
      </div>
      {stuck && (
        <div className="m-choices">
          <span>{asking?.question || t('Te está pidiendo algo:')}</span>
          {asking?.options.length
            ? asking.options.map((o, i) => <button key={i} className="m-choiceWide" onClick={() => void key(String(i + 1))}>{i + 1}. {o}</button>)
            : ['1', '2', '3'].map((k) => <button key={k} onClick={() => void key(k)}>{k}</button>)}
          <button className="m-choiceSoft" onClick={() => void key('enter')}>{t('Confirmar')}</button>
          <button className="m-choiceSoft" onClick={() => void key('esc')}>{t('Cancelar')}</button>
        </div>
      )}
      {shots.length > 0 && (
        <div className="m-shots">
          {shots.map((s) => (
            <div key={s.id} className="m-shot">
              <img src={s.data} alt="" />
              <input value={s.note} placeholder={t('Nota (opcional)')} onChange={(e) => setShots((all) => all.map((x) => (x.id === s.id ? { ...x, note: e.target.value } : x)))} />
              <button onClick={() => setShots((all) => all.filter((x) => x.id !== s.id))} aria-label={t('Quitar')}><X size={16} /></button>
            </div>
          ))}
        </div>
      )}
      <div className="m-compose">
        <label className="m-clip" aria-label={t('Adjuntar capturas')}><Paperclip size={20} /><input type="file" accept="image/*" multiple hidden onChange={(e) => { void pick(e.target.files); e.target.value = '' }} /></label>
        <textarea ref={box} rows={1} value={text} placeholder={info.live ? t('Escribe a {v0}…', { v0: chat.account ? accName(chat.account) : chat.alias }) : t('Escribe para retomar este chat…')}
          onChange={(e) => { setText(e.target.value); e.target.style.height = 'auto'; e.target.style.height = `${Math.min(e.target.scrollHeight, 140)}px` }} />
        <button className="m-send" disabled={(!text.trim() && !shots.length) || sending} onClick={() => void send()} aria-label={t('Enviar')}><Send size={18} /></button>
      </div>
    </div>
  )
}

function NewChat({ onClose, inApp }: { onClose: () => void; inApp?: boolean }) {
  const { state, toast } = useStore()
  const [text, setText] = useDraft('nuevo-chat')
  // EV195: the ones the user uses (not «de baja» nor «No usar»), each with its name under its number.
  const usable = (state?.accounts ?? []).filter((a) => { const ag = state?.agents.find((x) => x.id === a.id); return !ag || (ag.state !== 'baja' && ag.state !== 'apartada') })
  // First picked, the first one that can work now (not one without usage).
  const [who, setWho] = useState<AccountId>(() => ((usable.find((a) => state?.agents.find((x) => x.id === a.id)?.state !== 'sin-uso') ?? usable[0])?.id as AccountId | undefined) ?? 'claude1')
  const whoCard = state?.agents.find((x) => x.id === who)
  // EV156: inside the app (its terminal in Chats) or in a window of its own; first, what the user chose in Chats.
  // EV183: from the phone too (the PC opens it there; the phone follows it as a conversation).
  const [here, setHere] = useState(Boolean(inApp) || state?.settings.sessionsWhere !== 'ventana')
  const terminals = hasTerminals()
  const start = async () => {
    try {
      if (here && terminals && state?.activeProjectId) {
        const r = await startInApp(who, state.activeProjectId, text.trim()) as { id: string }
        setText('')
        window.location.hash = `#/chats/${encodeURIComponent('pty:' + r.id)}`
        toast(t('Abierto dentro de la app'))
      } else {
        await api('chatNew', who, state?.activeProjectId, text.trim(), here ? 'app' : 'ventana')
        setText('')
        toast(here ? t('Abierto dentro de la app del PC: aparecerá aquí en unos segundos') : t('Abierto en el PC: aparecerá aquí en unos segundos'))
      }
      onClose()
    } catch (e) { toast((e as Error).message) }
  }
  return (
    <div className="m-sheetBack" onClick={onClose}>
      <div className="m-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="m-sheetTitle">{t('Nuevo chat')}</div>
        <div className="m-who" role="radiogroup" aria-label={t('Con qué Claude')}>
          {usable.map((a) => (
            <button key={a.id} role="radio" aria-checked={who === a.id} className={who === a.id ? 'on' : ''} onClick={() => setWho(a.id as AccountId)} title={accName(a.id)}>
              <Avatar id={a.id as AccountId} size={30} /><span className="m-whoName">{accName(a.id)}</span>
            </button>
          ))}
        </div>
        <div className="m-whoSaid">
          {t('Con {name}', { name: accName(who) })}
          {whoCard && <span style={{ color: STATE_META[whoCard.state].color }}> · {STATE_META[whoCard.state].label}</span>}
          {whoCard?.state === 'sin-uso' && whoCard.usage.activeLimit && <span className="c3"> · {t('vuelve {v0}', { v0: whenFull(whoCard.usage.activeLimit.resetsAt, Date.now()) })}</span>}
        </div>
        <textarea rows={4} autoFocus value={text} onChange={(e) => setText(e.target.value)} placeholder={here && terminals ? t('¿Qué quieres que haga? (o déjalo vacío y escríbele en su terminal)') : t('¿Qué quieres que haga?')} />
        <div className="flex items-center gap-2 t-small c2">
          <span>{t('Dónde:')}</span>
          <span className="emb-where">
            <button className={here ? 'on' : ''} onClick={() => setHere(true)}>{t('Dentro de la app')}</button>
            <button className={!here ? 'on' : ''} onClick={() => setHere(false)}>{t('En su ventana')}</button>
          </span>
        </div>
        <button className="m-primary" disabled={!(here && terminals) && !text.trim()} onClick={() => void start()}>{t('Empezar')}</button>
      </div>
    </div>
  )
}

export function Chats() {
  const { route, state, param } = useStore()
  const [chats, setChats] = useState<Chat[]>()
  const [open, setOpen] = useState<Chat>()
  const [adding, setAdding] = useState<false | 'any' | 'app'>(false)
  // EV156: `#/chats/pty:<id>` brings a terminal of «Dentro de la app» in front (from a conversation or «Traer delante»).
  const focusId = param?.startsWith('pty:') ? param.slice(4) : undefined
  const [all, setAll] = useState(false)
  const phone = usePhone() || window.pmc?.platform === 'remote'
  useEffect(() => {
    let alive = true
    const read = () => api<Chat[]>('chats', all ? 150 : 15).then((c) => { if (alive) setChats(c) }).catch(() => undefined)
    void read()
    const t = setInterval(() => { if (watched()) void read() }, 4000)
    return () => { alive = false; clearInterval(t) }
  }, [route, all])
  // EV186: `#/chats/chat:<session>` (from Inicio) opens that conversation once the list has it.
  const openId = param?.startsWith('chat:') ? param.slice(5) : undefined
  useEffect(() => {
    if (!openId || !chats) return
    const c = chats.find((x) => x.sessionId === openId)
    if (c) setOpen(c)
    window.history.replaceState(null, '', '#/chats')
  }, [openId, chats])
  if (open) return createPortal(<Conversation chat={open} onBack={() => setOpen(undefined)} />, document.body)
  // EV170 (the user, 14-11: «la sección "chats" es un poco confusa ahora mismo y difícil de entender»): grouped by what
  // matters to the user, in that order, each group saying what it is and what can be done with it.
  const list = chats ?? []
  const projectOf = (c: Chat) => {
    // EV201: where it works now (what it touches), when that is not its window's folder.
    if (c.workProjectId) { const w = state?.projects.find((p) => p.id === c.workProjectId); if (w) return w.name }
    const cwd = c.cwd.toLowerCase().replace(/[\\/]+$/, '')
    return state?.projects.find((p) => { const r = p.root.toLowerCase().replace(/[\\/]+$/, ''); return cwd === r || cwd.startsWith(r + '\\') || cwd.startsWith(r + '/') })?.name
  }
  const groups: { key: string; title: string; hint: string; items: Chat[] }[] = [
    { key: 'waiting', title: t('Te esperan'), hint: t('Te preguntan algo o piden permiso: ábrelo para contestar.'), items: list.filter((c) => c.live && c.status === 'waiting') },
    { key: 'working', title: t('Trabajando ahora'), hint: t('Ábrelo para ver qué hace o escribirle; lo lee al acabar su paso.'), items: list.filter((c) => c.live && c.status === 'working') },
    { key: 'idle', title: t('Abiertos, sin trabajar'), hint: t('Tienen su ventana abierta pero están quietos: escríbeles para darles trabajo.'), items: list.filter((c) => c.live && c.status === 'idle') },
    { key: 'limit', title: t('Sin uso'), hint: t('Se les acabó el uso: siguen solos cuando vuelva.'), items: list.filter((c) => c.live && c.status === 'limit') },
    { key: 'closed', title: all ? t('Conversaciones guardadas') : t('Conversaciones recientes'), hint: t('Ya cerradas: ábrelas para leerlas o retomarlas donde lo dejaron.'), items: list.filter((c) => !c.live) }
  ]
  const row = (c: Chat) => {
    const project = projectOf(c)
    return (
      <button key={c.sessionId} className="m-row" onClick={() => setOpen(c)} title={t('Abrir la conversación')}>
        <span className="relative flex-none">{c.account ? <Avatar id={c.account} size={46} /> : <span className="m-noAvatar" />}<span className="m-rowDot"><Dot status={c.status} /></span></span>
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline gap-2"><span className="m-rowTitle truncate flex-1">{chatTitle(c, state?.projects)}</span><span className="m-rowWhen">{ago(c.lastAt)}</span></span>
          <span className="m-rowDoing truncate" style={{ color: c.doing ? 'var(--label)' : undefined }}>{c.doing ? c.doing : c.waitingFor || c.last || STATUS[c.status].label}</span>
          <span className="m-rowWho truncate flex items-center gap-1.5">
            <span>{c.account ? accName(c.account) : c.alias}</span>
            {project && <span className="pill" style={{ padding: '0 6px', fontSize: 11 }}>{project}</span>}
            <span style={{ color: STATUS[c.status].color, fontWeight: 600 }}>{STATUS[c.status].label}</span>
            {c.background && <span className="c3">{t('· de fondo, sin ventana')}</span>}
            {c.inApp && <span className="c3">{t('· dentro de la app')}</span>}
          </span>
        </span>
        <ChevronRight size={18} className="c3 flex-none" />
      </button>
    )
  }
  return (
    <div className="m-list">
      <div className="flex items-center gap-3 mb-1">
        <h1 className="t-display flex-1 flex items-center gap-3"><ScreenIcon route="chats" />{t('Chats')}</h1>
        <button className="btn btn-sm btn-primary" onClick={() => setAdding('any')}><Plus size={14} /> {t('Nuevo chat')}</button>
      </div>
      <div className="t-small c2 mb-4">{t('Las conversaciones de tus Claude, como en un móvil: ábrelas para ver qué hacen, contestarles o darles trabajo. Arriba, lo que te espera.')}</div>
      {/* EV197: on the phone too, the Claudes inside the app first, as their console shows them on the PC. */}
      <EmbeddedGrid focusId={focusId} onNew={() => setAdding('app')} />
      {/* EV183 (the user, 15-11 03:10): on the phone there is no dock; the same box to write to all or to one, and where the
          Claudes the app opens go (the ones inside the app show below as conversations, «· dentro de la app»). */}
      {phone && (
        <section className="card mb-4" style={{ padding: '10px 4px 4px' }}>
          <div className="m-group px-2" style={{ margin: 0 }}>{t('Escribir a los Claude')}</div>
          <div className="t-small c3 px-2">{t('Para todos o para uno: le llega directo, y si no está abierto, se abre para eso.')}</div>
          <NoteBox phone />
          <div className="flex items-center gap-2 flex-wrap px-2 pb-2 t-small c3"><span>{t('Abrir los Claude:')}</span><SessionsWhere /></div>
        </section>
      )}
      {chats && !chats.length && <Empty title={t('No hay chats')} text={t('Cuando un Claude trabaje, aparecerá aquí. Con «Nuevo chat» abres uno en el proyecto que elijas.')} />}
      {groups.filter((g) => g.items.length).map((g) => (
        <section key={g.key} className="mb-2">
          <div className="m-group" style={g.key === 'waiting' ? { color: 'var(--orange)' } : undefined}>{g.title} · {g.items.length}</div>
          <div className="t-small c3 px-1 mb-1">{g.hint}</div>
          {g.items.map(row)}
        </section>
      ))}
      {/* EV71: every saved conversation of the project is here (Cuentas only links here); each one opens and can be taken up again. */}
      {!all && list.filter((c) => !c.live).length >= 15 && <button className="btn btn-ghost mt-3" onClick={() => setAll(true)}><RotateCcw size={14} /> {t('Ver todas las guardadas de este proyecto')}</button>}
      {adding && <NewChat inApp={adding === 'app'} onClose={() => setAdding(false)} />}
    </div>
  )
}

/**
 * EV186 (the user, 15-11 03:40: «un acceso rápido o vistazo rápido a los chats en inicio siempre viene bien»): in Inicio,
 * on the PC and on the phone, the chats open now, the ones that ask something first; each one opens its conversation
 * (on the PC, one inside the app opens its terminal), and «Ver todos» goes to Chats.
 */
export function ChatsGlance() {
  const { state, go } = useStore()
  const [chats, setChats] = useState<Chat[]>()
  useEffect(() => {
    let alive = true
    const read = () => api<Chat[]>('chats', 15).then((c) => { if (alive) setChats(c) }).catch(() => undefined)
    void read()
    const timer = setInterval(() => { if (watched()) void read() }, 8000)
    return () => { alive = false; clearInterval(timer) }
  }, [])
  if (!chats) return null
  const rank: Record<Chat['status'], number> = { waiting: 0, working: 1, idle: 2, limit: 3, closed: 4 }
  const live = chats.filter((c) => c.live).sort((a, b) => rank[a.status] - rank[b.status] || b.lastAt - a.lastAt)
  const asking = live.filter((c) => c.status === 'waiting').length
  const working = live.filter((c) => c.status === 'working').length
  const summary = [asking && tn(asking, '{n} te pregunta', '{n} te preguntan'), working && tn(working, '{n} trabajando', '{n} trabajando')].filter(Boolean).join(' · ')
  const open = (c: Chat) => go('chats', c.inApp && hasTerminals() ? `pty:${c.inApp}` : `chat:${c.sessionId}`)
  return (
    <section className="mb-7">
      <h2 className="section-title">{t('Chats')} {summary && <span className="t-small c3" style={{ fontWeight: 450 }}>· {summary}</span>} <button className="more" onClick={() => go('chats')}>{t('Ver todos')}</button></h2>
      {live.length === 0
        ? <div className="t-small c3">{t('Ningún chat abierto ahora. En Chats están los guardados y puedes abrir uno nuevo.')}</div>
        : (
          <div className="group">
            {live.slice(0, 5).map((c) => (
              <button key={c.sessionId} className="m-row" onClick={() => open(c)} title={t('Abrir la conversación')}>
                <span className="relative flex-none">{c.account ? <Avatar id={c.account} size={36} /> : <span className="m-noAvatar" />}<span className="m-rowDot"><Dot status={c.status} /></span></span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline gap-2"><span className="m-rowTitle truncate flex-1">{chatTitle(c, state?.projects)}</span><span className="m-rowWhen">{ago(c.lastAt)}</span></span>
                  <span className="m-rowDoing truncate" style={{ color: c.doing ? 'var(--label)' : undefined }}>{c.doing || c.waitingFor || c.last || STATUS[c.status].label}</span>
                  <span className="m-rowWho truncate flex items-center gap-1.5">
                    <span>{c.account ? accName(c.account) : c.alias}</span>
                    <span style={{ color: STATUS[c.status].color, fontWeight: 600, marginLeft: 6 }}>{STATUS[c.status].label}</span>
                    {c.inApp && <span className="c3" style={{ marginLeft: 6 }}>{t('· dentro de la app')}</span>}
                  </span>
                </span>
                <ChevronRight size={18} className="c3 flex-none" />
              </button>
            ))}
            {live.length > 5 && <button className="btn btn-ghost btn-sm mt-1" onClick={() => go('chats')}>{t('Y {n} más en Chats', { n: live.length - 5 })}</button>}
          </div>
        )}
    </section>
  )
}
