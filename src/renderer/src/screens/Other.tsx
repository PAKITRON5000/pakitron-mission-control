import { ThemePicker } from '../components/ThemePicker'
import { LayoutPicker } from '../layouts/Picker'
import { ScreenIcon } from '../components/Sidebar'
import { LANGS, getLang, t, type Lang, tn } from '../../../core/i18n'
import { useEffect, useState } from 'react'
import { GitBranch, FileText, FolderOpen, RotateCcw, Check, Send, Copy, Plus, HardDriveDownload, ShieldCheck, Terminal, ChevronRight, Trash2, UserPlus } from 'lucide-react'
import { NoticeSettings, PhoneSetup } from '../components/PhoneSetup'
import { MemoryBox } from '../components/MemoryBox'
import { AfterRestart } from '../components/AfterRestart'
import { startTour } from '../components/Tour'
import { RequestsBox, type UserRequest } from '../components/RequestsBox'
import { NewProject, ProjectBrain } from '../components/ProjectBrain'
import { useStore, useAsync } from '../lib/store'
import { api, media, type Comment, type Instruction, type TimelineEvent, type AccountId, type AgentCard } from '../lib/api'
import { Avatar, StatePill, SectionTitle, Segmented, Empty, ACCOUNT_COLOR, Bar, Recharge, accName, ACCOUNT_NAME } from '../components/ui'
import { UsageBar } from '../components/ClaudeRing'
import { ImproveButton } from '../components/ImproveProject'
import { ago, clock, countdown, dateShort, modelName, whenFull, plural } from '../lib/format'

// ---- Agentes: the accounts in use side by side (the ones set aside or gone, on request) ---------------------------------------------------------------------------------

