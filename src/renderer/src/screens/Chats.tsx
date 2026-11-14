// Every conversation of every Claude: which are open and what each is doing; opened, it reads like a chat and writing to it
// is the same as typing in its window on the PC.
import { ScreenIcon } from '../components/Sidebar'
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ChevronLeft, Send, Square, Plus, ChevronDown, ChevronRight, Paperclip, X, RotateCcw } from 'lucide-react'
import { useStore } from '../lib/store'
import { api, type AccountId } from '../lib/api'
import { Avatar, Empty, accName } from '../components/ui'
import { ago } from '../lib/format'

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
    img.onerror = () => reject(new Error(`No se pudo leer ${file.name}`))
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

const STATUS: Record<Chat['status'], [string, string]> = {
  working: ['Trabajando', 'var(--green)'],
  waiting: ['Te pregunta algo', 'var(--orange)'],
  limit: ['Sin uso: sigue cuando vuelva', 'var(--red)'],
  idle: ['Abierto, sin trabajar', 'var(--blue)'],
  closed: ['Cerrado', 'var(--gray)']
}

function Dot({ status }: { status: Chat['status'] }) {
  return <span className={`m-dot ${status === 'working' ? 'm-dot--live' : ''}`} style={{ background: STATUS[status][1] }} />
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
      const body = saved.length ? `${said} [Capturas del móvil, míralas con Read: ${saved.join(' ; ')}]`.trim() : said
      const how = await api<string>('chatSend', chat.sessionId, chat.cwd, chat.account, body)
      setText('')
      setShots([])
      pinned.current = true
      if (box.current) box.current.style.height = ''
      if (how === 'opened') toast('Chat cerrado: lo he abierto en el PC con tu mensaje')
      // EV141: a session with no window.
      else if (how === 'queued') toast('Está trabajando sin ventana: le llega tu mensaje en su siguiente paso')
      else if (how === 'resumed') toast('Sigue sin ventana con tu mensaje')
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
        <button className="m-icon" onClick={onBack} aria-label="Volver"><ChevronLeft size={24} /></button>
        {chat.account && <Avatar id={chat.account} size={32} />}
        <div className="min-w-0 flex-1">
          <div className="m-chatTitle truncate">{chatTitle(info, state?.projects)}</div>
          <div className="m-chatSub truncate"><Dot status={info.status} /> {info.doing || info.waitingFor || `${chat.account ? accName(chat.account) : chat.alias} · ${STATUS[info.status][0]}`}</div>
          {credits && <div className="m-chatCredits truncate">{credits}</div>}
        </div>
        {info.live && info.status === 'working' && <button className="m-icon" onClick={() => void key('esc')} aria-label="Parar"><Square size={18} /></button>}
        {!info.live && chat.account && <button className="btn btn-sm flex-none" title="Abre una ventana con esta conversación, donde la dejó" onClick={() => void api('resumeSession', chat.account, chat.cwd, chat.sessionId).then(() => toast('Retomando en una ventana nueva'), (e: Error) => toast(e.message))}><RotateCcw size={13} /> Retomar</button>}
        {/* EV141 (Decidir #148): a background session has no window; «Ver» opens one on it, to watch it and write to it. */}
        {chat.background && chat.account && <button className="btn btn-sm flex-none" title="Abre una ventana con esta sesión de fondo: la ves y le escribes como a cualquier Claude" onClick={() => void api('attachBackground', chat.account, chat.background).then(() => toast('Abriendo la sesión en una ventana'), (e: Error) => toast(e.message))}>Ver</button>}
        {/* EV151: an open session with a window: its window in front of the others. */}
        {info.live && !chat.background && <button className="btn btn-sm flex-none" title="Pone su ventana delante de las demás, para mirarla o escribirle" onClick={() => void api('frontSession', chat.sessionId).then(() => toast('Ventana delante'), (e: Error) => toast(e.message))}>Ver ventana</button>}
      </header>
      <div className="m-msgs" onScroll={(e) => { const el = e.currentTarget; pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80 }}>
        {!tail && <div className="m-note">Cargando…</div>}
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
          <span>{asking?.question || 'Te está pidiendo algo:'}</span>
          {asking?.options.length
            ? asking.options.map((o, i) => <button key={i} className="m-choiceWide" onClick={() => void key(String(i + 1))}>{i + 1}. {o}</button>)
            : ['1', '2', '3'].map((k) => <button key={k} onClick={() => void key(k)}>{k}</button>)}
          <button className="m-choiceSoft" onClick={() => void key('enter')}>Confirmar</button>
          <button className="m-choiceSoft" onClick={() => void key('esc')}>Cancelar</button>
        </div>
      )}
      {shots.length > 0 && (
        <div className="m-shots">
          {shots.map((s) => (
            <div key={s.id} className="m-shot">
              <img src={s.data} alt="" />
              <input value={s.note} placeholder="Nota (opcional)" onChange={(e) => setShots((all) => all.map((x) => (x.id === s.id ? { ...x, note: e.target.value } : x)))} />
              <button onClick={() => setShots((all) => all.filter((x) => x.id !== s.id))} aria-label="Quitar"><X size={16} /></button>
            </div>
          ))}
        </div>
      )}
      <div className="m-compose">
        <label className="m-clip" aria-label="Adjuntar capturas"><Paperclip size={20} /><input type="file" accept="image/*" multiple hidden onChange={(e) => { void pick(e.target.files); e.target.value = '' }} /></label>
        <textarea ref={box} rows={1} value={text} placeholder={info.live ? `Escribe a ${chat.account ? accName(chat.account) : chat.alias}…` : 'Escribe para retomar este chat…'}
          onChange={(e) => { setText(e.target.value); e.target.style.height = 'auto'; e.target.style.height = `${Math.min(e.target.scrollHeight, 140)}px` }} />
        <button className="m-send" disabled={(!text.trim() && !shots.length) || sending} onClick={() => void send()} aria-label="Enviar"><Send size={18} /></button>
      </div>
    </div>
  )
}

