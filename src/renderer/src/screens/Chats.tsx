// Every conversation of every Claude: which are open and what each is doing; opened, it reads like a chat and writing to it
// is the same as typing in its window on the PC.
import { t } from '../../../core/i18n'
import { ScreenIcon } from '../components/Sidebar'
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ChevronLeft, Send, Square, Plus, ChevronDown, ChevronRight, Paperclip, X, RotateCcw } from 'lucide-react'
import { useStore } from '../lib/store'
import { api, type AccountId } from '../lib/api'
import { Avatar, Empty, accName } from '../components/ui'
import { ago } from '../lib/format'
import { EmbeddedGrid, hasTerminals, startInApp } from '../components/EmbeddedGrid'

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
}
/**
 * EV118: a chat Claude Code named with a slug («video-72», «mi-proyecto-ca») is shown by its project or
 * folder name; a real title (the first words of the conversation) stays.
 */
export function chatTitle(c: { title: string; cwd: string }, projects: { name: string; root: string }[] = []): string {
  if (!/^[a-z0-9]+(-[a-z0-9]+)+$/.test(c.title.trim())) return c.title
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
  return [part('5 h', snap?.fiveHour), part('semana', snap?.sevenDay)].filter(Boolean).join(' · ')
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
  const [text, setText] = useState('')
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
        {info.live && info.inApp && <button className="btn btn-sm flex-none" title={t('Su terminal, dentro de la app: lo ves como en su ventana y le escribes allí')} onClick={() => { onBack(); window.location.hash = `#/chats/${encodeURIComponent('pty:' + info.inApp)}` }}>{t('Ver terminal')}</button>}
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
  const [text, setText] = useState('')
  const [who, setWho] = useState<AccountId>('claude1')
  // EV156: inside the app (its terminal in Chats) or in a window of its own; first, what the user chose in Chats.
  const [here, setHere] = useState(hasTerminals() && (inApp || state?.settings.sessionsWhere === 'app'))
  const start = async () => {
    try {
      if (here && state?.activeProjectId) {
        const r = await startInApp(who, state.activeProjectId, text.trim()) as { id: string }
        window.location.hash = `#/chats/${encodeURIComponent('pty:' + r.id)}`
        toast(t('Abierto dentro de la app'))
      } else {
        await api('chatNew', who, state?.activeProjectId, text.trim())
        toast(t('Abierto en el PC: aparecerá aquí en unos segundos'))
      }
      onClose()
    } catch (e) { toast((e as Error).message) }
  }
  return (
    <div className="m-sheetBack" onClick={onClose}>
      <div className="m-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="m-sheetTitle">{t('Nuevo chat')}</div>
        <div className="m-who">{state?.accounts.map((a) => <button key={a.id} className={who === a.id ? 'on' : ''} onClick={() => setWho(a.id as AccountId)}><Avatar id={a.id as AccountId} size={30} /></button>)}</div>
        <textarea rows={4} autoFocus value={text} onChange={(e) => setText(e.target.value)} placeholder={here ? t('¿Qué quieres que haga? (o déjalo vacío y escríbele en su terminal)') : t('¿Qué quieres que haga?')} />
        {hasTerminals() && (
          <div className="flex items-center gap-2 t-small c2">
            <span>{t('Dónde:')}</span>
            <span className="emb-where">
              <button className={here ? 'on' : ''} onClick={() => setHere(true)}>{t('Dentro de la app')}</button>
              <button className={!here ? 'on' : ''} onClick={() => setHere(false)}>{t('En su ventana')}</button>
            </span>
          </div>
        )}
        <button className="m-primary" disabled={!here && !text.trim()} onClick={() => void start()}>{t('Empezar')}</button>
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
  useEffect(() => {
    let alive = true
    const read = () => api<Chat[]>('chats', all ? 150 : 15).then((c) => { if (alive) setChats(c) }).catch(() => undefined)
    void read()
    const t = setInterval(() => { if (watched()) void read() }, 4000)
    return () => { alive = false; clearInterval(t) }
  }, [route, all])
  if (open) return createPortal(<Conversation chat={open} onBack={() => setOpen(undefined)} />, document.body)
  // EV170 (the user, 14-11: «la sección "chats" es un poco confusa ahora mismo y difícil de entender»): grouped by what
  // matters to the user, in that order, each group saying what it is and what can be done with it.
  const list = chats ?? []
  const projectOf = (c: Chat) => {
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
      <EmbeddedGrid focusId={focusId} onNew={() => setAdding('app')} />
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
