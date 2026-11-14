import { ThemePicker } from '../components/ThemePicker'
import { LayoutPicker } from '../layouts/Picker'
import { ScreenIcon } from '../components/Sidebar'
import { useEffect, useState } from 'react'
import { GitBranch, FileText, FolderOpen, RotateCcw, Check, Send, Copy, Plus, HardDriveDownload, ShieldCheck, Terminal, ChevronRight, Trash2, UserPlus } from 'lucide-react'
import { NoticeSettings, PhoneSetup } from '../components/PhoneSetup'
import { MemoryBox } from '../components/MemoryBox'
import { RequestsBox, type UserRequest } from '../components/RequestsBox'
import { NewProject, ProjectBrain } from '../components/ProjectBrain'
import { useStore, useAsync } from '../lib/store'
import { api, media, type Comment, type Instruction, type TimelineEvent, type AccountId, type AgentCard } from '../lib/api'
import { Avatar, StatePill, SectionTitle, Segmented, Empty, ACCOUNT_COLOR, Bar, Recharge, accName, ACCOUNT_NAME } from '../components/ui'
import { UsageBar } from '../components/ClaudeRing'
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
    { label: 'Estado', get: (a) => <div className="flex flex-col gap-1"><StatePill state={a.state} /><span className="t-small c3">{a.stateReason}</span></div> },
    { label: 'Trabajando en', get: (a) => <span className="clamp-3">{a.sessions[0]?.title ?? a.heartbeat?.text.slice(0, 140) ?? <span className="c3">—</span>}</span> },
    { label: 'Última actividad', get: (a) => ago(a.lastActivityAt, now) },
    { label: 'Modelo', get: (a) => modelName(a.model) ?? <span className="c3">Sin datos</span> },
    { label: '5 horas', get: (a) => <div className="min-w-[170px]"><UsageBar a={a} which="five" now={now} compact /></div> },
    { label: 'Semana', get: (a) => <div className="min-w-[170px]"><UsageBar a={a} which="week" now={now} compact /></div> },
    { label: 'Lectura de consumo', get: (a) => (state.statusLine[a.id]?.ours ? (a.usage.snapshot ? `Línea de estado · ${ago(a.usage.snapshot.capturedAt, now)}` : 'Instalada · esperando la primera respuesta') : <span className="c3">No instalada</span>) },
    { label: 'Sesiones abiertas', get: (a) => a.sessions.some((x) => x.pid || x.status === 'busy') ? a.sessions.filter((x) => x.pid || x.status === 'busy').map((s) => `${s.kind === 'background' ? 'fondo' : 'ventana'} · ${s.worktree ?? s.cwd.split('\\').pop()}`).join(', ') : <span className="c3">Ninguna</span> },
    { label: 'Tareas a su nombre', get: (a) => a.assigned.length || <span className="c3">0</span> },
    { label: 'Último relevo', get: (a) => (a.heartbeat ? `${dateShort(a.heartbeat.at)} ${clock(a.heartbeat.at)}` : <span className="c3">—</span>) }
  ]
  return (
    <div className="content-inner">
      <h1 className="t-display">Cuentas</h1>
      <div className="t-head c2 mt-1.5 mb-7 flex items-center gap-3 flex-wrap" style={{ fontWeight: 450 }}>Las cuentas en uso, lado a lado: qué hacen, cuánto uso les queda y sus conversaciones. El nombre y si se usan, en Relevos.{out.length > 0 && <button className="btn btn-sm btn-ghost" onClick={() => setShowOut(!showOut)}>{showOut ? 'Ocultar las que no se usan' : `Ver también ${out.map((a) => `${accName(a.id)}`).join(' y ')}`}</button>}</div>
      <div className="group overflow-x-auto mb-9">
        <table className="w-full t-small" style={{ borderCollapse: 'separate', borderSpacing: 0 }}>
          <thead>
            <tr>
              <th className="w-40" />
              {shown.map((a) => (
                <th key={a.id} className="text-left p-4 align-bottom min-w-[190px]">
                  <button className="flex items-center gap-2.5 border-0 bg-transparent p-0" onClick={() => setAgentOpen(a.id)}>
                    <Avatar id={a.id} size={32} />
                    <div className="text-left"><div className="t-head">{accName(a.id)}</div><div className="t-small c3" style={{ fontWeight: 450 }}>Claude {a.id.slice(6)}</div></div>
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
      <SectionTitle title="Conversaciones del proyecto" sub="Abiertas ahora o guardadas para retomarlas" />
      <div className="group">
        {(saved.data ?? []).slice(0, 40).map((s) => (
          <div key={s.sessionId} className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-[var(--fill)] t-small">
            <span className="w-24 c3 num flex-none">{ago(s.mtime, now)}</span>
            {s.account ? <span className="flex items-center gap-1.5 w-24 flex-none"><span className="dot" style={{ background: ACCOUNT_COLOR[s.account as AccountId] }} />{accName(s.account)}</span> : <span className="w-24 c3 flex-none">¿?</span>}
            <span className="truncate flex-1">{s.title ?? s.lastPrompt ?? s.sessionId}</span>
            <span className="c3 w-24 truncate flex-none">{s.copy}</span>
            <span className="w-20 flex-none" style={{ color: s.live ? 'var(--green)' : 'var(--label-3)' }}>{s.live ? 'Abierta' : 'Guardada'}</span>
            {!s.live && s.account && (
              <button className="btn btn-sm" onClick={() => api('resumeSession', s.account, s.cwd, s.sessionId).then(() => toast('Retomando en una ventana nueva'), (e: Error) => toast(e.message))}><RotateCcw size={12} /> Retomar</button>
            )}
          </div>
        ))}
        {saved.data && saved.data.length === 0 && <Empty title="Sin conversaciones guardadas" text="Cuando un Claude trabaje en este proyecto, su conversación queda aquí y podrás retomarla donde la dejó." />}
      </div>
      {project && <div className="t-small c3 mt-3">Retomar abre una ventana con el lanzador de la cuenta (claude-accesos\claudeN.cmd), en la carpeta de la copia. No se arranca nada sin que pulses.</div>}
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
  const open = (comments.data ?? []).filter((c) => c.status !== 'aprobado')
  const closed = (comments.data ?? []).filter((c) => c.status === 'aprobado')
  const deliver = (id: number) => api<Instruction>('deliverInstruction', pid, id).then((r) => { ins.reload(); toast(r.status === 'entregada' ? 'Escrito en el Buzón' : r.error ?? 'No se pudo') }, (e: Error) => toast(e.message))
  const D: Record<string, [string, string]> = {
    guardada: ['Guardada', 'var(--label-3)'], 'pendiente-entrega': ['Pendiente de entrega', 'var(--orange)'], entregada: ['En el Buzón', 'var(--accent)'],
    recibida: ['Recibida por un agente', 'var(--teal)'], ejecutada: ['Hecha', 'var(--green)'], fallida: ['Falló la entrega', 'var(--red)'], anulada: ['Anulada por ti', 'var(--gray)']
  }
  return (
    <div className="content-inner max-w-[1200px]">
      <div className="flex flex-wrap items-end gap-3 mb-5">
        <div>
          <h1 className="t-display flex items-center gap-3"><ScreenIcon route="revisiones" />Revisar</h1>
          <div className="t-head c2 mt-1.5" style={{ fontWeight: 450 }}>Tus comentarios y qué ha pasado con cada uno.</div>
        </div>
        <div className="ml-auto"><Segmented value={tab} onChange={setTab} options={[{ value: 'abiertos', label: `Abiertos · ${open.length}` }, { value: 'instrucciones', label: `Instrucciones · ${(ins.data ?? []).length}` }, { value: 'cerrados', label: `Aprobados · ${closed.length}` }]} /></div>
      </div>
      {/* 12-11: notes reach the Claude through its hooks now, not only through the Buzón; this says what happens to each. */}
      <div className="card-flat px-4 py-3 mb-4 t-small c2 flex items-center gap-3">
        <ShieldCheck size={16} className="c3 flex-none" />
        <span>{Object.values(state?.hooks ?? {}).some(Boolean)
          ? 'Tus notas les llegan solas a los Claude de este proyecto (al empezar o en su siguiente paso): entonces pasan a «recibido». Cuando uno la arregla, vuelve aquí como «esperando revisión» para que la apruebes o la reabras.'
          : 'Sin la coordinación activada en ninguna cuenta, tus notas se guardan aquí y puedes copiarlas. Actívala en Ajustes › Cuentas para que les lleguen solas.'}</span>
      </div>
      {tab !== 'instrucciones' && (
        <div className="flex flex-col gap-2">
          {(tab === 'abiertos' ? open : closed).map((c) => (
            <div key={c.id} className="group p-4 flex gap-4">
              {c.assetId && <button className="tile w-28 aspect-[4/3] flex-none p-0 border-0" onClick={() => setViewer(c.assetId)}><img src={media(`thumb/${c.assetId}?s=300`)} alt="" /></button>}
              <div className="min-w-0 flex-1">
                <div className="t-small c3">{c.status} · {ago(c.createdAt)}{c.target ? ` · para ${accName(c.target)}` : ''}{c.timeSec != null ? ` · segundo ${c.timeSec.toFixed(2)}` : ''}</div>
                <div className="t-body mt-1 selectable">{c.body}</div>
                <div className="flex gap-1.5 mt-2">
                  <button className="btn btn-sm" onClick={() => c.assetId && setViewer(c.assetId)}>Abrir</button>
                  {c.status !== 'aprobado' && <button className="btn btn-sm" onClick={() => api('setCommentStatus', c.id, 'aprobado').then(() => comments.reload())}><Check size={12} /> Aprobar</button>}
                  {c.status === 'aprobado' && <button className="btn btn-sm" onClick={() => api('setCommentStatus', c.id, 'reabierto').then(() => comments.reload())}><RotateCcw size={12} /> Reabrir</button>}
                </div>
              </div>
            </div>
          ))}
          {(tab === 'abiertos' ? open : closed).length === 0 && <Empty title={tab === 'abiertos' ? 'Nada pendiente de revisar' : 'Aún no has aprobado nada'} text="Los comentarios se dejan desde el visor de la galería: pulsa sobre la imagen o en el segundo del vídeo." />}
        </div>
      )}
      {tab === 'instrucciones' && (
        <div className="group">
          {(ins.data ?? []).map((i) => (
            <div key={i.id} className="flex items-start gap-3 px-3 py-3 rounded-lg hover:bg-[var(--fill)]">
              <span className="pill flex-none mt-0.5" style={{ background: `color-mix(in srgb, ${D[i.status][1]} 15%, transparent)`, color: D[i.status][1] }}>{D[i.status][0]}</span>
              <div className="min-w-0 flex-1">
                <div className="t-body selectable">{i.body}</div>
                <div className="t-small c3 mt-0.5">{i.kind} · {ago(i.createdAt)}{i.target ? ` · para ${accName(i.target)}` : ''}{i.channel ? ` · ${i.channel.split('\\').pop()}` : ''}{i.error ? ` · ${i.error}` : ''}</div>
              </div>
              <div className="flex gap-1.5 flex-none">
                {(i.status === 'guardada' || i.status === 'fallida') && i.kind !== 'nota' && <button className="btn btn-sm" disabled={!project?.allowBuzon} onClick={() => deliver(i.id)}><Send size={12} /> Al Buzón</button>}
                <button className="btn btn-sm" onClick={() => api('copyInstruction', pid, i.id).then(() => toast('Copiado'))}><Copy size={12} /></button>
                {i.status !== 'ejecutada' && i.status !== 'guardada' && <button className="btn btn-sm" onClick={() => api('setInstructionStatus', i.id, 'ejecutada').then(() => ins.reload())}><Check size={12} /> Hecha</button>}
              </div>
            </div>
          ))}
          {(ins.data ?? []).length === 0 && <Empty title="Sin instrucciones" text="Escribe una con «Nueva instrucción» (Ctrl+N) desde cualquier pantalla." />}
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
  const light = !data.data ? { color: 'var(--gray)', text: 'Comprobando…', sub: '' }
    : clash.length ? { color: 'var(--red)', text: `${plural(toJoin.length, 'copia tiene', 'copias tienen')} trabajo sin unir, y puede chocar`, sub: 'Dos copias han tocado los mismos archivos. Mejor que lo una un Claude con cuidado.' }
    : toJoin.length ? { color: 'var(--orange)', text: `${plural(toJoin.length, 'copia tiene', 'copias tienen')} trabajo sin unir`, sub: 'No corre prisa, pero no estará en el juego principal hasta que se una.' }
    : loose.length ? { color: 'var(--orange)', text: 'Lo guardado está todo unido, pero queda algo por mirar', sub: `${plural(loose.length, 'copia tiene', 'copias tienen')} archivos sin guardar y nadie trabajando ahí: pueden ser restos o trabajo que conviene conservar.` }
    : { color: 'var(--green)', text: 'Está todo unido: no tienes que hacer nada', sub: old.length ? `${plural(old.length, 'copia antigua sigue', 'copias antiguas siguen')} ahí, pero su trabajo ya está en la principal.` : 'Todo el trabajo guardado está en la principal.' }
  const ask = async (id: string, body: string) => {
    if (!pid) return
    try {
      await api('addInstruction', { projectId: pid, kind: 'tarea', body })
      setAsked([...asked, id])
      toast('Pedido: lo hará el primer Claude que trabaje')
    } catch (e) { toast((e as Error).message) }
  }
  const who = (b: BranchIntegration) => (state?.agents ?? []).filter((a) => a.sessions.some((x) => x.cwd.toLowerCase().startsWith(b.path.toLowerCase())))
  const row = (b: BranchIntegration) => {
    const isOpen = open === b.label
    const color = b.error ? 'var(--gray)' : b.ahead && b.overlap.length ? 'var(--red)' : b.ahead || (b.dirty && !inUse(b)) ? 'var(--orange)' : 'var(--green)'
    const say = b.error ? 'No se ha podido leer' : b.ahead ? `Tiene ${plural(b.ahead, 'cambio', 'cambios')} que la principal aún no tiene` : 'Lo guardado ya está en la principal'
    const people = who(b)
    return (
      <div key={b.label}>
        <button className="row" onClick={() => setOpen(isOpen ? undefined : b.label)} aria-expanded={isOpen}>
          <span className="icon-sq icon-sq-lg" style={{ background: color }}><GitBranch size={16} /></span>
          <span className="min-w-0 flex-1">
            <span className="t-body block" style={{ fontWeight: 560 }}>{b.branch ?? b.label}</span>
            <span className="t-small block truncate" style={{ color }}>{say}{b.dirty ? <span className="c3"> · {plural(b.dirty, 'archivo', 'archivos')} sin guardar</span> : null}</span>
          </span>
          {people.map((a) => <span key={a.id} className="flex items-center gap-1.5 t-small c2 flex-none"><Avatar id={a.id} size={22} /> {accName(a.id)}</span>)}
          <ChevronRight size={16} className="c4 flex-none" style={{ transform: isOpen ? 'rotate(90deg)' : undefined, transition: 'transform 200ms' }} />
        </button>
        {isOpen && (
          <div className="px-[58px] pb-4 flex flex-col gap-3">
            <div className="t-small c3 selectable">{b.path}</div>
            {b.pending.length > 0 && (
              <div>
                <div className="t-micro c3 mb-1.5">Lo que hay aquí y no en la principal</div>
                {b.pending.slice(0, 12).map((c) => <div key={c.hash} className="t-small flex gap-3 py-0.5"><span className="c3 w-20 flex-none">{ago(c.at, now)}</span><span className="clamp-2">{c.subject}</span></div>)}
                {b.pending.length > 12 && <div className="t-small c3">y {b.pending.length - 12} más</div>}
              </div>
            )}
            {b.overlap.length > 0 && (
              <div>
                <div className="t-micro mb-1.5" style={{ color: 'var(--red)' }}>Archivos tocados en las dos · {b.overlap.length}</div>
                <div className="t-small c2 selectable">{b.overlap.slice(0, 15).map((f) => <div key={f} className="truncate">{f}</div>)}</div>
                {b.overlap.length > 15 && <div className="t-small c3">y {b.overlap.length - 15} más</div>}
              </div>
            )}
            {b.behind > 0 && <div className="t-small c3">La principal va {plural(b.behind, 'cambio', 'cambios')} por delante de esta copia.</div>}
            <div className="flex gap-2 flex-wrap">
              {b.ahead > 0 && <button className="btn btn-sm btn-primary" disabled={asked.includes(b.label)} onClick={() => void ask(b.label, `Une la rama ${b.branch} (copia ${b.path}) en la principal ${b.base}: tiene ${b.ahead} cambios sin unir${b.overlap.length ? ` y ${b.overlap.length} archivos tocados en las dos, revísalos` : ''}. Comprueba que compila y pasa las pruebas antes de darlo por hecho.`)}><Send size={12} /> {asked.includes(b.label) ? 'Pedido' : 'Pedir a Claude que la una'}</button>}
              <button className="btn btn-sm" onClick={() => api('openPath', b.path)}><FolderOpen size={12} /> Abrir carpeta</button>
            </div>
          </div>
        )}
      </div>
    )
  }
  return (
    <div className="content-inner max-w-[1180px]">
      <h1 className="t-display flex items-center gap-3"><ScreenIcon route="integracion" />Ramas</h1>
      <div className="t-head c2 mt-1.5 mb-5" style={{ fontWeight: 450 }}>Una rama es una copia del proyecto donde un Claude trabaja sin pisar a los demás. Cuando acaba, lo suyo se une a la principal{main?.branch ? <> (<b>{main.branch}</b>)</> : null}: lo que ves y lo que se compila.</div>

      <div className="card p-5 mb-8 flex items-start gap-3" style={{ boxShadow: `inset 3px 0 0 ${light.color}` }}>
        <span className="dot mt-2 flex-none" style={{ background: light.color, width: 12, height: 12 }} />
        <div className="min-w-0 flex-1">
          <div className="t-title">{light.text}</div>
          {light.sub && <div className="t-body c2 mt-1">{light.sub}</div>}
        </div>
        {toJoin.length > 1 && <button className="btn btn-sm btn-primary flex-none" disabled={asked.includes('todas')} onClick={() => void ask('todas', `Une en la principal ${toJoin[0].base} las ramas con trabajo sin unir: ${toJoin.map((b) => `${b.branch} (${b.ahead} cambios)`).join(', ')}. Una a una, comprobando que compila y pasa las pruebas.`)}><Send size={12} /> {asked.includes('todas') ? 'Pedido' : 'Pedir que las una todas'}</button>}
      </div>

      {main && (
        <>
          <h2 className="section-title">La principal</h2>
          <div className="group mb-9">
            <div className="row">
              <span className="icon-sq icon-sq-lg" style={{ background: 'var(--blue)' }}><GitBranch size={16} /></span>
              <span className="min-w-0 flex-1">
                <span className="t-body block" style={{ fontWeight: 560 }}>{main.branch}</span>
                <span className="t-small c3 block truncate">Lo último: {main.headSubject}</span>
              </span>
              <span className="t-small c3 text-right flex-none">{main.headAt ? ago(main.headAt, now) : ''}</span>
            </div>
          </div>
        </>
      )}

      {!data.data && <div className="group mb-9"><div className="row"><div className="skeleton h-4 w-1/2 rounded" /></div></div>}
      {active.length > 0 && (
        <>
          <h2 className="section-title">En uso o por unir</h2>
          <div className="group mb-9">{active.map(row)}</div>
        </>
      )}
      {parked.length > 0 && (
        <>
          <h2 className="section-title">Guardadas para revisar <span className="t-small c3" style={{ fontWeight: 450 }}>· trabajo viejo que se guardó por decisión tuya; un Claude lo revisa antes de unir nada</span></h2>
          <div className="group mb-9">{parked.map(row)}</div>
        </>
      )}
      {loose.length > 0 && (
        <>
          <div className="flex items-center gap-3 flex-wrap mb-2">
            <h2 className="section-title m-0">Con archivos sin guardar</h2>
            <button className="btn btn-sm ml-auto" disabled={asked.includes('mirar')} onClick={() => void ask('mirar', `Mira los archivos sin guardar de estas copias, donde no trabaja nadie: ${loose.map((b) => `${b.branch} (${b.path}, ${b.dirty} archivos)`).join(', ')}. Di cuáles son generados y se pueden descartar, y cuáles son trabajo que hay que conservar. No descartes ni borres nada sin preguntar.`)}><Send size={12} /> {asked.includes('mirar') ? 'Pedido' : 'Pedir a Claude que lo mire'}</button>
          </div>
          <div className="t-small c3 mb-2">Nadie trabaja ahí ahora. No los borres a ciegas: pueden ser restos de una compilación o trabajo que no llegó a guardarse.</div>
          <div className="group mb-9">{loose.map(row)}</div>
        </>
      )}
      {old.length > 0 && (
        <>
          <div className="flex items-center gap-3 flex-wrap mb-2">
            <h2 className="section-title m-0">Copias antiguas, ya incluidas</h2>
            <button className="btn btn-sm ml-auto" disabled={asked.includes('limpiar')} onClick={() => void ask('limpiar', `Limpia las copias antiguas ya incluidas en la principal: ${old.map((b) => `${b.branch} (${b.path})`).join(', ')}. Comprueba antes que siguen sin cambios propios y sin archivos sin guardar; quita solo la copia de trabajo y su rama.`)}><Trash2 size={12} /> {asked.includes('limpiar') ? 'Pedido' : 'Pedir a Claude que las limpie'}</button>
          </div>
          <div className="t-small c3 mb-2">No hay nada que unir: lo suyo ya está en la principal. Solo ocupan sitio; quitarlas es opcional.</div>
          <div className="group mb-9">{old.map(row)}</div>
        </>
      )}
      <div className="t-small c3 px-1">Mission Control solo mira: no une, no cambia de rama y no borra nada. Eso lo hace un Claude cuando se lo pides{toJoin.length ? ' con los botones de arriba' : ' (cuando haya algo que unir, saldrá aquí arriba con su botón)'}.</div>
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
      <h1 className="t-display flex items-center gap-3"><ScreenIcon route="memoria" />Memoria</h1>
      <div className="t-head c2 mt-1.5 mb-7" style={{ fontWeight: 450 }}>Lo que saben todas las cuentas de este proyecto: lo que no deben olvidar, lo que leen al empezar, los relevos y los documentos.</div>
      <MemoryBox />
      <RequestsBox />
      {load.data && load.data.items.length > 0 && (
        <section className="mb-7">
          <SectionTitle title="Lo que lee cada sesión al empezar" sub={`unos ${load.data.tokens.toLocaleString('es-ES')} tokens antes de hacer nada, en cada ventana y tras cada compactación`} />
          <div className="group p-4 flex flex-col gap-2">
            {load.data.items.map((x) => {
              const max = Math.max(...load.data!.items.map((y) => y.tokens))
              return (
                <div key={x.what} className="flex items-center gap-3 t-small">
                  <span className="c2 flex-none" style={{ width: 300 }}>{x.what}</span>
                  <span className="flex-1 rounded-full" style={{ height: 6, background: 'var(--fill)' }}><span className="block rounded-full h-full" style={{ width: `${Math.max(2, (x.tokens / max) * 100)}%`, background: x.tokens > 4000 ? 'var(--orange)' : 'var(--indigo)' }} /></span>
                  <span className="c3 num flex-none" style={{ width: 170, textAlign: 'right' }}>{x.tokens.toLocaleString('es-ES')} tokens{x.note ? ` · ${x.note}` : ''}</span>
                  {x.file && x.note?.includes('se lee dos veces') && pid && (
                    <button className="btn btn-sm flex-none" title="Las sesiones de esta copia dejan de leer este CLAUDE.md (tiene el mismo texto que el suyo). Se guarda en su .claude/settings.local.json, con copia previa"
                      onClick={() => void api('excludeTwin', pid, x.file).then(() => { toast('Ya no se lee dos veces: vale para las ventanas que se abran a partir de ahora'); load.reload() }, (e) => toast((e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')))}>No leerlo dos veces</button>
                  )}
                  {x.file && <button className="btn btn-sm btn-ghost flex-none" onClick={() => void api('openPath', x.file)}>Abrir</button>}
                </div>
              )
            })}
            <div className="t-small c3">Lo que pasa de 4.000 tokens sale en naranja: cuanto más corto, menos gasta cada sesión al empezar. Lo largo y de consulta va mejor en `docs/` (se lee solo cuando hace falta) que en un CLAUDE.md.</div>
          </div>
        </section>
      )}
      <div className="grid gap-6 grid-cols-1 min-[1200px]:grid-cols-2">
        <section>
          <SectionTitle title="Relevos" sub={s?.relevoSource ? `Actualizado ${ago(s.relevoSource.mtime, now)}` : 'Sin nota de relevo'} />
          {state?.enCurso && <div className="card-flat p-4 mb-3"><div className="t-micro c3 mb-1">En curso</div><div className="t-small c2 selectable">{state.enCurso}</div></div>}
          <div className="group">
            {(s?.heartbeats ?? []).map((h, i) => (
              <div key={i} className="flex gap-3 px-3 py-3">
                {h.account ? <Avatar id={h.account} size={24} /> : <div className="w-6" />}
                <div className="min-w-0">
                  <div className="t-small c3">{dateShort(h.at)} {clock(h.at)} · {h.file.split('\\').slice(-3, -2)[0]}</div>
                  <div className="t-small c2 clamp-3 selectable">{h.text}</div>
                </div>
              </div>
            ))}
          </div>
        </section>
        <section>
          <SectionTitle title="Lo que recuerdan" sub={mem.data?.files.length ? `${mem.data.files.length} memorias compartidas` : 'Sin memorias para este proyecto'} />
          <div className="group mb-6">
            {(mem.data?.files ?? []).map((f) => (
              <button key={f.file} className="w-full text-left flex gap-3 px-3 py-2.5 rounded-lg border-0 bg-transparent hover:bg-[var(--fill)]" onClick={() => api('openPath', f.file)}>
                <FileText size={14} className="c3 mt-0.5 flex-none" />
                <div className="min-w-0"><div className="t-small" style={{ fontWeight: 580 }}>{f.name}</div><div className="t-small c3 clamp-2">{f.description}</div></div>
              </button>
            ))}
            {mem.data && !mem.data.files.length && <Empty title="Sin memorias" text="Los Claude guardan aquí lo que aprenden de ti y del proyecto mientras trabajan. Para que no olviden algo desde ya, escríbelo arriba en «Lo que no deben olvidar»." />}
          </div>
          <SectionTitle title="Documentos del proyecto" sub="docs\ de la copia principal" />
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
interface HealthCheck { name: string; ok: boolean; detail: string; fix?: string; needed: boolean }

/** What this PC needs and whether the data of each account arrives: each line says what it is and what to do. */
function HealthSection() {
  const [n, setN] = useState(0)
  const h = useAsync(() => api<{ tools: HealthCheck[]; readings: HealthCheck[] }>('health', n > 0), [n])
  const row = (c: HealthCheck) => (
    <div key={c.name} className="row">
      <span className="rounded-full flex-none" style={{ width: 10, height: 10, background: c.ok ? 'var(--green)' : c.needed ? 'var(--red)' : 'var(--orange)' }} />
      <div className="min-w-0 flex-1">
        <div className="t-body" style={{ fontWeight: 580 }}>{c.name} <span className="c3 t-small" style={{ fontWeight: 450 }}>· {c.detail}</span></div>
        {!c.ok && c.fix && <div className="t-small" style={{ color: c.needed ? 'var(--red)' : 'var(--orange)' }}>{c.fix}</div>}
      </div>
    </div>
  )
  return (
    <section className="mb-8">
      <SectionTitle title="Comprobación" sub="Lo que Mission Control necesita en este PC y si le llegan los datos de cada cuenta" right={<button className="btn btn-sm" onClick={() => setN(n + 1)}>Comprobar ahora</button>} />
      <div className="group">
        {h.data ? [...h.data.tools, ...h.data.readings].map(row) : <div className="row t-small c3">Comprobando…</div>}
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
      toast(`Añadida ${accName(acc.id)}. Ábrela y escribe /login para entrar con su cuenta`)
      setAdding(false); setAlias(''); setDir(''); setEmail('')
      await refresh()
    } catch (e) { toast((e as Error).message) } finally { setBusy(false) }
  }
  return (
    <section className="mb-8">
      <SectionTitle title="Cuentas" sub="Las cuentas de Claude que Mission Control sigue y coordina" right={!adding && <button className="btn btn-sm btn-primary" onClick={() => setAdding(true)}><UserPlus size={13} /> Añadir cuenta</button>} />
      <div className="t-small c3 mb-3">Cómo trabajan los Claude, quién releva a quién y el nombre de cada cuenta se eligen en <b>Relevos</b>.</div>
      <div className="group">
        {(state.accounts ?? []).map((a) => {
          const card = state.agents.find((x) => x.id === a.id)
          return (
            <div key={a.id} className="row">
              <Avatar id={a.id} size={30} />
              <div className="min-w-0 flex-1">
                <div className="t-body" style={{ fontWeight: 580 }}>{accName(a.id)} <span className="c3 t-small" style={{ fontWeight: 450 }}>· {a.alias}{ACCOUNT_NAME[a.id] ? ` · Claude ${a.id.slice(6)}` : ''}</span></div>
                <div className="t-small c3 truncate">{card?.identity.email ?? (card?.identity.hasLogin ? 'con sesión' : 'sin sesión iniciada')} · {a.configDir || '~\\.claude (la de siempre)'}</div>
              </div>
              {card?.state === 'sin-uso' && <Recharge a={card} recharged={state.settings?.recharged} onDone={(t) => { toast(t); void refresh() }} />}
              <Segmented value={(state.settings?.accountStatus?.[a.id] ?? 'uso') as 'uso' | 'pausada' | 'baja'}
                onChange={(v) => void api('setSettings', { accountStatus: { ...(state.settings?.accountStatus ?? {}), [a.id]: v === 'uso' ? undefined : v } }).then(() => refresh())}
                options={[{ value: 'uso', label: 'En uso' }, { value: 'pausada', label: 'No usar' }, { value: 'baja', label: 'De baja' }]} />
              <label className="flex items-center gap-1 t-small c3" title="Claude Code no dice cuánto queda de cada modelo: desmárcalo cuando esta cuenta agote Fable">
                <input type="checkbox" checked={!(state.settings?.noFable ?? []).includes(a.id)} onChange={(e) => { const cur: string[] = state.settings?.noFable ?? []; void api('setSettings', { noFable: e.target.checked ? cur.filter((x) => x !== a.id) : [...cur, a.id] }).then(() => refresh()) }} /> Fable
              </label>
              {project && <button className="btn btn-sm" title="Abre una terminal con esta cuenta (para /login la primera vez)" onClick={() => api('openSession', a.id, project.root).then(() => toast(`Abierta ${accName(a.id)}`), (e) => toast((e as Error).message))}><Terminal size={13} /> Abrir</button>}
              <button className="btn btn-sm btn-ghost" style={{ color: 'var(--red)' }} title="Quitarla de Mission Control" onClick={async () => {
                if (!window.confirm(`¿Quitar ${accName(a.id)} (${a.alias}) de Mission Control?\n\nSu carpeta, su sesión y sus conversaciones se quedan donde están. Se quitan de su settings.json la línea de estado y los hooks de Mission Control (con copia).`)) return
                try { await api('removeAccount', a.id, true); toast(`${accName(a.id)} quitada`); await refresh() } catch (e) { toast((e as Error).message) }
              }}><Trash2 size={13} /></button>
            </div>
          )
        })}
        {(found.data ?? []).map((f) => (
          <div key={f.configDir} className="row">
            <span className="flex items-center justify-center rounded-full shrink-0" style={{ width: 30, height: 30, background: 'color-mix(in srgb, var(--indigo) 16%, transparent)', color: 'var(--indigo)' }}><UserPlus size={15} /></span>
            <div className="min-w-0 flex-1">
              <div className="t-body" style={{ fontWeight: 580 }}>{f.id ? `${accName(f.id)}` : 'Otra cuenta'} <span className="c3 t-small" style={{ fontWeight: 450 }}>· {f.alias} · ya iniciada en este PC</span></div>
              <div className="t-small c3 truncate">{f.email ?? 'con sesión'} · {f.configDir}</div>
            </div>
            <button
              className="btn btn-sm btn-primary"
              disabled={busy}
              onClick={async () => {
                setBusy(true)
                try {
                  const acc = await api<any>('addAccount', { id: f.id, alias: f.alias, configDir: f.configDir, emailExpected: f.email })
                  toast(`Añadida ${accName(acc.id)}: ya tenía su sesión iniciada`)
                  await refresh()
                } catch (e) { toast((e as Error).message) } finally { setBusy(false) }
              }}
            ><Plus size={13} /> Añadir</button>
          </div>
        ))}
        {adding && (
          <div className="p-4 flex flex-col gap-3" style={{ borderTop: '0.5px solid var(--sep)' }}>
            <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
              <label className="flex flex-col gap-1"><span className="t-micro c3">Nombre</span><input className="field" autoFocus placeholder="p. ej. Quinta" value={alias} onChange={(e) => setAlias(e.target.value)} /></label>
              <label className="flex flex-col gap-1"><span className="t-micro c3">Correo de la cuenta (opcional)</span><input className="field" placeholder="para avisar si la carpeta tiene otra" value={email} onChange={(e) => setEmail(e.target.value)} /></label>
            </div>
            <div className="flex flex-col gap-1">
              <span className="t-micro c3">Carpeta de configuración</span>
              <div className="flex gap-2">
                <input className="field flex-1" placeholder={`Vacía: se crea ~\\.claude-${alias.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'nombre'}`} value={dir} onChange={(e) => setDir(e.target.value)} />
                <button className="btn btn-sm" style={{ height: 32 }} onClick={() => api<string | undefined>('chooseFolder', 'Carpeta de la cuenta').then((f) => f && setDir(f))}><FolderOpen size={13} /> Elegir</button>
              </div>
              <span className="t-small c3">Cada cuenta necesita su propia carpeta: ahí guarda su sesión. La primera vez, ábrela y escribe /login.</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="t-micro c3 mr-2">Color</span>
              {COLORS.map((c) => <button key={c} className="w-6 h-6 rounded-full border-0" style={{ background: c, boxShadow: color === c ? '0 0 0 2px var(--bg-elev), 0 0 0 4px ' + c : undefined }} onClick={() => setColor(c)} aria-label={c} />)}
            </div>
            <div className="flex gap-2">
              <button className="btn btn-primary btn-sm" disabled={busy || !alias.trim()} onClick={() => void add()}><Plus size={13} /> Añadir</button>
              <button className="btn btn-sm" onClick={() => setAdding(false)}>Cancelar</button>
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
const SIZES: { v: number; label: string }[] = [{ v: 1, label: 'Pequeña' }, { v: 1.1, label: 'Normal' }, { v: 1.25, label: 'Grande' }, { v: 1.4, label: 'Muy grande' }, { v: 1.6, label: 'Enorme' }]
function TextSize() {
  const { state, toast } = useStore()
  const cur = useAsync(() => api<number>('uiScale'), [state?.settings.uiScale])
  const on = cur.data ?? state?.settings.uiScale ?? 1.1
  const pick = (v: number) => void api('setSettings', { uiScale: v }).then(() => { cur.reload(); toast(`Letra: ${SIZES.find((s) => s.v === v)?.label.toLowerCase()} (${Math.round(v * 100)} %)`) })
  return (
    <div className="group p-5 mb-3 flex flex-col gap-3">
      <div className="flex items-baseline gap-3 flex-wrap"><span className="t-head">Tamaño de la letra</span><span className="t-small c3">Todo crece a la vez: texto, botones y fotos. Desde cualquier pantalla: <span className="kbd">Ctrl +</span> <span className="kbd">Ctrl −</span> y <span className="kbd">Ctrl 0</span> para volver al de serie.</span></div>
      <div className="flex gap-2 flex-wrap" role="radiogroup" aria-label="Tamaño de la letra">
        {SIZES.map((s) => {
          const sel = Math.abs(on - s.v) < 0.01
          return (
            <button key={s.v} role="radio" aria-checked={sel} onClick={() => pick(s.v)} className="flex flex-col items-center justify-center gap-1 rounded-xl border-0 px-4 py-2.5"
              style={{ minWidth: 104, background: sel ? 'var(--accent)' : 'var(--fill)', color: sel ? 'white' : 'var(--label)', boxShadow: sel ? '0 4px 14px color-mix(in srgb, var(--accent) 35%, transparent)' : undefined }}>
              <span style={{ fontSize: Math.round(13 * s.v), fontWeight: 700, lineHeight: 1 }}>Aa</span>
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
      <SectionTitle title="Recargas regaladas" sub="La recarga de 5 horas que Claude Code da a algunas cuentas una vez por semana (/limit-reset). La app la encuentra sola en la ventana de la cuenta cuando llega a su límite" />
      <div className="group p-5 flex flex-col gap-4">
        <div className="flex items-center gap-4 flex-wrap"><span className="w-44 c2">Qué hace la app</span>
          <Segmented value={mode} onChange={(x) => void api('setSettings', { smartRecharge: x }).then(() => toast(x === 'sola' ? 'La usará sola en el mejor momento' : x === 'avisar' ? 'Te avisará en el mejor momento' : 'No tocará las recargas'))}
            options={[{ value: 'sola', label: 'Usarla sola en el mejor momento' }, { value: 'avisar', label: 'Avisarme' }, { value: 'no', label: 'No tocarlas' }]} />
        </div>
        <div className="t-small c3 leading-relaxed">El mejor momento: la cuenta está parada por su límite de 5 horas, queda trabajo, ninguna otra de su rueda puede seguir y le faltan más de 45 min para volver sola (si caduca antes de la próxima ocasión, se usa igual). Y solo si merece la pena según la previsión de la rueda (el ritmo real de cada cuenta): si las demás tienen horas de trabajo hasta que esta vuelva sola, o lo que queda de la agenda cabe en ellas, se guarda. Nunca compra nada: solo confirma una pantalla que hable de la recarga; si habla de créditos o de pago, no la toca y lo apunta.</div>
        <div className="flex flex-col gap-2">
          {agents.map((a) => {
            const x = v.data?.[a.id]
            const r = x?.record
            const line = !r ? 'Aún no se sabe: se mira en su ventana la próxima vez que llegue a su límite'
              : r.available ? `Tiene recarga${r.kinds?.length ? ` (${r.kinds.join(', ')})` : ' de 5 horas'}${r.left != null ? ` · ${r.left} ${r.left === 1 ? 'queda' : 'quedan'}` : ''}${r.useBy ? ` · hasta ${r.useBy}` : ''}`
              : r.usedAt ? `Usada ${ago(r.usedAt, now)}` : 'Sin recarga disponible ahora'
            const can = r?.available && a.state === 'sin-uso'
            return (
              <div key={a.id} className="flex items-center gap-3 px-3.5 py-2.5 rounded-xl" style={{ background: 'var(--bg-elev-2)' }}>
                <Avatar id={a.id} size={28} />
                <div className="min-w-0 flex-1">
                  <div className="t-body" style={{ fontWeight: 600 }}>{accName(a.id)} <span className="t-small c3" style={{ fontWeight: 450 }}>· {line}{a.state === 'apartada' ? ' · apartada: solo se informa, nunca se usa' : ''}</span></div>
                  {r?.available && x?.decision && <div className="t-small" style={{ color: x.decision.action === 'usar' ? 'var(--green)' : 'var(--label-3)' }}>{x.decision.action === 'usar' ? 'Es el momento: se usa ya' : `Ahora no: ${x.decision.why}`}</div>}
                </div>
                {a.state === 'sin-uso' ? <button className="btn btn-sm" title="Lee su ventana por si Claude Code ofrece una recarga" onClick={() => void api('lookRecharge', a.id).then((o: any) => { v.reload(); toast(o ? (o.available ? 'Tiene una recarga a mano' : 'Claude Code dice que no tiene') : 'Su ventana no dice nada de recargas') })}>Mirar su ventana</button>
                  : a.state !== 'trabajando' && <button className="btn btn-sm" title="Escribe /limit-reset en su ventana parada, lee qué recargas tiene y sale con Esc: no usa ninguna" onClick={() => void api<string>('probeRecharge', a.id).then((t) => { v.reload(); toast(`: ${t}`) })}>Revisar sin usar</button>}
                {can && <button className="btn btn-sm btn-primary" title="Escribe /limit-reset en su ventana y confirma la recarga" onClick={() => void api<string>('useRecharge', a.id).then((t) => { v.reload(); toast(t === 'hecho' ? `${accName(a.id)} recargada: sigue trabajando` : `No se ha usado: ${t}`) })}>Usarla ya</button>}
              </div>
            )
          })}
        </div>
      </div>
    </section>
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
  const pile = { sobra: { label: 'Sobra seguro', color: 'var(--green)', hint: 'se vuelve a generar sola: se podrá borrar del todo' }, dudoso: { label: 'Dudoso', color: 'var(--orange)', hint: 'se apartará (sin borrar) y se vigilará' }, queda: { label: 'Se queda', color: 'var(--label-3)', hint: 'se usa, es reciente o tiene nota tuya' } } as const
  const items = (v.data?.items ?? []) as { path: string; rel: string; copy: string; size: number; pile: keyof typeof pile; why: string }[]
  return (
    <section className="mb-8" id="limpieza">
      <SectionTitle title="Limpieza" sub="Lo que ocupa el proyecto y sus copias, en tres montones. Nada se borra a ciegas: lo que sobra va a la papelera de Windows y lo dudoso se aparta, con vuelta atrás" right={<button className="btn btn-sm" disabled={v.data?.running} onClick={() => void api('cleanupStart', pid).then(() => setTick((x) => x + 1))}>{v.data?.running ? `Midiendo… (${v.data.scanned} archivos)` : 'Medir ahora'}</button>} />
      <div className="group p-5 flex flex-col gap-4">
        {(!v.data || v.data.never) && <div className="t-small c3">Aún sin medir. Tarda unos minutos en los proyectos grandes y no frena la app.</div>}
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
        <div className="flex items-center gap-4 flex-wrap"><span className="c2">Borrado inteligente</span><Segmented value={smart ? 'si' : 'no'} onChange={(x) => void api('setSettings', { smartClean: { ...(state?.settings.smartClean ?? {}), [pid]: x === 'si' } })} options={[{ value: 'no', label: 'No: solo cuando yo pulse' }, { value: 'si', label: 'Sí: lo apartado que nadie pida, a la papelera' }]} /></div>
        {(v.data?.aside ?? []).length > 0 && (<div className="flex flex-col gap-1.5"><b className="t-small c2">Apartado ({(v.data.aside as any[]).length}) · vuelve solo si una tarea lo nombra; si nadie lo pide en 4 semanas{smart ? ', a la papelera' : ', se queda apartado'}</b>{(v.data.aside as { from: string; name: string; size: number; at: number; why: string }[]).map((a) => (<div key={a.from} className="flex items-center gap-3 t-small min-w-0"><span className="num flex-none w-16 text-right">{size(a.size)}</span><span className="min-w-0 flex-1 truncate" title={a.from}>{a.name} <span className="c3">· {a.why}</span></span><button className="btn btn-sm flex-none" onClick={() => void api<string>('cleanupRestore', pid, a.from).then((r) => { toast(`Devuelto: ${r}`); setTick((t) => t + 1) }, (e) => toast((e as Error).message))}>Devolver</button></div>))}</div>)}
        {items.filter((x) => x.pile !== 'queda').slice(0, 14).map((x) => (
          <div key={x.path} className="flex items-center gap-3 t-small min-w-0">
            <span className="dot flex-none" style={{ background: pile[x.pile].color }} />
            <span className="num flex-none w-16 text-right" style={{ fontWeight: 650 }}>{size(x.size)}</span>
            <span className="min-w-0 flex-1"><span className="block truncate" style={{ fontWeight: 600 }} title={x.path}>{x.rel}</span><span className="block truncate c3">{x.copy} · {x.why}</span></span>
            {x.pile === 'sobra' ? <button className="btn btn-sm flex-none" title="A la papelera de Windows: se puede recuperar desde ahí" onClick={() => void api<string>('cleanupTrash', pid, x.path).then((r) => { toast(`A la papelera: ${r}`); setTick((t) => t + 1) }, (e) => toast((e as Error).message))}>A la papelera</button>
              : <button className="btn btn-sm flex-none" title="Se mueve a una carpeta de Mission Control con su ficha; se devuelve con un clic" onClick={() => void api<string>('cleanupAside', pid, x.path).then((r) => { toast(`Apartado: ${r}`); setTick((t) => t + 1) }, (e) => toast((e as Error).message))}>Apartar</button>}
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
  const back = (ref: string) => void api('addInstruction', { projectId: pid, kind: 'mensaje', body: `El usuario quiere recuperar lo retirado en ${ref}: vuelve a ponerlo como estaba (está en esa rama o etiqueta de git), comprueba con pmc verifica que todo sigue bien y apúntalo en docs/DECISIONS.md.` }).then(() => toast('Pedido: lo hará el Claude que trabaje en el proyecto'), (e) => toast((e as Error).message))
  return (
    <section className="mb-8" id="rumbo">
      <SectionTitle title="Rumbo" sub={`Lo que se ha quitado de ${name} porque dijiste que ya no lo querías, y cuándo se repasó por última vez`} />
      <div className="group p-5 flex flex-col gap-3">
        <div className="t-small c2">{r.data?.lastReview ? `Último repaso: ${ago(r.data.lastReview, now)}.` : 'Aún no se ha repasado.'} Cada semana, el Claude que trabaja aquí lo repasa: solo quita lo que dijiste claramente que no quieres (con vuelta atrás) y lo dudoso te lo pregunta en Decidir.</div>
        {(r.data?.items ?? []).length === 0 && <div className="t-small c3">No se ha retirado nada.</div>}
        {(r.data?.items ?? []).map((x) => (
          <div key={x.ref} className="flex items-center gap-3 t-small min-w-0">
            <span className="min-w-0 flex-1"><b className="block truncate">{x.ref.replace(/^retirado\//, '')}</b><span className="block truncate c3">{x.subject} · {ago(x.at, now)}</span></span>
            <button className="btn btn-sm flex-none" onClick={() => back(x.ref)}>Recuperar</button>
          </div>
        ))}
      </div>
    </section>
  )
}
const SETTINGS_TABS = [{ id: 'general', label: 'General' }, { id: 'cuentas', label: 'Cuentas' }, { id: 'proyecto', label: 'Proyecto' }, { id: 'avisos', label: 'Avisos y móvil' }, { id: 'comprobacion', label: 'Comprobación' }, { id: 'copias', label: 'Copias de seguridad' }]

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
      toast(on ? `Lectura de consumo activada en ${id}${r.backup ? ' (copia guardada)' : ''}` : `Quitada de ${id}`)
      await refresh()
    } catch (e) { toast((e as Error).message) } finally { setBusy(undefined) }
  }
  const hooks = async (id: string, on: boolean) => {
    setBusy('h' + id)
    try {
      await api(on ? 'hooksInstall' : 'hooksUninstall', id)
      toast(on ? `Coordinación activada en ${accName(id)}: se nota desde su próxima sesión` : `Coordinación quitada de ${accName(id)}`)
      await refresh()
    } catch (e) { toast((e as Error).message) } finally { setBusy(undefined) }
  }
  return (
    <div className="content-inner max-w-[980px]">
      {/* The title first, as on every other screen (EV18: it sat under the phone and sound cards, halfway down). */}
      <h1 className="t-display mb-7 flex items-center gap-3"><ScreenIcon route="ajustes" />Ajustes</h1>
      <div className="mb-7 overflow-x-auto" style={{ scrollbarWidth: 'none' }}>
        <Segmented value={tab} onChange={(v) => { setTab(v); try { localStorage.setItem('pmc.ajustes', v) } catch { /* private */ } }} options={SETTINGS_TABS.map((t) => ({ value: t.id, label: t.label }))} />
      </div>
      {/* EV87: the look of the app first, all in sight (the user, 13-11: «una gran variedad de temas»). */}
      {tab === 'general' && (<>
      <section className="mb-8" id="apariencia">
        <SectionTitle title="Apariencia" sub="Elige tamaño, color y estilo: se ve al momento" />
        <TextSize />
        {/* EV131: the shape first (where everything is), then the colours on top of it. */}
        <div className="group p-5 mb-4" id="forma">
          <div className="t-head mb-1">Forma de la app</div>
          <div className="t-small c3 mb-3">Dónde está cada cosa y cómo te mueves. Son las mismas pantallas y los mismos datos: cambia cuando quieras sin perder nada, y los colores de abajo valen para todas.</div>
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
        <SectionTitle title="Comportamiento" />
        <div className="group p-5 flex flex-col gap-4">
          <div className="flex items-center gap-4 flex-wrap"><span className="w-44 c2">Si nadie contesta un «1. Yes / 2. No»</span><Segmented value={state.settings.awayPolicy ?? 'todo'} onChange={(v) => set({ awayPolicy: v })} options={[{ value: 'todo', label: 'Pulsar 1 (sí)' }, { value: 'seguro', label: 'Sí, menos lo arriesgado' }, { value: 'esperar', label: 'Esperarme' }]} /><span className="c3 t-small">a los</span><Segmented value={String(state.settings.awayMinutes ?? 3)} onChange={(v) => set({ awayMinutes: Number(v) })} options={[{ value: '1', label: '1 min' }, { value: '3', label: '3 min' }, { value: '10', label: '10 min' }]} /></div>
          <div className="flex items-center gap-4"><span className="w-44 c2">Reducir movimiento</span><Segmented value={state.settings.reduceMotion} onChange={(v) => set({ reduceMotion: v })} options={[{ value: 'system', label: 'Como Windows' }, { value: 'on', label: 'Sí' }, { value: 'off', label: 'No' }]} /></div>
        </div>
      </section>
      </>)}
      {tab === 'cuentas' && (<>
      <section className="mb-8">
        <SectionTitle title="Lectura de consumo (statusLine)" sub="Así llegan el % de 5 horas y semanal, con sus reinicios, sin pedir nada a Anthropic ni gastar uso" />
        <div className="group p-5">
          <div className="t-small c2 mb-4 leading-relaxed">
            Añade a la configuración de cada cuenta (settings.json de su carpeta) una línea de estado oficial de Claude Code que guarda los porcentajes en {state.dataDir}\usage y sigue mostrando una línea útil en la terminal: cuenta, modelo, contexto, 5 h y semana. Antes se guarda una copia del archivo. Si la cuenta ya tenía su propia línea de estado, se conserva y se muestra encima. Ojo: con una línea de estado propia, Claude Code oculta algunas pistas de teclado del pie («esc to interrupt»). Los datos llegan tras la primera respuesta de cada sesión.
          </div>
          {!state.nodeExe && <div className="t-small mb-3" style={{ color: 'var(--red)' }}>No se encuentra Node.js: hace falta para la línea de estado.</div>}
          <div className="flex flex-col gap-2">
            {state.agents.map((a) => {
              const sl = state.statusLine[a.id]
              return (
                <div key={a.id} className="flex items-center gap-3 px-3.5 py-2.5 rounded-xl" style={{ background: 'var(--bg-elev-2)' }}>
                  <Avatar id={a.id} size={28} />
                  <div className="min-w-0 flex-1">
                    <div className="t-body" style={{ fontWeight: 580 }}>{accName(a.id)} <span className="c3 t-small" style={{ fontWeight: 450 }}>· {sl.file}</span></div>
                    <div className="t-small c3 truncate">{sl.ours ? (a.usage.snapshot ? `Activa · última lectura ${ago(a.usage.snapshot.capturedAt)}` : 'Activa · esperando la primera respuesta de una sesión') : sl.installed ? `Tiene otra línea de estado: ${sl.command}` : 'No activada'}</div>
                  </div>
                  {sl.ours
                    ? <button className="btn btn-sm" disabled={busy === a.id} onClick={() => install(a.id, false)}>Quitar</button>
                    : <button className="btn btn-sm btn-primary" disabled={busy === a.id || !state.nodeExe} onClick={() => install(a.id, true)}>Activar</button>}
                </div>
              )
            })}
          </div>
          <div className="t-small c3 mt-3">Las copias de los settings.json quedan en {state.dataDir}\backups\config. Para ver el consumo en la web: claude.ai › Ajustes › Uso.</div>
        </div>
      </section>
      <section className="mb-8">
        <SectionTitle title="Coordinación entre los Claude (hooks)" sub="Que las instrucciones lleguen solas y nadie repita una tarea" />
        <div className="group p-5">
          <div className="t-small c2 mb-4 leading-relaxed">
            Añade a cada cuenta unos hooks oficiales de Claude Code. Al empezar una sesión, ese Claude recibe tus instrucciones pendientes y la lista de tareas reservadas por otros; al terminar cada turno, mantiene vivas sus reservas.
            Además se apuntan las sesiones abiertas, los límites y los archivos que escribe. Se suman a los hooks que ya hubiera (los que ya tuviera cada proyecto siguen igual), se guarda copia del settings.json y se quitan con un clic. No gastan uso.
          </div>
          <div className="flex flex-col gap-2">
            {state.agents.map((a) => {
              const on = state.hooks?.[a.id]
              return (
                <div key={a.id} className="flex items-center gap-3 px-3.5 py-2.5 rounded-xl" style={{ background: 'var(--bg-elev-2)' }}>
                  <Avatar id={a.id} size={28} />
                  <div className="min-w-0 flex-1">
                    <div className="t-body" style={{ fontWeight: 580 }}>{accName(a.id)}</div>
                    <div className="t-small" style={{ color: state.hooksOutdated?.[a.id] ? 'var(--orange)' : 'var(--label-3)' }}>{on ? (state.hooksOutdated?.[a.id] ? 'Activa, con una versión anterior: actualízala' : 'Activa y al día') : 'No activada'}</div>
                  </div>
                  {on && state.hooksOutdated?.[a.id] && <button className="btn btn-sm btn-primary" disabled={busy === 'h' + a.id} onClick={() => hooks(a.id, true)}>Actualizar</button>}
                  {on
                    ? <button className="btn btn-sm" disabled={busy === 'h' + a.id} onClick={() => hooks(a.id, false)}>Quitar</button>
                    : <button className="btn btn-sm btn-primary" disabled={busy === 'h' + a.id || !state.nodeExe} onClick={() => hooks(a.id, true)}>Activar</button>}
                </div>
              )
            })}
          </div>
          <div className="t-small c3 mt-3">Los agentes pueden reservar tareas con <b>pmc claim &lt;ID&gt;</b> y liberarlas con <b>pmc release &lt;ID&gt;</b> (el programa está en {state.dataDir}\bin\pmc.mjs).</div>
        </div>
      </section>
      </>)}
      {tab === 'proyecto' && (<>
      {p && (
        <section className="mb-8">
          <SectionTitle title={`Proyecto · ${p.name}`} sub={p.root} right={<button className="btn btn-sm" onClick={() => api('addProject').then((r: any) => r && refresh())}><Plus size={13} /> Añadir proyecto</button>} />
          <div className="mb-3"><ProjectBrain projectId={p.id} /></div>
          <div className="mb-3"><NewProject /></div>
          <div className="group p-5 flex flex-col gap-4">
            <label className="flex items-start gap-3">
              <input type="checkbox" className="mt-1 accent-[var(--accent)]" checked={p.allowBuzon} onChange={(e) => api('updateProject', p.id, { allowBuzon: e.target.checked }).then(() => { refresh(); toast(e.target.checked ? 'Permitido escribir en el Buzón' : 'Buzón en solo lectura') })} />
              <span>
                <span className="t-body" style={{ fontWeight: 580 }}>Permitir escribir en el Buzón</span>
                <span className="t-small c3 block">Las instrucciones que entregues se añaden bajo «Apuntes nuevos» de {p.root}\docs\Buzón.md (con copia previa). Es lo único que Mission Control escribiría en el proyecto; los agentes lo leen al empezar cada bloque.</span>
              </span>
            </label>
            <div>
              <div className="t-micro c3 mb-1">Copias detectadas</div>
              {p.copies.map((c) => <div key={c.path} className="t-small c2">{c.label} · {c.branch ?? '—'} · <span className="c3">{c.path}</span></div>)}
            </div>
            <div>
              <div className="t-micro c3 mb-1">Carpetas de la galería</div>
              <div className="t-small c3 mb-2">De aquí sale lo que ves en la Galería. Si falta algo, añade su carpeta.</div>
              {p.mediaDirs.map((d) => (
                <div key={d} className="flex items-center gap-2 py-0.5">
                  <span className="t-small c2 break-all flex-1 min-w-0 selectable">{d}</span>
                  <button className="btn btn-sm btn-ghost flex-none" title="La Galería dejará de mirar aquí; los archivos no se tocan" onClick={() => void api('removeMediaFolder', p.id, d).then(() => { void refresh(); toast('Carpeta quitada de la Galería: los archivos siguen en su sitio') }, (e) => toast((e as Error).message))}><Trash2 size={12} /> Quitar</button>
                </div>
              ))}
              <button className="btn btn-sm mt-2" onClick={() => void api('addMediaFolder', p.id).then((r) => { if (r) { void refresh(); toast('Carpeta añadida: los archivos irán apareciendo') } }, (e) => toast((e as Error).message))}><Plus size={13} /> Añadir carpeta</button>
            </div>
          </div>
        </section>
      )}
      </>)}
      {tab === 'proyecto' && p && <CleanupSection pid={p.id} />}
      {tab === 'proyecto' && p && <CourseSection pid={p.id} name={p.name} />}
      {tab === 'copias' && (<>
      <section className="mb-8">
        <SectionTitle title="Datos y copias de seguridad" />
        <div className="group p-5 flex flex-col gap-3">
          <div className="t-small c2">Todo lo de Mission Control vive en <b className="selectable">{state.dataDir}</b>: base de datos (mission.db), lecturas de consumo, miniaturas y copias. Se hace una copia de la base de datos al día (se guardan 14). Actualizar la aplicación no borra estos datos.</div>
          <div className="flex gap-2">
            <button className="btn btn-sm" onClick={() => api<string>('backupNow').then((f) => toast(`Copia hecha: ${f.split('\\').pop()}`))}><HardDriveDownload size={13} /> Copia ahora</button>
            <button className="btn btn-sm" onClick={() => api('openDataDir')}><FolderOpen size={13} /> Abrir carpeta</button>
          </div>
          <Restore />
        </div>
      </section>
      </>)}
      {/* EV157 (the user, 14-11 12:35: «añadir… en la app, mi buymeacoffee, por si quieren apoyarme»): discreet, at the end. */}
      <div className="t-small c3 mt-10 mb-4 flex flex-wrap items-center gap-x-3 gap-y-1">
        <span>Mission Control es de código abierto.</span>
        <button className="btn-link" onClick={() => void api('openExternal', 'https://github.com/PAKITRON5000/pakitron-mission-control')}>Su página en GitHub</button>
        <span aria-hidden>·</span>
        <button className="btn-link" onClick={() => void api('openExternal', 'https://buymeacoffee.com/pakitron.exe')}>¿Te ayuda? Invita a un café al autor</button>
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
      <summary className="t-small c3 cursor-pointer">Restaurar una copia anterior</summary>
      <div className="flex flex-col gap-1 mt-2">
        {(list.data ?? []).map((b) => (
          <div key={b.name} className="flex items-center gap-2 t-small">
            <span className="c2 flex-1">{new Date(b.at).toLocaleString('es-ES', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })} · {(b.bytes / 1e6).toFixed(1).replace('.', ',')} MB</span>
            <button className="btn btn-sm btn-ghost" onClick={() => void api<{ restored: boolean }>('restoreBackup', b.name).then((r) => { if (r.restored) toast('Reiniciando con la copia…') }, (e) => toast((e as Error).message))}><RotateCcw size={12} /> Restaurar</button>
          </div>
        ))}
        {open && list.data && !list.data.length && <div className="t-small c3">Aún no hay copias.</div>}
        <div className="t-small c3">Antes de restaurar te lo pregunta y guarda una copia de cómo está ahora. Tus proyectos y sus archivos no se tocan.</div>
      </div>
    </details>
  )
}