function NewChat({ onClose }: { onClose: () => void }) {
  const { state, toast } = useStore()
  const [text, setText] = useState('')
  const [who, setWho] = useState<AccountId>('claude1')
  const start = async () => {
    try {
      await api('chatNew', who, state?.activeProjectId, text.trim())
      toast('Abierto en el PC: aparecerá aquí en unos segundos')
      onClose()
    } catch (e) { toast((e as Error).message) }
  }
  return (
    <div className="m-sheetBack" onClick={onClose}>
      <div className="m-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="m-sheetTitle">Nuevo chat</div>
        <div className="m-who">{state?.accounts.map((a) => <button key={a.id} className={who === a.id ? 'on' : ''} onClick={() => setWho(a.id as AccountId)}><Avatar id={a.id as AccountId} size={30} /></button>)}</div>
        <textarea rows={4} autoFocus value={text} onChange={(e) => setText(e.target.value)} placeholder="¿Qué quieres que haga?" />
        <button className="m-primary" disabled={!text.trim()} onClick={() => void start()}>Empezar</button>
      </div>
    </div>
  )
}

export function Chats() {
  const { route, state } = useStore()
  const [chats, setChats] = useState<Chat[]>()
  const [open, setOpen] = useState<Chat>()
  const [adding, setAdding] = useState(false)
  const [all, setAll] = useState(false)
  useEffect(() => {
    let alive = true
    const read = () => api<Chat[]>('chats', all ? 150 : 15).then((c) => { if (alive) setChats(c) }).catch(() => undefined)
    void read()
    const t = setInterval(() => { if (watched()) void read() }, 4000)
    return () => { alive = false; clearInterval(t) }
  }, [route, all])
  if (open) return createPortal(<Conversation chat={open} onBack={() => setOpen(undefined)} />, document.body)
  const live = (chats ?? []).filter((c) => c.live)
  const closed = (chats ?? []).filter((c) => !c.live)
  const row = (c: Chat) => (
    <button key={c.sessionId} className="m-row" onClick={() => setOpen(c)}>
      <span className="relative flex-none">{c.account ? <Avatar id={c.account} size={46} /> : <span className="m-noAvatar" />}<span className="m-rowDot"><Dot status={c.status} /></span></span>
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline gap-2"><span className="m-rowTitle truncate flex-1">{chatTitle(c, state?.projects)}</span><span className="m-rowWhen">{ago(c.lastAt)}</span></span>
        <span className="m-rowDoing truncate" style={{ color: c.doing ? 'var(--label)' : undefined }}>{c.doing ? c.doing : c.last || STATUS[c.status][0]}</span>
        <span className="m-rowWho truncate">{c.account ? accName(c.account) : c.alias} · {STATUS[c.status][0]}</span>
      </span>
    </button>
  )
  return (
    <div className="m-list">
      <div className="flex items-center mb-2"><h1 className="t-display flex-1 flex items-center gap-3"><ScreenIcon route="chats" />Chats</h1><button className="m-add" onClick={() => setAdding(true)} aria-label="Nuevo chat"><Plus size={20} /></button></div>
      {chats && !chats.length && <Empty title="No hay chats" text="Cuando un Claude trabaje, aparecerá aquí." />}
      {live.length > 0 && <><div className="m-group">Abiertos ahora</div>{live.map(row)}</>}
      {closed.length > 0 && <><div className="m-group">{all ? 'Guardadas' : 'Recientes'}</div>{closed.map(row)}</>}
      {/* EV71: every saved conversation of the project is here (Cuentas only links here); each one opens and can be taken up again. */}
      {!all && closed.length >= 15 && <button className="btn btn-ghost mt-3" onClick={() => setAll(true)}><RotateCcw size={14} /> Ver todas las guardadas de este proyecto</button>}
      {adding && <NewChat onClose={() => setAdding(false)} />}
    </div>
  )
}