export function Agents() {
  const { state, now, setAgentOpen, toast } = useStore()
  const pid = state?.activeProjectId
  const project = state?.projects.find((p) => p.id === pid)
  const saved = useAsync(() => (pid ? api<any[]>('sessions', pid) : Promise.resolve([])), [pid, state?.refreshedAt?.agents])
  const [showOut, setShowOut] = useState(false)
  if (!state) return null
  // With six accounts the table no longer fitted, and two columns were of accounts the user does not use (12-11).
  const out = state.agents.filter((a) => a.state === 'baja' || a.state === 'apartada')
  const shown = state.agents.filter((a) => showOut || !out.includes(a))
  const rows: { label: string; get: (a: AgentCard) => React.ReactNode }[] = [
    { label: t('Estado'), get: (a) => <div className="flex flex-col gap-1"><StatePill state={a.state} /><span className="t-small c3">{a.stateReason}</span></div> },
    { label: t('Trabajando en'), get: (a) => <span className="clamp-3">{a.sessions[0]?.title ?? a.heartbeat?.text.slice(0, 140) ?? <span className="c3">—</span>}</span> },
    { label: t('Última actividad'), get: (a) => ago(a.lastActivityAt, now) },
    { label: t('Modelo'), get: (a) => modelName(a.model) ?? <span className="c3">{t('Sin datos')}</span> },
    { label: t('5 horas'), get: (a) => <div className="min-w-[170px]"><UsageBar a={a} which="five" now={now} compact /></div> },
    { label: t('Semana'), get: (a) => <div className="min-w-[170px]"><UsageBar a={a} which="week" now={now} compact /></div> },
    { label: t('Lectura de consumo'), get: (a) => (state.statusLine[a.id]?.ours ? (a.usage.snapshot ? t('Línea de estado · {v0}', { v0: ago(a.usage.snapshot.capturedAt, now) }) : t('Instalada · esperando la primera respuesta')) : <span className="c3">{t('No instalada')}</span>) },
    { label: t('Sesiones abiertas'), get: (a) => a.sessions.some((x) => x.pid || x.status === 'busy') ? a.sessions.filter((x) => x.pid || x.status === 'busy').map((s) => `${s.kind === 'background' ? 'fondo' : 'ventana'} · ${s.worktree ?? s.cwd.split(/[\\/]/).pop()}`).join(', ') : <span className="c3">{t('Ninguna')}</span> },
    { label: t('Tareas a su nombre'), get: (a) => a.assigned.length || <span className="c3">0</span> },
    { label: t('Último relevo'), get: (a) => (a.heartbeat ? `${dateShort(a.heartbeat.at)} ${clock(a.heartbeat.at)}` : <span className="c3">—</span>) }
  ]
  return (
    <div className="content-inner">
      <h1 className="t-display">{t('Cuentas')}</h1>
      <div className="t-head c2 mt-1.5 mb-7 flex items-center gap-3 flex-wrap" style={{ fontWeight: 450 }}>{t('Las cuentas en uso, lado a lado: qué hacen, cuánto uso les queda y sus conversaciones. El nombre y si se usan, en Relevos.')}{out.length > 0 && <button className="btn btn-sm btn-ghost" onClick={() => setShowOut(!showOut)}>{showOut ? t('Ocultar las que no se usan') : t('Ver también {v0}', { v0: out.map((a) => `${accName(a.id)}`).join(' y ') })}</button>}</div>
      <div className="group overflow-x-auto mb-9">
        <table className="w-full t-small" style={{ borderCollapse: 'separate', borderSpacing: 0 }}>
          <thead>
            <tr>
              <th className="w-40" />
              {shown.map((a) => (
                <th key={a.id} className="text-left p-4 align-bottom min-w-[190px]">
                  <button className="flex items-center gap-2.5 border-0 bg-transparent p-0" onClick={() => setAgentOpen(a.id)}>
                    <Avatar id={a.id} size={32} />
                    <div className="text-left"><div className="t-head">{accName(a.id)}</div><div className="t-small c3" style={{ fontWeight: 450 }}>{t('Claude {v0}', { v0: a.id.slice(6) })}</div></div>
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.label}>
                <td className="px-4 py-3 c3 align-top border-t" style={{ borderColor: 'var(--sep)' }}>{r.label}</td>
                {shown.map((a) => <td key={a.id} className="px-4 py-3 align-top border-t" style={{ borderColor: 'var(--sep)' }}>{r.get(a)}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <SectionTitle title={t('Conversaciones del proyecto')} sub={t('Abiertas ahora o guardadas para retomarlas')} />
      <div className="group">
        {(saved.data ?? []).slice(0, 40).map((s) => (
          <div key={s.sessionId} className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-[var(--fill)] t-small">
            <span className="w-24 c3 num flex-none">{ago(s.mtime, now)}</span>
            {s.account ? <span className="flex items-center gap-1.5 w-24 flex-none"><span className="dot" style={{ background: ACCOUNT_COLOR[s.account as AccountId] }} />{accName(s.account)}</span> : <span className="w-24 c3 flex-none">¿?</span>}
            <span className="truncate flex-1">{s.title ?? s.lastPrompt ?? s.sessionId}</span>
            <span className="c3 w-24 truncate flex-none">{s.copy}</span>
            <span className="w-20 flex-none" style={{ color: s.live ? 'var(--green)' : 'var(--label-3)' }}>{s.live ? t('Abierta') : t('Guardada')}</span>
            {!s.live && s.account && (
              <button className="btn btn-sm" onClick={() => api('resumeSession', s.account, s.cwd, s.sessionId).then(() => toast(t('Retomando en una ventana nueva')), (e: Error) => toast(e.message))}><RotateCcw size={12} /> {t('Retomar')}</button>
            )}
          </div>
        ))}
        {saved.data && saved.data.length === 0 && <Empty title={t('Sin conversaciones guardadas')} text={t('Cuando un Claude trabaje en este proyecto, su conversación queda aquí y podrás retomarla donde la dejó.')} />}
      </div>
      {project && <div className="t-small c3 mt-3">{t('Retomar abre una ventana de esa cuenta en la carpeta de la copia. No se arranca nada sin que pulses.')}</div>}
    </div>
  )
}

// ---- Revisiones ---------------------------------------------------------------------------------------------------

export function Reviews() {
  const { state, setViewer, toast } = useStore()
  const pid = state?.activeProjectId
  const project = state?.projects.find((p) => p.id === pid)
  const [tab, setTab] = useState<'abiertos' | 'instrucciones' | 'cerrados'>('abiertos')
  const comments = useAsync(() => (pid ? api<Comment[]>('comments', pid) : Promise.resolve([])), [pid, state?.now])
  const ins = useAsync(() => (pid ? api<Instruction[]>('instructions', pid) : Promise.resolve([])), [pid, state?.now])
  // 14-11 (the user: «no entiendo bien qué revisar en cada cosa»): what each one is waiting for, in words, the ones to
  // look at first, and what the Claude did under what was asked (it was only in the history, and «esperando-revision»
  // said nothing).
  const ORDER: Record<string, number> = { 'esperando-revision': 0, corregido: 0, reabierto: 1, 'en-correccion': 2, recibido: 2, pendiente: 3 }
  const open = (comments.data ?? []).filter((c) => c.status !== 'aprobado')
    .sort((a, b) => (ORDER[a.status] ?? 9) - (ORDER[b.status] ?? 9) || b.updatedAt - a.updatedAt)
  const closed = (comments.data ?? []).filter((c) => c.status === 'aprobado')
  const toLook = open.filter((c) => ORDER[c.status] === 0).length
  const S: Record<string, [string, string]> = {
    pendiente: [t('Aún no lo ha leído ningún Claude'), 'var(--label-3)'], recibido: [t('Lo tiene un Claude'), 'var(--teal)'], 'en-correccion': [t('Un Claude lo está arreglando'), 'var(--teal)'],
    corregido: [t('Arreglado: te toca mirarlo'), 'var(--orange)'], 'esperando-revision': [t('Arreglado: te toca mirarlo'), 'var(--orange)'],
    reabierto: [t('Lo reabriste: sigue pendiente'), 'var(--red)'], aprobado: [t('Aprobado'), 'var(--green)']
  }
  /** What the Claude said it did, the last time it gave it back to be looked at. */
  const done = (c: Comment) => [...(c.history ?? [])].reverse().find((h) => h.note && (h.status === 'esperando-revision' || h.status === 'corregido'))
  const deliver = (id: number) => api<Instruction>('deliverInstruction', pid, id).then((r) => { ins.reload(); toast(r.status === 'entregada' ? t('Escrito en el Buzón') : r.error ?? t('No se pudo')) }, (e: Error) => toast(e.message))
  const D: Record<string, [string, string]> = {
    guardada: [t('Guardada'), 'var(--label-3)'], 'pendiente-entrega': [t('Pendiente de entrega'), 'var(--orange)'], entregada: [t('En el Buzón'), 'var(--accent)'],
    recibida: [t('Recibida por un agente'), 'var(--teal)'], ejecutada: [t('Hecha'), 'var(--green)'], fallida: [t('Falló la entrega'), 'var(--red)'], anulada: [t('Anulada por ti'), 'var(--gray)']
  }
  return (
    <div className="content-inner max-w-[1200px]">
      <div className="flex flex-wrap items-end gap-3 mb-5">
        <div>
          <h1 className="t-display flex items-center gap-3"><ScreenIcon route="revisiones" />{t('Revisar')}</h1>
          <div className="t-head c2 mt-1.5" style={{ fontWeight: 450 }}>{t('Tus comentarios y qué ha pasado con cada uno.')}</div>
        </div>
        <div className="ml-auto"><Segmented value={tab} onChange={setTab} options={[{ value: 'abiertos', label: t('Abiertos · {length}', { length: open.length }) }, { value: 'instrucciones', label: t('Instrucciones · {length}', { length: (ins.data ?? []).length }) }, { value: 'cerrados', label: t('Aprobados · {length}', { length: closed.length }) }]} /></div>
      </div>
      {/* 12-11: notes reach the Claude through its hooks now, not only through the Buzón; this says what happens to each. */}
      <div className="card-flat px-4 py-3 mb-4 t-small c2 flex items-center gap-3">
        <ShieldCheck size={16} className="c3 flex-none" />
        <span>{Object.values(state?.hooks ?? {}).some(Boolean)
          ? t('Tus comentarios les llegan solos a los Claude de este proyecto: entonces pasan a «Lo tiene un Claude». Cuando uno lo arregla, vuelve aquí como «Arreglado: te toca mirarlo», con lo que cambió, para que digas si está bien.')
          : t('Sin la coordinación activada en ninguna cuenta, tus notas se guardan aquí y puedes copiarlas. Actívala en Ajustes › Cuentas para que les lleguen solas.')}</span>
      </div>
      {tab === 'abiertos' && toLook > 0 && (
        <div className="t-small c2 mb-3">{tn(toLook, 'Hay {n} que un Claude dio por arreglado: lee debajo de tu comentario qué cambió, ábrelo (sale como está ahora) y pulsa «Está bien» o «Sigue mal».', 'Hay {n} que un Claude dio por arreglados: lee debajo de cada comentario qué cambió, ábrelo (sale como está ahora) y pulsa «Está bien» o «Sigue mal».')}</div>
      )}
      {tab !== 'instrucciones' && (
        <div className="flex flex-col gap-2">
          {(tab === 'abiertos' ? open : closed).map((c) => {
            const [label, color] = S[c.status] ?? [c.status, 'var(--label-3)']
            const fix = done(c)
            const by = fix?.note?.match(/^(claude\d+):\s*/)
            return (
              <div key={c.id} className="group p-4 flex gap-4">
                {c.assetId && <button className="tile w-28 aspect-[4/3] flex-none p-0 border-0" onClick={() => setViewer(c.assetId)}><img src={media(`thumb/${c.assetId}?s=300`)} alt="" /></button>}
                <div className="min-w-0 flex-1">
                  <div className="t-small c3"><b style={{ color, fontWeight: 600 }}>{label}</b> · {t('lo escribiste {v0}', { v0: ago(c.createdAt) })}{c.target ? t(' · para {v0}', { v0: accName(c.target) }) : ''}{c.timeSec != null ? t(' · segundo {s}', { s: c.timeSec.toFixed(2) }) : ''}</div>
                  <div className="t-body mt-1 selectable">{c.body}</div>
                  {fix && (
                    <div className="t-small c2 mt-2 rounded-lg px-3 py-2 selectable" style={{ background: 'var(--fill)' }}>
                      <b>{by ? t('Lo que hizo {v0}', { v0: accName(by[1] as AccountId) }) : t('Lo que se hizo')}</b>{t(' ({v0}): ', { v0: ago(fix.at) })}{by ? fix.note!.slice(by[0].length) : fix.note}
                    </div>
                  )}
                  <div className="flex gap-1.5 mt-2">
                    {c.assetId && <button className="btn btn-sm" onClick={() => setViewer(c.assetId)}>{t('Abrir')}</button>}
                    {c.status !== 'aprobado' && <button className="btn btn-sm" onClick={() => api('setCommentStatus', c.id, 'aprobado').then(() => comments.reload())}><Check size={12} /> {ORDER[c.status] === 0 ? t('Está bien') : t('Aprobar')}</button>}
                    {ORDER[c.status] === 0 && <button className="btn btn-sm" onClick={() => api('setCommentStatus', c.id, 'reabierto').then(() => comments.reload())}><RotateCcw size={12} /> {t('Sigue mal')}</button>}
                    {c.status === 'aprobado' && <button className="btn btn-sm" onClick={() => api('setCommentStatus', c.id, 'reabierto').then(() => comments.reload())}><RotateCcw size={12} /> {t('Reabrir')}</button>}
                  </div>
                </div>
              </div>
            )
          })}
          {(tab === 'abiertos' ? open : closed).length === 0 && <Empty title={tab === 'abiertos' ? t('Nada pendiente de revisar') : t('Aún no has aprobado nada')} text={t('Los comentarios se dejan desde el visor de la galería: pulsa sobre la imagen o en el segundo del vídeo.')} />}
        </div>
      )}
      {tab === 'instrucciones' && (
        <div className="group">
          {(ins.data ?? []).map((i) => (
            <div key={i.id} className="flex items-start gap-3 px-3 py-3 rounded-lg hover:bg-[var(--fill)]">
              <span className="pill flex-none mt-0.5" style={{ background: `color-mix(in srgb, ${D[i.status][1]} 15%, transparent)`, color: D[i.status][1] }}>{D[i.status][0]}</span>
              <div className="min-w-0 flex-1">
                <div className="t-body selectable">{i.body}</div>
                <div className="t-small c3 mt-0.5">{i.kind} · {ago(i.createdAt)}{i.target ? t(' · para {v0}', { v0: accName(i.target) }) : ''}{i.channel ? ` · ${i.channel.split(/[\\/]/).pop()}` : ''}{i.error ? ` · ${i.error}` : ''}</div>
              </div>
              <div className="flex gap-1.5 flex-none">
                {(i.status === 'guardada' || i.status === 'fallida') && i.kind !== 'nota' && <button className="btn btn-sm" disabled={!project?.allowBuzon} onClick={() => deliver(i.id)}><Send size={12} /> {t('Al Buzón')}</button>}
                <button className="btn btn-sm" onClick={() => api('copyInstruction', pid, i.id).then(() => toast(t('Copiado')))}><Copy size={12} /></button>
                {i.status !== 'ejecutada' && i.status !== 'guardada' && <button className="btn btn-sm" onClick={() => api('setInstructionStatus', i.id, 'ejecutada').then(() => ins.reload())}><Check size={12} /> {t('Hecha')}</button>}
              </div>
            </div>
          ))}
          {(ins.data ?? []).length === 0 && <Empty title={t('Sin instrucciones')} text={t('Escribe una con «Nueva instrucción» (Ctrl+N) desde cualquier pantalla.')} />}
        </div>
      )}
    </div>
  )
}

// ---- Integración ----------------------------------------------------------------------------------------------------

interface BranchIntegration { label: string; path: string; branch?: string; base: string; ahead: number; behind: number; pending: { hash: string; subject: string; at: number }[]; overlap: string[]; changedHere: number; dirty: number; error?: string }

export function Integration() {
  const { state, now, toast } = useStore()
  const pid = state?.activeProjectId
  const data = useAsync(() => (pid ? api<BranchIntegration[]>('integration', pid) : Promise.resolve([])), [pid, state?.refreshedAt?.git])
  const [open, setOpen] = useState<string>()
  const [asked, setAsked] = useState<string[]>([])
  const s = state?.summary
  if (!s) return null
  const main = s.copies.find((c) => c.label === 'Copia principal')
  const list = data.data ?? []
  // Work kept on its branch by the user's decision, to be reviewed first (12-11, Decidir #116: «cabeza» and «manos»):
  // not offered for joining, or a Claude would bring 642 prefabs Unity rewrote into the main copy.
  const isParked = (b: BranchIntegration) => b.pending.length > 0 && b.pending.every((p) => /para revisarlo/i.test(p.subject))
  const parked = list.filter(isParked)
  const toJoin = list.filter((b) => b.ahead > 0 && !isParked(b))
  const clash = toJoin.filter((b) => b.overlap.length > 0)
  const inUse = (b: BranchIntegration) => Boolean(state?.agents.some((a) => a.sessions.some((x) => (x.pid || x.status === 'busy') && x.cwd.toLowerCase().startsWith(b.path.toLowerCase()))))
  const active = list.filter((b) => !isParked(b) && (b.ahead > 0 || inUse(b)))
  // Files nobody is working on and nobody saved: they may be leftovers or lost work, and only looking at them can tell.
  const loose = list.filter((b) => !active.includes(b) && !isParked(b) && b.dirty > 0)
  const old = list.filter((b) => !b.error && !active.includes(b) && !loose.includes(b) && !isParked(b))
  const light = !data.data ? { color: 'var(--gray)', text: t('Comprobando…'), sub: '' }
    : clash.length ? { color: 'var(--red)', text: t('{v0} trabajo sin unir, y puede chocar', { v0: tn(toJoin.length, '{n} copia tiene', '{n} copias tienen') }), sub: t('Dos copias han tocado los mismos archivos. Mejor que lo una un Claude con cuidado.') }
    : toJoin.length ? { color: 'var(--orange)', text: t('{v0} trabajo sin unir', { v0: tn(toJoin.length, '{n} copia tiene', '{n} copias tienen') }), sub: t('No corre prisa, pero no estará en el juego principal hasta que se una.') }
    : loose.length ? { color: 'var(--orange)', text: t('Lo guardado está todo unido, pero queda algo por mirar'), sub: t('{v0} archivos sin guardar y nadie trabajando ahí: pueden ser restos o trabajo que conviene conservar.', { v0: tn(loose.length, '{n} copia tiene', '{n} copias tienen') }) }
    : { color: 'var(--green)', text: t('Está todo unido: no tienes que hacer nada'), sub: old.length ? t('{v0} ahí, pero su trabajo ya está en la principal.', { v0: tn(old.length, '{n} copia antigua sigue', '{n} copias antiguas siguen') }) : t('Todo el trabajo guardado está en la principal.') }
  const ask = async (id: string, body: string) => {
    if (!pid) return
    try {
      await api('addInstruction', { projectId: pid, kind: 'tarea', body })
      setAsked([...asked, id])
      toast(t('Pedido: lo hará el primer Claude que trabaje'))
    } catch (e) { toast((e as Error).message) }
  }
  const who = (b: BranchIntegration) => (state?.agents ?? []).filter((a) => a.sessions.some((x) => x.cwd.toLowerCase().startsWith(b.path.toLowerCase())))
  const row = (b: BranchIntegration) => {
    const isOpen = open === b.label
    const color = b.error ? 'var(--gray)' : b.ahead && b.overlap.length ? 'var(--red)' : b.ahead || (b.dirty && !inUse(b)) ? 'var(--orange)' : 'var(--green)'
    const say = b.error ? t('No se ha podido leer') : b.ahead ? t('Tiene {v0} que la principal aún no tiene', { v0: tn(b.ahead, '{n} cambio', '{n} cambios') }) : t('Lo guardado ya está en la principal')
    const people = who(b)
    return (
      <div key={b.label}>
        <button className="row" onClick={() => setOpen(isOpen ? undefined : b.label)} aria-expanded={isOpen}>
          <span className="icon-sq icon-sq-lg" style={{ background: color }}><GitBranch size={16} /></span>
          <span className="min-w-0 flex-1">
            <span className="t-body block" style={{ fontWeight: 560 }}>{b.branch ?? b.label}</span>
            <span className="t-small block truncate" style={{ color }}>{say}{b.dirty ? <span className="c3"> {t('· {v0} sin guardar', { v0: tn(b.dirty, '{n} archivo', '{n} archivos') })}</span> : null}</span>
          </span>
          {people.map((a) => <span key={a.id} className="flex items-center gap-1.5 t-small c2 flex-none"><Avatar id={a.id} size={22} /> {accName(a.id)}</span>)}
          <ChevronRight size={16} className="c4 flex-none" style={{ transform: isOpen ? 'rotate(90deg)' : undefined, transition: 'transform 200ms' }} />
        </button>
        {isOpen && (
          <div className="px-[58px] pb-4 flex flex-col gap-3">
            <div className="t-small c3 selectable">{b.path}</div>
            {b.pending.length > 0 && (
              <div>
                <div className="t-micro c3 mb-1.5">{t('Lo que hay aquí y no en la principal')}</div>
                {b.pending.slice(0, 12).map((c) => <div key={c.hash} className="t-small flex gap-3 py-0.5"><span className="c3 w-20 flex-none">{ago(c.at, now)}</span><span className="clamp-2">{c.subject}</span></div>)}
                {b.pending.length > 12 && <div className="t-small c3">{t('y {v0} más', { v0: b.pending.length - 12 })}</div>}
              </div>
            )}
            {b.overlap.length > 0 && (
              <div>
                <div className="t-micro mb-1.5" style={{ color: 'var(--red)' }}>{t('Archivos tocados en las dos · {length}', { length: b.overlap.length })}</div>
                <div className="t-small c2 selectable">{b.overlap.slice(0, 15).map((f) => <div key={f} className="truncate">{f}</div>)}</div>
                {b.overlap.length > 15 && <div className="t-small c3">{t('y {v0} más', { v0: b.overlap.length - 15 })}</div>}
              </div>
            )}
            {b.behind > 0 && <div className="t-small c3">{t('La principal va {v0} por delante de esta copia.', { v0: tn(b.behind, '{n} cambio', '{n} cambios') })}</div>}
            <div className="flex gap-2 flex-wrap">
              {b.ahead > 0 && <button className="btn btn-sm btn-primary" disabled={asked.includes(b.label)} onClick={() => void ask(b.label, t('Une la rama {branch} (copia {path}) en la principal {base}: tiene {ahead} cambios sin unir{v0}. Comprueba que compila y pasa las pruebas antes de darlo por hecho.', { branch: b.branch, path: b.path, base: b.base, ahead: b.ahead, v0: b.overlap.length ? t(' y {length} archivos tocados en las dos, revísalos', { length: b.overlap.length }) : '' }))}><Send size={12} /> {asked.includes(b.label) ? t('Pedido') : t('Pedir a Claude que la una')}</button>}
              <button className="btn btn-sm" onClick={() => api('openPath', b.path)}><FolderOpen size={12} /> {t('Abrir carpeta')}</button>
            </div>
          </div>
        )}
      </div>
    )
  }
  return (
    <div className="content-inner max-w-[1180px]">
      <h1 className="t-display flex items-center gap-3"><ScreenIcon route="integracion" />{t('Ramas')}</h1>
      <div className="t-head c2 mt-1.5 mb-5" style={{ fontWeight: 450 }}>{t('Una rama es una copia del proyecto donde un Claude trabaja sin pisar a los demás. Cuando acaba, lo suyo se une a la principal')}{main?.branch ? <> (<b>{main.branch}</b>)</> : null}{t(': lo que ves y lo que se compila.')}</div>

      <div className="card p-5 mb-8 flex items-start gap-3" style={{ boxShadow: `inset 3px 0 0 ${light.color}` }}>
        <span className="dot mt-2 flex-none" style={{ background: light.color, width: 12, height: 12 }} />
        <div className="min-w-0 flex-1">
          <div className="t-title">{light.text}</div>
          {light.sub && <div className="t-body c2 mt-1">{light.sub}</div>}
        </div>
        {toJoin.length > 1 && <button className="btn btn-sm btn-primary flex-none" disabled={asked.includes('todas')} onClick={() => void ask('todas', t('Une en la principal {base} las ramas con trabajo sin unir: {v0}. Una a una, comprobando que compila y pasa las pruebas.', { base: toJoin[0].base, v0: toJoin.map((b) => t('{branch} ({ahead} cambios)', { branch: b.branch, ahead: b.ahead })).join(', ') }))}><Send size={12} /> {asked.includes('todas') ? t('Pedido') : t('Pedir que las una todas')}</button>}
      </div>

      {main && (
        <>
          <h2 className="section-title">{t('La principal')}</h2>
          <div className="group mb-9">
            <div className="row">
              <span className="icon-sq icon-sq-lg" style={{ background: 'var(--blue)' }}><GitBranch size={16} /></span>
              <span className="min-w-0 flex-1">
                <span className="t-body block" style={{ fontWeight: 560 }}>{main.branch}</span>
                <span className="t-small c3 block truncate">{t('Lo último: {headSubject}', { headSubject: main.headSubject })}</span>
              </span>
              <span className="t-small c3 text-right flex-none">{main.headAt ? ago(main.headAt, now) : ''}</span>
            </div>
          </div>
        </>
      )}

      {!data.data && <div className="group mb-9"><div className="row"><div className="skeleton h-4 w-1/2 rounded" /></div></div>}
      {active.length > 0 && (
        <>
          <h2 className="section-title">{t('En uso o por unir')}</h2>
          <div className="group mb-9">{active.map(row)}</div>
        </>
      )}
      {parked.length > 0 && (
        <>
          <h2 className="section-title">{t('Guardadas para revisar')} <span className="t-small c3" style={{ fontWeight: 450 }}>{t('· trabajo viejo que se guardó por decisión tuya; un Claude lo revisa antes de unir nada')}</span></h2>
          <div className="group mb-9">{parked.map(row)}</div>
        </>
      )}
      {loose.length > 0 && (
        <>
          <div className="flex items-center gap-3 flex-wrap mb-2">
            <h2 className="section-title m-0">{t('Con archivos sin guardar')}</h2>
            <button className="btn btn-sm ml-auto" disabled={asked.includes('mirar')} onClick={() => void ask('mirar', t('Mira los archivos sin guardar de estas copias, donde no trabaja nadie: {v0}. Di cuáles son generados y se pueden descartar, y cuáles son trabajo que hay que conservar. No descartes ni borres nada sin preguntar.', { v0: loose.map((b) => t('{branch} ({path}, {dirty} archivos)', { branch: b.branch, path: b.path, dirty: b.dirty })).join(', ') }))}><Send size={12} /> {asked.includes('mirar') ? t('Pedido') : t('Pedir a Claude que lo mire')}</button>
          </div>
          <div className="t-small c3 mb-2">{t('Nadie trabaja ahí ahora. No los borres a ciegas: pueden ser restos de una compilación o trabajo que no llegó a guardarse.')}</div>
          <div className="group mb-9">{loose.map(row)}</div>
        </>
      )}
      {old.length > 0 && (
        <>
          <div className="flex items-center gap-3 flex-wrap mb-2">
            <h2 className="section-title m-0">{t('Copias antiguas, ya incluidas')}</h2>
            <button className="btn btn-sm ml-auto" disabled={asked.includes('limpiar')} onClick={() => void ask('limpiar', t('Limpia las copias antiguas ya incluidas en la principal: {v0}. Comprueba antes que siguen sin cambios propios y sin archivos sin guardar; quita solo la copia de trabajo y su rama.', { v0: old.map((b) => `${b.branch} (${b.path})`).join(', ') }))}><Trash2 size={12} /> {asked.includes('limpiar') ? t('Pedido') : t('Pedir a Claude que las limpie')}</button>
          </div>
          <div className="t-small c3 mb-2">{t('No hay nada que unir: lo suyo ya está en la principal. Solo ocupan sitio; quitarlas es opcional.')}</div>
          <div className="group mb-9">{old.map(row)}</div>
        </>
      )}
      <div className="t-small c3 px-1">{t('Mission Control solo mira: no une, no cambia de rama y no borra nada. Eso lo hace un Claude cuando se lo pides{v0}.', { v0: toJoin.length ? t(' con los botones de arriba') : t(' (cuando haya algo que unir, saldrá aquí arriba con su botón)') })}</div>
    </div>
  )
}

// ---- Memoria --------------------------------------------------------------------------------------------------------

export function Memory() {
  const { state, now, toast } = useStore()
  const pid = state?.activeProjectId
  const load = useAsync(() => (pid ? api<{ items: { what: string; file?: string; chars: number; tokens: number; note?: string }[]; tokens: number }>('startLoad', pid) : Promise.resolve(undefined)), [pid])
  const mem = useAsync(() => (pid ? api<{ files: { name: string; description: string; file: string; mtime: number }[]; dir?: string; docs: { name: string; file: string; mtime: number; size: number }[] }>('memory', pid) : Promise.resolve(undefined)), [pid])
  const s = state?.summary
  return (
    <div className="content-inner max-w-[1400px]">
      <h1 className="t-display flex items-center gap-3"><ScreenIcon route="memoria" />{t('Memoria')}</h1>
      <div className="t-head c2 mt-1.5 mb-7" style={{ fontWeight: 450 }}>{t('Lo que saben todas las cuentas de este proyecto: lo que no deben olvidar, lo que leen al empezar, los relevos y los documentos.')}</div>
      <MemoryBox />
      <RequestsBox />
      {load.data && load.data.items.length > 0 && (
        <section className="mb-7">
          <SectionTitle title={t('Lo que lee cada sesión al empezar')} sub={t('unos {v0} tokens antes de hacer nada, en cada ventana y tras cada compactación', { v0: load.data.tokens.toLocaleString('es-ES') })} />
          <div className="group p-4 flex flex-col gap-2">
            {load.data.items.map((x) => {
              const max = Math.max(...load.data!.items.map((y) => y.tokens))
              return (
                <div key={x.what} className="flex items-center gap-3 t-small">
                  <span className="c2 flex-none" style={{ width: 300 }}>{x.what}</span>
                  <span className="flex-1 rounded-full" style={{ height: 6, background: 'var(--fill)' }}><span className="block rounded-full h-full" style={{ width: `${Math.max(2, (x.tokens / max) * 100)}%`, background: x.tokens > 4000 ? 'var(--orange)' : 'var(--indigo)' }} /></span>
                  <span className="c3 num flex-none" style={{ width: 170, textAlign: 'right' }}>{t('{v0} tokens{v1}', { v0: x.tokens.toLocaleString('es-ES'), v1: x.note ? ` · ${x.note}` : '' })}</span>
                  {x.file && x.note?.includes(t('se lee dos veces')) && pid && (
                    <button className="btn btn-sm flex-none" title={t('Las sesiones de esta copia dejan de leer este CLAUDE.md (tiene el mismo texto que el suyo). Se guarda en su .claude/settings.local.json, con copia previa')}
                      onClick={() => void api('excludeTwin', pid, x.file).then(() => { toast(t('Ya no se lee dos veces: vale para las ventanas que se abran a partir de ahora')); load.reload() }, (e) => toast((e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')))}>{t('No leerlo dos veces')}</button>
                  )}
                  {x.file && <button className="btn btn-sm btn-ghost flex-none" onClick={() => void api('openPath', x.file)}>{t('Abrir')}</button>}
                </div>
              )
            })}
            <div className="t-small c3">{t('Lo que pasa de 4.000 tokens sale en naranja: cuanto más corto, menos gasta cada sesión al empezar. Lo largo y de consulta va mejor en `docs/` (se lee solo cuando hace falta) que en un CLAUDE.md.')}</div>
          </div>
        </section>
      )}
      <div className="grid gap-6 grid-cols-1 min-[1200px]:grid-cols-2">
        <section>
          <SectionTitle title={t('Relevos')} sub={s?.relevoSource ? t('Actualizado {v0}', { v0: ago(s.relevoSource.mtime, now) }) : t('Sin nota de relevo')} />
          {state?.enCurso && <div className="card-flat p-4 mb-3"><div className="t-micro c3 mb-1">{t('En curso')}</div><div className="t-small c2 selectable">{state.enCurso}</div></div>}
          <div className="group">
            {(s?.heartbeats ?? []).map((h, i) => (
              <div key={i} className="flex gap-3 px-3 py-3">
                {h.account ? <Avatar id={h.account} size={24} /> : <div className="w-6" />}
                <div className="min-w-0">
                  <div className="t-small c3">{dateShort(h.at)} {clock(h.at)} · {h.file.split(/[\\/]/).slice(-3, -2)[0]}</div>
                  <div className="t-small c2 clamp-3 selectable">{h.text}</div>
                </div>
              </div>
            ))}
          </div>
        </section>
        <section>
          <SectionTitle title={t('Lo que recuerdan')} sub={mem.data?.files.length ? t('{length} memorias compartidas', { length: mem.data.files.length }) : t('Sin memorias para este proyecto')} />
          <div className="group mb-6">
            {(mem.data?.files ?? []).map((f) => (
              <button key={f.file} className="w-full text-left flex gap-3 px-3 py-2.5 rounded-lg border-0 bg-transparent hover:bg-[var(--fill)]" onClick={() => api('openPath', f.file)}>
                <FileText size={14} className="c3 mt-0.5 flex-none" />
                <div className="min-w-0"><div className="t-small" style={{ fontWeight: 580 }}>{f.name}</div><div className="t-small c3 clamp-2">{f.description}</div></div>
              </button>
            ))}
            {mem.data && !mem.data.files.length && <Empty title={t('Sin memorias')} text={t('Los Claude guardan aquí lo que aprenden de ti y del proyecto mientras trabajan. Para que no olviden algo desde ya, escríbelo arriba en «Lo que no deben olvidar».')} />}
          </div>
          <SectionTitle title={t('Documentos del proyecto')} sub={t('docs\\ de la copia principal')} />
          <div className="group">
            {(mem.data?.docs ?? []).map((d) => (
              <button key={d.file} className="w-full text-left flex items-center gap-3 px-3 py-2 rounded-lg border-0 bg-transparent hover:bg-[var(--fill)] t-small" onClick={() => api('openPath', d.file)}>
                <FileText size={14} className="c3 flex-none" /><span className="flex-1 truncate">{d.name}</span><span className="c3">{ago(d.mtime, now)}</span>
              </button>
            ))}
          </div>
        </section>
      </div>
    </div>
  )
}

// ---- Ajustes ------------------------------------------------------------------------------------------------------

const COLORS = ['#FF9F0A', '#0A84FF', '#BF5AF2', '#30D158', '#FF375F', '#64D2FF', '#FFD60A', '#AC8E68', '#5E5CE6', '#FF6B8B']

/** Ajustes › Cuentas: add an account (its own folder; the login is done once in a terminal) or take one out. */
interface HealthCheck { name: string; ok: boolean; detail: string; fix?: string; needed: boolean; install?: 'claude' | 'git' | 'node' }

/** What this PC needs and whether the data of each account arrives: each line says what it is and what to do. */
function HealthSection() {
  const { toast } = useStore()
  const [n, setN] = useState(0)
  // After «Instalar», looked at again every 20 s for three minutes: the installer takes its time.
  const install = (c: HealthCheck) => void api('installTool', c.install).then(() => {
    toast(t('Se ha abierto el instalador de {v0}: cuando acabe, aparecerá en verde', { v0: c.name }))
    let k = 0
    const timer = setInterval(() => { setN((x) => x + 1); if (++k >= 9) clearInterval(timer) }, 20_000)
  })
  const h = useAsync(() => api<{ tools: HealthCheck[]; readings: HealthCheck[] }>('health', n > 0), [n])
  const row = (c: HealthCheck) => (
    <div key={c.name} className="row">
      <span className="rounded-full flex-none" style={{ width: 10, height: 10, background: c.ok ? 'var(--green)' : c.needed ? 'var(--red)' : 'var(--orange)' }} />
      <div className="min-w-0 flex-1">
        <div className="t-body" style={{ fontWeight: 580 }}>{c.name} <span className="c3 t-small" style={{ fontWeight: 450 }}>· {c.detail}</span></div>
        {!c.ok && c.fix && <div className="t-small" style={{ color: c.needed ? 'var(--red)' : 'var(--orange)' }}>{c.fix}</div>}
      </div>
      {!c.ok && c.install && <button className="btn btn-sm btn-primary flex-none" onClick={() => install(c)}>{t('Instalar')}</button>}
    </div>
  )
  return (
    <section className="mb-8">
      <SectionTitle title={t('Comprobación')} sub={t('Lo que Mission Control necesita en este PC y si le llegan los datos de cada cuenta')} right={<button className="btn btn-sm" onClick={() => setN(n + 1)}>{t('Comprobar ahora')}</button>} />
      <div className="group">
        {h.data ? [...h.data.tools, ...h.data.readings].map(row) : <div className="row t-small c3">{t('Comprobando…')}</div>}
      </div>
    </section>
  )
}

function AccountsSection() {
  const { state, toast, refresh } = useStore()
  const [adding, setAdding] = useState(false)
  const [alias, setAlias] = useState('')
  const [dir, setDir] = useState('')
  const [email, setEmail] = useState('')
  const [color, setColor] = useState(COLORS[4])
  const [busy, setBusy] = useState(false)
  const found = useAsync(() => api<{ id?: string; alias: string; configDir: string; email?: string }[]>('detectAccounts'), [state?.accounts?.length])
  if (!state) return null
  const project = state.projects.find((p) => p.id === state.activeProjectId)
  const add = async () => {
    setBusy(true)
    try {
      const acc = await api<any>('addAccount', { alias, configDir: dir || undefined, emailExpected: email || undefined, color })
      toast(t('Añadida {v0}. Ábrela y escribe /login para entrar con su cuenta', { v0: accName(acc.id) }))
      setAdding(false); setAlias(''); setDir(''); setEmail('')
      await refresh()
    } catch (e) { toast((e as Error).message) } finally { setBusy(false) }
  }
  return (
    <section className="mb-8">
      <SectionTitle title={t('Cuentas')} sub={t('Las cuentas de Claude que Mission Control sigue y coordina')} right={!adding && <button className="btn btn-sm btn-primary" onClick={() => setAdding(true)}><UserPlus size={13} /> {t('Añadir cuenta')}</button>} />
      <div className="t-small c3 mb-3">{t('Cómo trabajan los Claude, quién releva a quién y el nombre de cada cuenta se eligen en')} <b>{t('Relevos')}</b>.</div>
      <div className="group">
        {(state.accounts ?? []).map((a) => {
          const card = state.agents.find((x) => x.id === a.id)
          return (
            <div key={a.id} className="row">
              <Avatar id={a.id} size={30} />
              <div className="min-w-0 flex-1">
                <div className="t-body" style={{ fontWeight: 580 }}>{accName(a.id)} <span className="c3 t-small" style={{ fontWeight: 450 }}>· {a.alias}{ACCOUNT_NAME[a.id] ? ` · Claude ${a.id.slice(6)}` : ''}</span></div>
                <div className="t-small c3 truncate">{card?.identity.email ?? (card?.identity.hasLogin ? t('con sesión') : t('sin sesión iniciada'))} · {a.configDir || t('~\\.claude (la de siempre)')}</div>
              </div>
              {card?.state === 'sin-uso' && <Recharge a={card} recharged={state.settings?.recharged} onDone={(msg) => { toast(msg); void refresh() }} />}
              <Segmented value={(state.settings?.accountStatus?.[a.id] ?? 'uso') as 'uso' | 'pausada' | 'baja'}
                onChange={(v) => void api('setSettings', { accountStatus: { ...(state.settings?.accountStatus ?? {}), [a.id]: v === 'uso' ? undefined : v } }).then(() => refresh())}
                options={[{ value: 'uso', label: t('En uso') }, { value: 'pausada', label: t('No usar') }, { value: 'baja', label: t('De baja') }]} />
              <label className="flex items-center gap-1 t-small c3" title={t('Claude Code no dice cuánto queda de cada modelo: desmárcalo cuando esta cuenta agote Fable')}>
                <input type="checkbox" checked={!(state.settings?.noFable ?? []).includes(a.id)} onChange={(e) => { const cur: string[] = state.settings?.noFable ?? []; void api('setSettings', { noFable: e.target.checked ? cur.filter((x) => x !== a.id) : [...cur, a.id] }).then(() => refresh()) }} /> {t('Fable')}
              </label>
              {project && <button className="btn btn-sm" title={t('Abre una terminal con esta cuenta (para /login la primera vez)')} onClick={() => api('openSession', a.id, project.root).then(() => toast(t('Abierta {v0}', { v0: accName(a.id) })), (e) => toast((e as Error).message))}><Terminal size={13} /> {t('Abrir')}</button>}
              <button className="btn btn-sm btn-ghost" style={{ color: 'var(--red)' }} title={t('Quitarla de Mission Control')} onClick={async () => {
                if (!window.confirm(t('¿Quitar {v0} ({alias}) de Mission Control?\n\nSu carpeta, su sesión y sus conversaciones se quedan donde están. Se quitan de su settings.json la línea de estado y los hooks de Mission Control (con copia).', { v0: accName(a.id), alias: a.alias }))) return
                try { await api('removeAccount', a.id, true); toast(t('{v0} quitada', { v0: accName(a.id) })); await refresh() } catch (e) { toast((e as Error).message) }
              }}><Trash2 size={13} /></button>
            </div>
          )
        })}
        {(found.data ?? []).map((f) => (
          <div key={f.configDir} className="row">
            <span className="flex items-center justify-center rounded-full shrink-0" style={{ width: 30, height: 30, background: 'color-mix(in srgb, var(--indigo) 16%, transparent)', color: 'var(--indigo)' }}><UserPlus size={15} /></span>
            <div className="min-w-0 flex-1">
              <div className="t-body" style={{ fontWeight: 580 }}>{f.id ? `${accName(f.id)}` : t('Otra cuenta')} <span className="c3 t-small" style={{ fontWeight: 450 }}>{t('· {alias} · ya iniciada en este PC', { alias: f.alias })}</span></div>
              <div className="t-small c3 truncate">{f.email ?? t('con sesión')} · {f.configDir}</div>
            </div>
            <button
              className="btn btn-sm btn-primary"
              disabled={busy}
              onClick={async () => {
                setBusy(true)
                try {
                  const acc = await api<any>('addAccount', { id: f.id, alias: f.alias, configDir: f.configDir, emailExpected: f.email })
                  toast(t('Añadida {v0}: ya tenía su sesión iniciada', { v0: accName(acc.id) }))
                  await refresh()
                } catch (e) { toast((e as Error).message) } finally { setBusy(false) }
              }}
            ><Plus size={13} /> {t('Añadir')}</button>
          </div>
        ))}
        {adding && (
          <div className="p-4 flex flex-col gap-3" style={{ borderTop: '0.5px solid var(--sep)' }}>
            <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
              <label className="flex flex-col gap-1"><span className="t-micro c3">{t('Nombre')}</span><input className="field" autoFocus placeholder={t('p. ej. Quinta')} value={alias} onChange={(e) => setAlias(e.target.value)} /></label>
              <label className="flex flex-col gap-1"><span className="t-micro c3">{t('Correo de la cuenta (opcional)')}</span><input className="field" placeholder={t('para avisar si la carpeta tiene otra')} value={email} onChange={(e) => setEmail(e.target.value)} /></label>
            </div>
            <div className="flex flex-col gap-1">
              <span className="t-micro c3">{t('Carpeta de configuración')}</span>
              <div className="flex gap-2">
                <input className="field flex-1" placeholder={t('Vacía: se crea ~\\.claude-{v0}', { v0: alias.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-') || t('nombre') })} value={dir} onChange={(e) => setDir(e.target.value)} />
                <button className="btn btn-sm" style={{ height: 32 }} onClick={() => api<string | undefined>('chooseFolder', t('Carpeta de la cuenta')).then((f) => f && setDir(f))}><FolderOpen size={13} /> {t('Elegir')}</button>
              </div>
              <span className="t-small c3">{t('Cada cuenta necesita su propia carpeta: ahí guarda su sesión. La primera vez, ábrela y escribe /login.')}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="t-micro c3 mr-2">{t('Color')}</span>
              {COLORS.map((c) => <button key={c} className="w-6 h-6 rounded-full border-0" style={{ background: c, boxShadow: color === c ? '0 0 0 2px var(--bg-elev), 0 0 0 4px ' + c : undefined }} onClick={() => setColor(c)} aria-label={c} />)}
            </div>
            <div className="flex gap-2">
              <button className="btn btn-primary btn-sm" disabled={busy || !alias.trim()} onClick={() => void add()}><Plus size={13} /> {t('Añadir')}</button>
              <button className="btn btn-sm" onClick={() => setAdding(false)}>{t('Cancelar')}</button>
            </div>
          </div>
        )}
      </div>
    </section>
  )
}

/**
 * The size of the whole app (13-11, the user: «la interfaz es muy pequeña y difícil de leer»): five sizes in sight, the
 * one in use marked; Ctrl + / Ctrl − / Ctrl 0 do the same from anywhere.
 */
const SIZES: { v: number; label: string }[] = [{ v: 1, get label() { return t('Pequeña') } }, { v: 1.1, get label() { return t('Normal') } }, { v: 1.25, get label() { return t('Grande') } }, { v: 1.4, get label() { return t('Muy grande') } }, { v: 1.6, get label() { return t('Enorme') } }]
function TextSize() {
  const { state, toast } = useStore()
  const cur = useAsync(() => api<number>('uiScale'), [state?.settings.uiScale])
  const on = cur.data ?? state?.settings.uiScale ?? 1.1
  const pick = (v: number) => void api('setSettings', { uiScale: v }).then(() => { cur.reload(); toast(t('Letra: {v0} ({v1} %)', { v0: SIZES.find((s) => s.v === v)?.label.toLowerCase(), v1: Math.round(v * 100) })) })
  return (
    <div className="group p-5 mb-3 flex flex-col gap-3">
      <div className="flex items-baseline gap-3 flex-wrap"><span className="t-head">{t('Tamaño de la letra')}</span><span className="t-small c3">{t('Todo crece a la vez: texto, botones y fotos. Desde cualquier pantalla:')} <span className="kbd">{t('Ctrl +')}</span> <span className="kbd">{t('Ctrl −')}</span> {t('y')} <span className="kbd">{t('Ctrl 0')}</span> {t('para volver al de serie.')}</span></div>
      <div className="flex gap-2 flex-wrap" role="radiogroup" aria-label={t('Tamaño de la letra')}>
        {SIZES.map((s) => {
          const sel = Math.abs(on - s.v) < 0.01
          return (
            <button key={s.v} role="radio" aria-checked={sel} onClick={() => pick(s.v)} className="flex flex-col items-center justify-center gap-1 rounded-xl border-0 px-4 py-2.5"
              style={{ minWidth: 104, background: sel ? 'var(--accent)' : 'var(--fill)', color: sel ? 'white' : 'var(--label)', boxShadow: sel ? '0 4px 14px color-mix(in srgb, var(--accent) 35%, transparent)' : undefined }}>
              <span style={{ fontSize: Math.round(13 * s.v), fontWeight: 700, lineHeight: 1 }}>{t('Aa')}</span>
              <span className="t-small" style={{ fontWeight: 600 }}>{s.label}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

/**
 * EV96: Claude Code's gifted resets (`/limit-reset`, once a week at the 5-hour wall). The app finds them in each window at
 * its limit and, as the user chose (Decidir #130 «B»), uses them alone at the best moment.
 */
type RechargeView = Record<string, { record?: { available: boolean; kinds?: string[]; left?: number; useBy?: string; seenAt: number; usedAt?: number; noneAt?: number }; decision: { action: string; why: string } }>
function RechargeSettings() {
  const { state, toast, now } = useStore()
  const v = useAsync(() => api<RechargeView>('recharges'), [state?.refreshedAt?.agents, Math.floor(now / 60_000)])
  if (!state) return null
  const mode = state.settings.smartRecharge ?? 'sola'
  // The ones set aside too (the user, 13-11: «no está mal que la app revise los inactivos y también te lo diga»): only told.
  const agents = state.agents.filter((a) => a.state !== 'baja')
  return (
    <section className="mb-8" id="recargas">
      <SectionTitle title={t('Recargas regaladas')} sub={t('La recarga de 5 horas que Claude Code da a algunas cuentas una vez por semana (/limit-reset). La app la encuentra sola en la ventana de la cuenta cuando llega a su límite')} />
      <div className="group p-5 flex flex-col gap-4">
        <div className="flex items-center gap-4 flex-wrap"><span className="w-44 c2">{t('Qué hace la app')}</span>
          <Segmented value={mode} onChange={(x) => void api('setSettings', { smartRecharge: x }).then(() => toast(x === 'sola' ? t('La usará sola en el mejor momento') : x === 'avisar' ? t('Te avisará en el mejor momento') : t('No tocará las recargas')))}
            options={[{ value: 'sola', label: t('Usarla sola en el mejor momento') }, { value: 'avisar', label: t('Avisarme') }, { value: 'no', label: t('No tocarlas') }]} />
        </div>
        <div className="t-small c3 leading-relaxed">{t('El mejor momento: la cuenta está parada por su límite de 5 horas, queda trabajo, ninguna otra de su rueda puede seguir y le faltan más de 45 min para volver sola (si caduca antes de la próxima ocasión, se usa igual). Y solo si merece la pena según la previsión de la rueda (el ritmo real de cada cuenta): si las demás tienen horas de trabajo hasta que esta vuelva sola, o lo que queda de la agenda cabe en ellas, se guarda. Nunca compra nada: solo confirma una pantalla que hable de la recarga; si habla de créditos o de pago, no la toca y lo apunta.')}</div>
        <div className="flex flex-col gap-2">
          {agents.map((a) => {
            const x = v.data?.[a.id]
            const r = x?.record
            const line = !r ? t('Aún no se sabe: se mira en su ventana la próxima vez que llegue a su límite')
              : r.available ? t('Tiene recarga{kinds}{left}{until}', { kinds: r.kinds?.length ? ` (${r.kinds.join(', ')})` : t(' de 5 horas'), left: r.left != null ? tn(r.left, ' · queda {n}', ' · quedan {n}') : '', until: r.useBy ? t(' · hasta {v0}', { v0: r.useBy }) : '' })
              : r.usedAt ? t('Usada {v0}', { v0: ago(r.usedAt, now) }) : t('Sin recarga disponible ahora')
            const can = r?.available && a.state === 'sin-uso'
            return (
              <div key={a.id} className="flex items-center gap-3 px-3.5 py-2.5 rounded-xl" style={{ background: 'var(--bg-elev-2)' }}>
                <Avatar id={a.id} size={28} />
                <div className="min-w-0 flex-1">
                  <div className="t-body" style={{ fontWeight: 600 }}>{accName(a.id)} <span className="t-small c3" style={{ fontWeight: 450 }}>· {line}{a.state === 'apartada' ? t(' · apartada: solo se informa, nunca se usa') : ''}</span></div>
                  {r?.available && x?.decision && <div className="t-small" style={{ color: x.decision.action === 'usar' ? 'var(--green)' : 'var(--label-3)' }}>{x.decision.action === 'usar' ? t('Es el momento: se usa ya') : t('Ahora no: {why}', { why: x.decision.why })}</div>}
                </div>
                {a.state === 'sin-uso' ? <button className="btn btn-sm" title={t('Lee su ventana por si Claude Code ofrece una recarga')} onClick={() => void api('lookRecharge', a.id).then((o: any) => { v.reload(); toast(o ? o.available ? t('Tiene una recarga a mano') : t('Claude Code dice que no tiene') : t('Su ventana no dice nada de recargas')) })}>{t('Mirar su ventana')}</button>
                  : a.state !== 'trabajando' && <button className="btn btn-sm" title={t('Escribe /limit-reset en su ventana parada, lee qué recargas tiene y sale con Esc: no usa ninguna')} onClick={() => void api<string>('probeRecharge', a.id).then((msg) => { v.reload(); toast(`: ${msg}`) })}>{t('Revisar sin usar')}</button>}
                {can && <button className="btn btn-sm btn-primary" title={t('Escribe /limit-reset en su ventana y confirma la recarga')} onClick={() => void api<string>('useRecharge', a.id).then((msg) => { v.reload(); toast(msg === 'hecho' ? t('{v0} recargada: sigue trabajando', { v0: accName(a.id) }) : t('No se ha usado: {msg}', { msg: msg })) })}>{t('Usarla ya')}</button>}
              </div>
            )
          })}
        </div>
      </div>
    </section>
  )
}

/**
 * EV169: the user, 14-11: «añade a la app una opción para borrar proyectos». Mission Control forgets the project (with a
 * copy of its data first); the folder stays, or goes to the bin, from where it can still be brought back.
 */
function RemoveProject({ id, name, root }: { id: string; name: string; root: string }) {
  const { refresh, toast } = useStore()
  const [busy, setBusy] = useState(false)
  const remove = async (toBin: boolean) => {
    const ask = toBin
      ? t('¿Borrar «{name}»?\n\nMission Control olvida sus tareas, su historia, su galería y sus ajustes (antes hace una copia de sus datos), y la carpeta {root} va a la papelera, de donde aún se puede recuperar.', { name, root })
      : t('¿Quitar «{name}» de Mission Control?\n\nOlvida sus tareas, su historia, su galería y sus ajustes (antes hace una copia de sus datos). La carpeta {root} se queda donde está.', { name, root })
    if (!window.confirm(ask)) return
    setBusy(true)
    try {
      const r = await api<{ binned: boolean; error?: string }>('removeProject', id, toBin)
      await refresh()
      toast(!toBin ? t('{name} quitado de Mission Control: la carpeta sigue en su sitio', { name }) : r.binned ? t('{name} borrado: la carpeta está en la papelera', { name }) : t('{name} quitado de Mission Control, pero la carpeta no se pudo mandar a la papelera: {error}', { name, error: r.error ?? '' }))
    } catch (e) {
      toast((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <div>
      <div className="t-micro c3 mb-1">{t('Borrar proyecto')}</div>
      <div className="t-small c3 mb-2">{t('Mission Control olvida sus tareas, su historia, su galería y sus ajustes. Antes hace una copia de sus datos, que se recupera en Ajustes › Copias. Las cuentas que trabajen en él no se cierran solas.')}</div>
      <div className="flex gap-2 flex-wrap">
        <button className="btn btn-sm" style={{ color: 'var(--red)' }} disabled={busy} onClick={() => void remove(false)}><Trash2 size={13} /> {t('Quitar de Mission Control')}</button>
        <button className="btn btn-sm" style={{ color: 'var(--red)' }} disabled={busy} title={t('La carpeta va a la papelera: se puede recuperar desde allí')} onClick={() => void remove(true)}><Trash2 size={13} /> {t('Quitar y mandar la carpeta a la papelera')}</button>
      </div>
    </div>
  )
}

/**
 * EV100: what takes space in the project, in three piles (core/cleanup.ts). For now it only measures and shows; setting
 * aside and deleting come next, and only with the user's switch.
 */
function CleanupSection({ pid }: { pid: string }) {
  const { state, toast } = useStore()
  const [tick, setTick] = useState(0)
  const v = useAsync(() => api<any>('cleanupView', pid), [pid, tick, state?.now])
  const smart = Boolean(state?.settings.smartClean?.[pid])
  useEffect(() => { if (!v.data?.running) return; const t = setInterval(() => setTick((x) => x + 1), 3000); return () => clearInterval(t) }, [v.data?.running])
  const size = (b: number) => (b >= 1 << 30 ? `${(b / (1 << 30)).toFixed(1).replace('.', ',')} GB` : `${Math.round(b / (1 << 20))} MB`)
  const pile = { sobra: { label: t('Sobra seguro'), color: 'var(--green)', hint: t('se vuelve a generar sola: se podrá borrar del todo') }, dudoso: { label: t('Dudoso'), color: 'var(--orange)', hint: t('se apartará (sin borrar) y se vigilará') }, queda: { label: t('Se queda'), color: 'var(--label-3)', hint: t('se usa, es reciente o tiene nota tuya') } } as const
  const items = (v.data?.items ?? []) as { path: string; rel: string; copy: string; size: number; pile: keyof typeof pile; why: string }[]
  return (
    <section className="mb-8" id="limpieza">
      <SectionTitle title={t('Limpieza')} sub={t('Lo que ocupa el proyecto y sus copias, en tres montones. Nada se borra a ciegas: lo que sobra va a la papelera y lo dudoso se aparta, con vuelta atrás')} right={<button className="btn btn-sm" disabled={v.data?.running} onClick={() => void api('cleanupStart', pid).then(() => setTick((x) => x + 1))}>{v.data?.running ? t('Midiendo… ({n} archivos)', { n: v.data.scanned }) : t('Medir ahora')}</button>} />
      <div className="group p-5 flex flex-col gap-4">
        {(!v.data || v.data.never) && <div className="t-small c3">{t('Aún sin medir. Tarda unos minutos en los proyectos grandes y no frena la app.')}</div>}
        {v.data && !v.data.never && (
          <div className="flex gap-3 flex-wrap">
            {(Object.keys(pile) as (keyof typeof pile)[]).map((k) => (
              <div key={k} className="rounded-xl px-4 py-3 flex-1 min-w-[180px]" style={{ background: 'var(--fill)' }}>
                <div className="t-small" style={{ color: pile[k].color, fontWeight: 700 }}>{pile[k].label}</div>
                <div className="t-title num">{size(v.data.totals[k])}</div>
                <div className="t-small c3">{pile[k].hint}</div>
              </div>
            ))}
          </div>
        )}
        <div className="flex items-center gap-4 flex-wrap"><span className="c2">{t('Borrado inteligente')}</span><Segmented value={smart ? 'si' : 'no'} onChange={(x) => void api('setSettings', { smartClean: { ...(state?.settings.smartClean ?? {}), [pid]: x === 'si' } })} options={[{ value: 'no', label: t('No: solo cuando yo pulse') }, { value: 'si', label: t('Sí: lo apartado que nadie pida, a la papelera') }]} /></div>
        {(v.data?.aside ?? []).length > 0 && (<div className="flex flex-col gap-1.5"><b className="t-small c2">{t('Apartado ({length}) · vuelve solo si una tarea lo nombra; si nadie lo pide en 4 semanas{v0}', { length: (v.data.aside as any[]).length, v0: smart ? t(', a la papelera') : t(', se queda apartado') })}</b>{(v.data.aside as { from: string; name: string; size: number; at: number; why: string }[]).map((a) => (<div key={a.from} className="flex items-center gap-3 t-small min-w-0"><span className="num flex-none w-16 text-right">{size(a.size)}</span><span className="min-w-0 flex-1 truncate" title={a.from}>{a.name} <span className="c3">· {a.why}</span></span><button className="btn btn-sm flex-none" onClick={() => void api<string>('cleanupRestore', pid, a.from).then((r) => { toast(t('Devuelto: {r}', { r: r })); setTick((t) => t + 1) }, (e) => toast((e as Error).message))}>{t('Devolver')}</button></div>))}</div>)}
        {items.filter((x) => x.pile !== 'queda').slice(0, 14).map((x) => (
          <div key={x.path} className="flex items-center gap-3 t-small min-w-0">
            <span className="dot flex-none" style={{ background: pile[x.pile].color }} />
            <span className="num flex-none w-16 text-right" style={{ fontWeight: 650 }}>{size(x.size)}</span>
            <span className="min-w-0 flex-1"><span className="block truncate" style={{ fontWeight: 600 }} title={x.path}>{x.rel}</span><span className="block truncate c3">{x.copy} · {x.why}</span></span>
            {x.pile === 'sobra' ? <button className="btn btn-sm flex-none" title={t('A la papelera: se puede recuperar desde ahí')} onClick={() => void api<string>('cleanupTrash', pid, x.path).then((r) => { toast(t('A la papelera: {r}', { r: r })); setTick((t) => t + 1) }, (e) => toast((e as Error).message))}>{t('A la papelera')}</button>
              : <button className="btn btn-sm flex-none" title={t('Se mueve a una carpeta de Mission Control con su ficha; se devuelve con un clic')} onClick={() => void api<string>('cleanupAside', pid, x.path).then((r) => { toast(t('Apartado: {r}', { r: r })); setTick((t) => t + 1) }, (e) => toast((e as Error).message))}>{t('Apartar')}</button>}
          </div>
        ))}
      </div>
    </section>
  )
}
/**
 * EV102: the course of the project: what was retired (git retirado/*, each with the user's words in DECISIONS) and when
 * it was last reviewed. «Recuperar» asks the Claude with the turn to put it back; nothing is changed from here.
 */
function CourseSection({ pid, name }: { pid: string; name: string }) {
  const { toast, now } = useStore()
  const r = useAsync(() => api<{ items: { ref: string; at: number; subject: string }[]; lastReview: number }>('retired', pid), [pid])
  const back = (ref: string) => void api('addInstruction', { projectId: pid, kind: 'mensaje', body: t('El usuario quiere recuperar lo retirado en {ref}: vuelve a ponerlo como estaba (está en esa rama o etiqueta de git), comprueba con pmc verifica que todo sigue bien y apúntalo en docs/DECISIONS.md.', { ref: ref }) }).then(() => toast(t('Pedido: lo hará el Claude que trabaje en el proyecto')), (e) => toast((e as Error).message))
  return (
    <section className="mb-8" id="rumbo">
      <SectionTitle title={t('Rumbo')} sub={t('Lo que se ha quitado de {name} porque dijiste que ya no lo querías, y cuándo se repasó por última vez', { name: name })} />
      <div className="group p-5 flex flex-col gap-3">
        <div className="t-small c2">{t('{v0} Cada semana, el Claude que trabaja aquí lo repasa: solo quita lo que dijiste claramente que no quieres (con vuelta atrás) y lo dudoso te lo pregunta en Decidir.', { v0: r.data?.lastReview ? t('Último repaso: {v0}.', { v0: ago(r.data.lastReview, now) }) : t('Aún no se ha repasado.') })}</div>
        {(r.data?.items ?? []).length === 0 && <div className="t-small c3">{t('No se ha retirado nada.')}</div>}
        {(r.data?.items ?? []).map((x) => (
          <div key={x.ref} className="flex items-center gap-3 t-small min-w-0">
            <span className="min-w-0 flex-1"><b className="block truncate">{x.ref.replace(/^retirado\//, '')}</b><span className="block truncate c3">{x.subject} · {ago(x.at, now)}</span></span>
            <button className="btn btn-sm flex-none" onClick={() => back(x.ref)}>{t('Recuperar')}</button>
          </div>
        ))}
      </div>
    </section>
  )
}
const SETTINGS_TABS = [{ id: 'general', get label() { return t('General') } }, { id: 'cuentas', get label() { return t('Cuentas') } }, { id: 'proyecto', get label() { return t('Proyecto') } }, { id: 'avisos', get label() { return t('Avisos y móvil') } }, { id: 'comprobacion', get label() { return t('Comprobación') } }, { id: 'copias', get label() { return t('Copias de seguridad') } }]

export function SettingsScreen() {
  const { state, toast, refresh, param } = useStore()
  const [busy, setBusy] = useState<string>()
  // EV70: in tabs, what is touched most first; a link can open one (go('ajustes', 'cuentas')), and the last one is kept.
  const [tab, setTab] = useState<string>(() => { if (param && SETTINGS_TABS.some((t) => t.id === param)) return param; try { return localStorage.getItem('pmc.ajustes') || 'general' } catch { return 'general' } })
  useEffect(() => { if (param && SETTINGS_TABS.some((t) => t.id === param)) setTab(param) }, [param])
  if (!state) return null
  const p = state.projects.find((x) => x.id === state.activeProjectId)
  const set = (patch: any) => api('setSettings', patch).then(() => refresh())
  const install = async (id: string, on: boolean) => {
    setBusy(id)
    try {
      const r = await api<any>(on ? 'statusLineInstall' : 'statusLineUninstall', id)
      toast(on ? t('Lectura de consumo activada en {id}{v0}', { id: id, v0: r.backup ? t(' (copia guardada)') : '' }) : t('Quitada de {id}', { id: id }))
      await refresh()
    } catch (e) { toast((e as Error).message) } finally { setBusy(undefined) }
  }
  const hooks = async (id: string, on: boolean) => {
    setBusy('h' + id)
    try {
      await api(on ? 'hooksInstall' : 'hooksUninstall', id)
      toast(on ? t('Coordinación activada en {v0}: se nota desde su próxima sesión', { v0: accName(id) }) : t('Coordinación quitada de {v0}', { v0: accName(id) }))
      await refresh()
    } catch (e) { toast((e as Error).message) } finally { setBusy(undefined) }
  }
  return (
    <div className="content-inner max-w-[980px]">
      {/* The title first, as on every other screen (EV18: it sat under the phone and sound cards, halfway down). */}
      <h1 className="t-display mb-7 flex items-center gap-3"><ScreenIcon route="ajustes" />{t('Ajustes')}</h1>
      <div className="mb-7 overflow-x-auto" style={{ scrollbarWidth: 'none' }}>
        <Segmented value={tab} onChange={(v) => { setTab(v); try { localStorage.setItem('pmc.ajustes', v) } catch { /* private */ } }} options={SETTINGS_TABS.map((s) => ({ value: s.id, label: s.label }))} />
      </div>
      {/* EV87: the look of the app first, all in sight (the user, 13-11: «una gran variedad de temas»). */}
      {tab === 'general' && (<>
      <LanguagePicker />
      <section className="mb-8" id="apariencia">
        <SectionTitle title={t('Apariencia')} sub={t('Elige tamaño, color y estilo: se ve al momento')} />
        <TextSize />
        {/* EV131: the shape first (where everything is), then the colours on top of it. */}
        <div className="group p-5 mb-4" id="forma">
          <div className="t-head mb-1">{t('Forma de la app')}</div>
          <div className="t-small c3 mb-3">{t('Dónde está cada cosa y cómo te mueves. Son las mismas pantallas y los mismos datos: cambia cuando quieras sin perder nada, y los colores de abajo valen para todas.')}</div>
          <LayoutPicker />
        </div>
        <div className="group p-5"><ThemePicker /></div>
      </section>
      </>)}
      {tab === 'avisos' && (<>
      <PhoneSetup />
      <NoticeSettings />
      </>)}
      {tab === 'cuentas' && (<>
      <AccountsSection />
      <RechargeSettings />
      </>)}
      {tab === 'comprobacion' && (<>
      <HealthSection />
      </>)}
      {tab === 'general' && (<>
      <section className="mb-8">
        <SectionTitle title={t('Comportamiento')} />
        <div className="group p-5 flex flex-col gap-4">
          <div className="flex items-center gap-4 flex-wrap"><span className="w-44 c2">{t('Si nadie contesta un «1. Yes / 2. No»')}</span><Segmented value={state.settings.awayPolicy ?? 'todo'} onChange={(v) => set({ awayPolicy: v })} options={[{ value: 'todo', label: t('Pulsar 1 (sí)') }, { value: 'seguro', label: t('Sí, menos lo arriesgado') }, { value: 'esperar', label: t('Esperarme') }]} /><span className="c3 t-small">{t('a los')}</span><Segmented value={String(state.settings.awayMinutes ?? 3)} onChange={(v) => set({ awayMinutes: Number(v) })} options={[{ value: '1', label: t('1 min') }, { value: '3', label: t('3 min') }, { value: '10', label: t('10 min') }]} /></div>
          <div className="flex items-center gap-4"><span className="w-44 c2">{t('Reducir movimiento')}</span><Segmented value={state.settings.reduceMotion} onChange={(v) => set({ reduceMotion: v })} options={[{ value: 'system', label: t('Como el sistema') }, { value: 'on', label: t('Sí') }, { value: 'off', label: t('No') }]} /></div>
          {/* EV188: the guide of the app, again. */}
          <div className="flex items-center gap-4 flex-wrap"><span className="w-44 c2">{t('Guía de la app')}</span><button className="btn btn-sm" onClick={startTour}>{t('Ver la guía')}</button><span className="t-small c3">{t('Un minuto, pantalla a pantalla: qué es cada parte')}</span></div>
        </div>
      </section>
      {/* EV189: after a restart of the PC, the Claudes go back to work by themselves. */}
      <AfterRestart />
      </>)}
      {tab === 'cuentas' && (<>
      <section className="mb-8">
        <SectionTitle title={t('Lectura de consumo (statusLine)')} sub={t('Así llegan el % de 5 horas y semanal, con sus reinicios, sin pedir nada a Anthropic ni gastar uso')} />
        <div className="group p-5">
          <div className="t-small c2 mb-4 leading-relaxed">
            {t('Añade a la configuración de cada cuenta (settings.json de su carpeta) una línea de estado oficial de Claude Code que guarda los porcentajes en')} {state.dataDir}{t('\\usage y sigue mostrando una línea útil en la terminal: cuenta, modelo, contexto, 5 h y semana. Antes se guarda una copia del archivo. Si la cuenta ya tenía su propia línea de estado, se conserva y se muestra encima. Ojo: con una línea de estado propia, Claude Code oculta algunas pistas de teclado del pie («esc to interrupt»). Los datos llegan tras la primera respuesta de cada sesión.')}
          </div>
          {!state.nodeExe && <div className="t-small mb-3" style={{ color: 'var(--red)' }}>{t('No se encuentra Node.js: hace falta para la línea de estado.')}</div>}
          <div className="flex flex-col gap-2">
            {state.agents.map((a) => {
              const sl = state.statusLine[a.id]
              return (
                <div key={a.id} className="flex items-center gap-3 px-3.5 py-2.5 rounded-xl" style={{ background: 'var(--bg-elev-2)' }}>
                  <Avatar id={a.id} size={28} />
                  <div className="min-w-0 flex-1">
                    <div className="t-body" style={{ fontWeight: 580 }}>{accName(a.id)} <span className="c3 t-small" style={{ fontWeight: 450 }}>· {sl.file}</span></div>
                    <div className="t-small c3 truncate">{sl.ours ? (a.usage.snapshot ? t('Activa · última lectura {v0}', { v0: ago(a.usage.snapshot.capturedAt) }) : t('Activa · esperando la primera respuesta de una sesión')) : sl.installed ? t('Tiene otra línea de estado: {command}', { command: sl.command }) : t('No activada')}</div>
                  </div>
                  {sl.ours
                    ? <button className="btn btn-sm" disabled={busy === a.id} onClick={() => install(a.id, false)}>{t('Quitar')}</button>
                    : <button className="btn btn-sm btn-primary" disabled={busy === a.id || !state.nodeExe} onClick={() => install(a.id, true)}>{t('Activar')}</button>}
                </div>
              )
            })}
          </div>
          <div className="t-small c3 mt-3">{t('Las copias de los settings.json quedan en {dataDir}\\backups\\config. Para ver el consumo en la web: claude.ai › Ajustes › Uso.', { dataDir: state.dataDir })}</div>
        </div>
      </section>
      <section className="mb-8">
        <SectionTitle title={t('Coordinación entre los Claude (hooks)')} sub={t('Que las instrucciones lleguen solas y nadie repita una tarea')} />
        <div className="group p-5">
          <div className="t-small c2 mb-4 leading-relaxed">
            {t('Añade a cada cuenta unos hooks oficiales de Claude Code. Al empezar una sesión, ese Claude recibe tus instrucciones pendientes y la lista de tareas reservadas por otros; al terminar cada turno, mantiene vivas sus reservas. Además se apuntan las sesiones abiertas, los límites y los archivos que escribe. Se suman a los hooks que ya hubiera (los que ya tuviera cada proyecto siguen igual), se guarda copia del settings.json y se quitan con un clic. No gastan uso.')}
          </div>
          <div className="flex flex-col gap-2">
            {state.agents.map((a) => {
              const on = state.hooks?.[a.id]
              return (
                <div key={a.id} className="flex items-center gap-3 px-3.5 py-2.5 rounded-xl" style={{ background: 'var(--bg-elev-2)' }}>
                  <Avatar id={a.id} size={28} />
                  <div className="min-w-0 flex-1">
                    <div className="t-body" style={{ fontWeight: 580 }}>{accName(a.id)}</div>
                    <div className="t-small" style={{ color: state.hooksOutdated?.[a.id] ? 'var(--orange)' : 'var(--label-3)' }}>{on ? (state.hooksOutdated?.[a.id] ? t('Activa, con una versión anterior: actualízala') : t('Activa y al día')) : t('No activada')}</div>
                  </div>
                  {on && state.hooksOutdated?.[a.id] && <button className="btn btn-sm btn-primary" disabled={busy === 'h' + a.id} onClick={() => hooks(a.id, true)}>{t('Actualizar')}</button>}
                  {on
                    ? <button className="btn btn-sm" disabled={busy === 'h' + a.id} onClick={() => hooks(a.id, false)}>{t('Quitar')}</button>
                    : <button className="btn btn-sm btn-primary" disabled={busy === 'h' + a.id || !state.nodeExe} onClick={() => hooks(a.id, true)}>{t('Activar')}</button>}
                </div>
              )
            })}
          </div>
          <div className="t-small c3 mt-3">{t('Los agentes pueden reservar tareas con')} <b>pmc claim &lt;ID&gt;</b> {t('y liberarlas con')} <b>pmc release &lt;ID&gt;</b> {t('(el programa está en {dataDir}\\bin\\pmc.mjs).', { dataDir: state.dataDir })}</div>
        </div>
      </section>
      </>)}
      {tab === 'proyecto' && (<>
      {p && (
        <section className="mb-8">
          <SectionTitle title={t('Proyecto · {name}', { name: p.name })} sub={p.root} right={<button className="btn btn-sm" onClick={() => api('addProject').then((r: any) => r && refresh())}><Plus size={13} /> {t('Añadir proyecto')}</button>} />
          <div className="mb-3"><ProjectBrain projectId={p.id} /></div>
          <div className="mb-3"><NewProject /></div>
          <div className="group p-5 flex flex-col gap-4">
            <label className="flex items-start gap-3">
              <input type="checkbox" className="mt-1 accent-[var(--accent)]" checked={p.allowBuzon} onChange={(e) => api('updateProject', p.id, { allowBuzon: e.target.checked }).then(() => { refresh(); toast(e.target.checked ? t('Permitido escribir en el Buzón') : t('Buzón en solo lectura')) })} />
              <span>
                <span className="t-body" style={{ fontWeight: 580 }}>{t('Permitir escribir en el Buzón')}</span>
                <span className="t-small c3 block">{t('Las instrucciones que entregues se añaden bajo «Apuntes nuevos» de {root}\\docs\\Buzón.md (con copia previa). Es lo único que Mission Control escribiría en el proyecto; los agentes lo leen al empezar cada bloque.', { root: p.root })}</span>
              </span>
            </label>
            <div>
              <div className="t-micro c3 mb-1">{t('Copias detectadas')}</div>
              {p.copies.map((c) => <div key={c.path} className="t-small c2">{c.label} · {c.branch ?? '—'} · <span className="c3">{c.path}</span></div>)}
            </div>
            <div>
              <div className="t-micro c3 mb-1">{t('Carpetas de la galería')}</div>
              <div className="t-small c3 mb-2">{t('De aquí sale lo que ves en la Galería. Si falta algo, añade su carpeta.')}</div>
              {p.mediaDirs.map((d) => (
                <div key={d} className="flex items-center gap-2 py-0.5">
                  <span className="t-small c2 break-all flex-1 min-w-0 selectable">{d}</span>
                  <button className="btn btn-sm btn-ghost flex-none" title={t('La Galería dejará de mirar aquí; los archivos no se tocan')} onClick={() => void api('removeMediaFolder', p.id, d).then(() => { void refresh(); toast(t('Carpeta quitada de la Galería: los archivos siguen en su sitio')) }, (e) => toast((e as Error).message))}><Trash2 size={12} /> {t('Quitar')}</button>
                </div>
              ))}
              <button className="btn btn-sm mt-2" onClick={() => void api('addMediaFolder', p.id).then((r) => { if (r) { void refresh(); toast(t('Carpeta añadida: los archivos irán apareciendo')) } }, (e) => toast((e as Error).message))}><Plus size={13} /> {t('Añadir carpeta')}</button>
            </div>
            <div>
              <div className="t-micro c3 mb-1">{t('Mejorar mi proyecto')}</div>
              <div className="t-small c3 mb-2">{t('Un Claude repasa el proyecto entero (qué falla, qué falta, pruebas, rendimiento, lo que se ve), apunta las mejoras como tareas y empieza por la primera. Al añadir un proyecto que ya tenía trabajo se pide solo.')}</div>
              <ImproveButton projectId={p.id} name={p.name} />
            </div>
            <RemoveProject id={p.id} name={p.name} root={p.root} />
          </div>
        </section>
      )}
      </>)}
      {tab === 'proyecto' && p && <CleanupSection pid={p.id} />}
      {tab === 'proyecto' && p && <CourseSection pid={p.id} name={p.name} />}
      {tab === 'copias' && (<>
      <section className="mb-8">
        <SectionTitle title={t('Datos y copias de seguridad')} />
        <div className="group p-5 flex flex-col gap-3">
          <div className="t-small c2">{t('Todo lo de Mission Control vive en')} <b className="selectable">{state.dataDir}</b>{t(': base de datos (mission.db), lecturas de consumo, miniaturas y copias. Se hace una copia de la base de datos al día (se guardan 14). Actualizar la aplicación no borra estos datos.')}</div>
          <div className="flex gap-2">
            <button className="btn btn-sm" onClick={() => api<string>('backupNow').then((f) => toast(t('Copia hecha: {v0}', { v0: f.split(/[\\/]/).pop() })))}><HardDriveDownload size={13} /> {t('Copia ahora')}</button>
            <button className="btn btn-sm" onClick={() => api('openDataDir')}><FolderOpen size={13} /> {t('Abrir carpeta')}</button>
          </div>
          <Restore />
        </div>
      </section>
      </>)}
      {/* EV157 (the user, 14-11 12:35: «añadir… en la app, mi buymeacoffee, por si quieren apoyarme»): discreet, at the end. */}
      <div className="t-small c3 mt-10 mb-4 flex flex-wrap items-center gap-x-3 gap-y-1">
        <span>{t('Mission Control es de código abierto.')}</span>
        <button className="btn-link" onClick={() => void api('openExternal', 'https://github.com/PAKITRON5000/pakitron-mission-control')}>{t('Su página en GitHub')}</button>
        <span aria-hidden>·</span>
        <button className="btn-link" onClick={() => void api('openExternal', 'https://buymeacoffee.com/pakitron.exe')}>{t('¿Te ayuda? Invita a un café al autor')}</button>
      </div>
    </div>
  )
}

export { Terminal }

/** Ajustes › Datos: put one of the daily copies of the database back (EV13). The app asks before, and keeps today's. */
function Restore() {
  const { toast } = useStore()
  const [open, setOpen] = useState(false)
  const list = useAsync(() => (open ? api<{ name: string; at: number; bytes: number }[]>('backups') : Promise.resolve([])), [open])
  return (
    <details onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}>
      <summary className="t-small c3 cursor-pointer">{t('Restaurar una copia anterior')}</summary>
      <div className="flex flex-col gap-1 mt-2">
        {(list.data ?? []).map((b) => (
          <div key={b.name} className="flex items-center gap-2 t-small">
            <span className="c2 flex-1">{t('{v0} · {v1} MB', { v0: new Date(b.at).toLocaleString('es-ES', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }), v1: (b.bytes / 1e6).toFixed(1).replace('.', ',') })}</span>
            <button className="btn btn-sm btn-ghost" onClick={() => void api<{ restored: boolean }>('restoreBackup', b.name).then((r) => { if (r.restored) toast(t('Reiniciando con la copia…')) }, (e) => toast((e as Error).message))}><RotateCcw size={12} /> {t('Restaurar')}</button>
          </div>
        ))}
        {open && list.data && !list.data.length && <div className="t-small c3">{t('Aún no hay copias.')}</div>}
        <div className="t-small c3">{t('Antes de restaurar te lo pregunta y guarda una copia de cómo está ahora. Tus proyectos y sus archivos no se tocan.')}</div>
      </div>
    </details>
  )
}

/** EV161: the app's language (and, as it gets translated, the one the Claudes are told in). */
function LanguagePicker() {
  const { state, refresh, toast } = useStore()
  const chosen = state?.settings?.lang
  const set = (l: Lang) => void api('setSettings', { lang: l }).then(refresh).then(() => toast(t('Idioma: {lang}', { lang: LANGS.find((x) => x.id === l)?.label ?? l })), (e) => toast((e as Error).message))
  return (
    <section className="mb-8" id="idioma">
      <SectionTitle title={t('Idioma')} sub={t('El de la app, y el de lo que se les dice a los Claude a medida que se traduce. Sin elegir, el del sistema.')} />
      <div className="group p-5">
        <Segmented value={chosen ?? getLang()} onChange={(v) => set(v as Lang)} options={LANGS.map((l) => ({ value: l.id, label: l.label }))} />
      </div>
    </section>
  )
}
