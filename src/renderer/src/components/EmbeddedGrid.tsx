// EV156 (the user, 14-11 ~12:10: «poder añadir el claude dentro de la app, para verlo, igual que lo veo en el cmd… ver
// todos los claude más fácilmente, pero tener la opción de despegarlos o volverlos a anclar»): in Chats, every Claude
// that lives inside the app, all at once, each one as its console shows it and typed into right there. «Despegar» puts
// one in a window of its own; «Anclar» (or closing that window) brings it back here. Closing the app leaves them running.
import { t } from '../../../core/i18n'
import { useEffect, useRef, useState } from 'react'
import { ExternalLink, Maximize2, Minimize2, Pin, Plus, RotateCcw, X } from 'lucide-react'
import { useStore } from '../lib/store'
import { api, type AccountId } from '../lib/api'
import { ago } from '../lib/format'
import { Avatar, accName } from './ui'
import { AppTerminal } from './AppTerminal'

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
}

/** Only in the app on the PC: the phone has no terminals. */
export const hasTerminals = () => Boolean(window.pmc?.pty) && window.pmc.platform !== 'remote'

const watched = () => !document.documentElement.classList.contains('pmc-still')

export function useEmbedded(): [Embedded[] | undefined, () => void] {
  const { state } = useStore()
  const [list, setList] = useState<Embedded[]>()
  const read = () => { void api<Embedded[]>('embedList').then(setList, () => setList([])) }
  useEffect(() => {
    if (!hasTerminals()) return
    read()
    const timer = setInterval(() => { if (watched()) read() }, 3000)
    return () => clearInterval(timer)
    // The main process says when one opens or ends (a new state): read again then too.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state])
  return [list, read]
}

function Tile({ s, focus, onChanged }: { s: Embedded; focus: boolean; onChanged: () => void }) {
  const { toast, state } = useStore()
  const [big, setBig] = useState(false)
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
  }, [big])
  const account = s.meta.account as AccountId
  const project = s.projectName ?? state?.projects.find((p) => p.id === s.meta.projectId)?.name
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
    <div ref={box} className={`emb-tile ${focus ? 'is-focus' : ''} ${big ? 'is-big' : ''}`}>
      <div className="emb-head">
        <Avatar id={account} size={22} />
        <div className="min-w-0 flex-1">
          <div className="emb-title">{accName(account)}{project ? ` · ${project}` : ''}</div>
          <div className="emb-sub"><span style={{ color, fontWeight: 600 }}>{status}</span> · {s.alive ? t('abierto {v0}', { v0: ago(s.startedAt) }) : ago(s.endedAt ?? s.lastDataAt)}</div>
        </div>
        {!s.popped && <button className="emb-icon" title={big ? t('Volver a su sitio (Mayús+Esc)') : t('Verlo en grande dentro de la app')} onClick={() => setBig(!big)}>{big ? <Minimize2 size={13} /> : <Maximize2 size={13} />}</button>}
        {s.popped
          ? <button title={t('Vuelve a dibujarlo aquí y cierra su ventana (sigue trabajando)')} onClick={() => void call('embedDock', s.id)}><Pin size={13} /> {t('Anclar')}</button>
          : <button title={t('Lo saca a una ventana propia; al cerrarla vuelve aquí. Sigue trabajando igual')} onClick={() => { setBig(false); void call('embedPopOut', s.id) }}><ExternalLink size={13} /> {t('Despegar')}</button>}
        <button className="emb-icon" style={sure ? { background: 'var(--red)', borderColor: 'var(--red)', width: 'auto', padding: '0 8px' } : undefined}
          title={s.alive ? t('Cierra este Claude (lo que no haya guardado se pierde)') : t('Quitarlo de aquí')} onClick={close}>
          {sure ? t('¿Cerrar? Otra vez') : <X size={13} />}
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
            <span className="flex-1">{t('Este Claude terminó{v0}.', { v0: s.exitCode ? t(' (código {v0})', { v0: s.exitCode }) : '' })}</span>
            {conv.current && <button className="btn btn-sm" onClick={resume}><RotateCcw size={13} /> {t('Retomar aquí')}</button>}
            <button className="btn btn-sm btn-ghost" onClick={() => void call('embedForget', s.id)}>{t('Quitar')}</button>
          </div>
        )}
      </div>
    </div>
  )
}

/** «Dónde se abren los Claude que abra la app»: their own window, as until now, or here. */
export function SessionsWhere() {
  const { state, refresh, toast } = useStore()
  const where = state?.settings.sessionsWhere ?? 'ventana'
  const set = (v: 'ventana' | 'app') => void api('setSettings', { sessionsWhere: v }).then(refresh, (e: Error) => toast(e.message))
  return (
    <span className="emb-where" title={t('Dónde se abren los Claude que abre la app (relevos, la rueda, Poner a trabajar, Nuevo chat)')}>
      <button className={where === 'ventana' ? 'on' : ''} onClick={() => set('ventana')}>{t('En su ventana')}</button>
      <button className={where === 'app' ? 'on' : ''} onClick={() => set('app')}>{t('Dentro de la app')}</button>
    </span>
  )
}

export function EmbeddedGrid({ focusId, onNew }: { focusId?: string; onNew: () => void }) {
  const [list, read] = useEmbedded()
  if (!hasTerminals()) return null
  const items = list ?? []
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
          : t('Aquí ves y escribes a los Claude como en su ventana, todos a la vez. Abre uno con «Abrir uno aquí», o elige «Dentro de la app» para que se abran aquí los que abra la app.')}
      </div>
      {items.length > 0 && <div className="emb-grid">{items.map((s) => <Tile key={s.id} s={s} focus={s.id === focusId} onChanged={read} />)}</div>}
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
