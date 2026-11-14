// What the app understands of the active project, in plain words, with one button to create what it lacks; and
// «Crear proyecto» (the user, 12-11: «que la app entienda sola cómo funciona cada proyecto… ayudar a crear cualquier tipo
// de proyectos»). The reading is core/profile.ts; nothing here writes without the user pressing a button.
import { useState } from 'react'
import { Bot, Check, FolderPlus, Minus, Plug, Sparkles, Wand2, X } from 'lucide-react'
import { useAsync, useStore } from '../lib/store'
import { api } from '../lib/api'
import { SectionTitle, accName } from './ui'
import { TEMPLATES, type TemplateId } from '../../../core/templates'

interface Profile {
  name: string
  summary: string
  kindLabels: string[]
  mediaDirs: string[]
  root: string
  checks: { nombre: string; orden: string }[]
  heavy: string[]
  docs: { tasks: boolean; relevo: boolean; state: boolean; decisions: boolean; cadaSesion: boolean; pmcJson: boolean; agents: string[]; skill?: boolean; card?: boolean }
  skills: string[]
  agents: { name: string; model: string; description: string; present: boolean; uses?: number }[]
  skillUses?: { name: string; n: number }[]
  mcp?: { name: string; label: string; where: 'proyecto' | 'cuenta' | 'carpeta' | 'conector'; accounts: string[]; uses?: number }[]
  bigReads?: { file: string; name: string; kb: number; n: number }[]
  projectHooks?: boolean
}

const RESOURCE: Record<string, string> = { unity: 'Unity', gpu: 'la tarjeta gráfica', unreal: 'Unreal', build: 'el ejecutable' }

/** `neutral`: neither done nor missing, just how it is (13-11: «Aún no hay imágenes» had an orange ✗ in Mission Control). */
function Item({ ok, neutral, children }: { ok: boolean; neutral?: boolean; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2 t-small py-0.5">
      <span className="flex-none mt-0.5" style={{ color: neutral ? 'var(--label-3)' : ok ? 'var(--green)' : 'var(--orange)' }}>{neutral ? <Minus size={13} /> : ok ? <Check size={13} /> : <X size={13} />}</span>
      <span className={ok || neutral ? 'c2' : ''}>{children}</span>
    </div>
  )
}

const WHERE: Record<string, string> = { proyecto: 'del proyecto: la tienen todos', cuenta: 'puesta en la cuenta', carpeta: 'puesta solo en esta carpeta', conector: 'conector de claude.ai' }

/** EV26: the connections to other programs (MCP) the Claude here have, and which they really used in 7 days. */
function McpList({ mcp }: { mcp: NonNullable<Profile['mcp']> }) {
  return (
    <div className="mt-3">
      <div className="t-micro c3 mb-1">Conexiones con otros programas (MCP)</div>
      {mcp.slice(0, 12).map((m) => (
        <div key={m.name} className="flex items-start gap-2 t-small py-0.5" title={m.accounts.length ? `En ${m.accounts.map(accName).join(', ')}` : undefined}>
          <span className="flex-none mt-0.5" style={{ color: m.uses ? 'var(--green)' : 'var(--label-3)' }}><Plug size={13} /></span>
          <span className={m.uses ? 'c2' : 'c3'}><b style={{ fontWeight: 580 }}>{m.label}</b> · {WHERE[m.where]}{m.where === 'cuenta' && m.accounts.length ? ` (${m.accounts.map(accName).join(', ')})` : ''}</span>
          {m.uses !== undefined && <span className="t-small flex-none ml-auto num" style={{ color: m.uses ? 'var(--green)' : 'var(--label-3)' }} title="Veces que algún Claude la ha usado aquí en los últimos 7 días">{m.uses ? `${m.uses} ${m.uses === 1 ? 'uso' : 'usos'}` : 'sin usar'}</span>}
        </div>
      ))}
      {mcp.length > 12 && <div className="t-small c3">y {mcp.length - 12} más</div>}
      <div className="t-small c3 mt-1">Cada conexión añade sus herramientas a la conversación de cada Claude: las que no se usan gastan contexto sin servir.</div>
    </div>
  )
}

export function ProjectBrain({ projectId }: { projectId: string }) {
  const { refresh, toast, state } = useStore()
  const [tick, setTick] = useState(0)
  const [busy, setBusy] = useState(false)
  const prof = useAsync(() => api<Profile>('projectProfile', projectId), [projectId, tick])
  const p = prof.data
  if (!p) return null
  const d = p.docs
  const lacking = [!d.tasks && 'lista de tareas', !d.relevo && 'nota de relevo', !d.state && 'estado', !d.decisions && 'decisiones', !d.cadaSesion && 'instrucciones de cada sesión', !d.pmcJson && p.checks.length > 0 && 'comprobaciones', d.skill === false && 'skill de Mission Control', d.card === false && 'ficha del proyecto (docs/PROYECTO.md)'].filter(Boolean) as string[]
  const missingAgents = p.agents.filter((a) => !a.present)
  // EV52: the accounts in use the app cannot see (no hooks of their own).
  const unseen = (state?.agents ?? []).map((a) => a.id).filter((id) => !state?.settings.accountStatus?.[id] && !state?.hooks?.[id])
  const allSeen = unseen.length === 0
  const prepare = async () => {
    setBusy(true)
    try {
      const made = await api<string[]>('prepareProject', projectId)
      toast(made.length ? `Preparado: ${made.length} ${made.length === 1 ? 'archivo nuevo' : 'archivos nuevos'} (no se ha tocado nada de lo que había)` : 'Ya estaba todo')
      setTick((t) => t + 1)
      await refresh()
    } catch (e) { toast((e as Error).message) } finally { setBusy(false) }
  }
  return (
    <div className="group p-5 flex flex-col gap-4">
      <div className="flex items-start gap-3">
        <span className="flex items-center justify-center rounded-xl flex-none" style={{ width: 36, height: 36, background: 'color-mix(in srgb, var(--indigo) 18%, transparent)', color: 'var(--indigo)' }}><Sparkles size={18} /></span>
        <div className="min-w-0 flex-1">
          <div className="t-body" style={{ fontWeight: 600 }}>{p.summary}</div>
          <div className="t-small c3">Lo que la app entiende leyendo la carpeta. Se repasa sola cada vez que la abres.</div>
        </div>
        {(lacking.length > 0 || missingAgents.length > 0) && (
          <button className="btn btn-sm btn-primary flex-none" disabled={busy} onClick={() => void prepare()}><Wand2 size={13} /> Prepararlo</button>
        )}
      </div>
      <div className="grid gap-4 grid-cols-1 min-[900px]:grid-cols-2">
        <div>
          <div className="t-micro c3 mb-1">Para que varios Claude trabajen sin pisarse</div>
          <Item ok={!lacking.length}>{lacking.length ? `Le falta: ${lacking.join(', ')}` : `Tiene tareas, relevo, estado, decisiones, instrucciones de cada sesión${d.card ? ' y su ficha (docs/PROYECTO.md)' : ''}`}</Item>
          <Item ok={p.checks.length > 0}>{p.checks.length ? `Se comprueba con: ${p.checks.map((c) => c.nombre).join(' y ')}` : 'No se ha encontrado cómo comprobar su trabajo: el primer Claude lo dirá en pmc.json'}</Item>
          {/* EV52 (#140: «quiero que todo sea lo más automático e intuitivo posible»): every account in use has its own hooks,
              and the app puts them itself where they are missing (hooksSweep); the button only when one still lacks them. */}
          <div className="flex items-start gap-2">
            <div className="flex-1 min-w-0"><Item ok={Boolean(p.projectHooks) || allSeen}>{p.projectHooks ? 'Cualquier cuenta que abras aquí se ve en la app (los ganchos están también en el proyecto)' : allSeen ? 'La app ve lo que hace cada una de tus cuentas aquí (y a una cuenta nueva le pone sola lo que necesita)' : `La app aún no ve a ${unseen.map((id) => accName(id)).join(', ')}: lo arregla sola en unos minutos, o ya con este botón`}</Item></div>
            {!p.projectHooks && !allSeen && <button className="btn btn-sm flex-none" disabled={busy} onClick={() => void (async () => { setBusy(true); try { const n = await api<number>('projectHooksInstall', projectId); toast(`Hecho en ${n} ${n === 1 ? 'copia' : 'copias'} del proyecto`); setTick((t) => t + 1) } catch (e) { toast((e as Error).message) } finally { setBusy(false) } })()}>Que se vea cualquier cuenta</button>}
          </div>
          <Item ok={d.skill !== false}>{d.skill !== false ? 'Tiene la skill «mission-control»: cada Claude sabe usar todas las órdenes de pmc' : 'Le falta la skill «mission-control» (cómo usar pmc): «Prepararlo» la crea'}</Item>
          <Item ok>{p.heavy.length ? `Usa ${p.heavy.map((h) => RESOURCE[h] ?? h).join(' y ')}: un trabajo pesado cada vez` : 'Nada que no se pueda compartir: pueden trabajar varios a la vez si las tareas son de partes distintas'}</Item>
          <Item ok={p.mediaDirs.length > 0} neutral={!p.mediaDirs.length}>{p.mediaDirs.length ? `Galería encontrada sola en ${p.mediaDirs.length} ${p.mediaDirs.length === 1 ? 'carpeta' : 'carpetas'}: ${p.mediaDirs.map((m) => m.slice(p.root.length + 1) || 'la raíz').join(', ')}` : 'Aún no hay imágenes, vídeos ni modelos: aparecerán solos cuando los haya'}</Item>
        </div>
        <div>
          <div className="t-micro c3 mb-1">Ayudantes de cada Claude (subagentes)</div>
          {p.agents.map((a) => (
            <div key={a.name} className="flex items-start gap-2 t-small py-0.5" title={a.description}>
              <span className="flex-none mt-0.5" style={{ color: a.present ? 'var(--green)' : 'var(--label-3)' }}><Bot size={13} /></span>
              <span className={a.present ? 'c2' : 'c3'}><b style={{ fontWeight: 580 }}>{a.name}</b> · {a.model} · {a.description.split(/[.:]/)[0].replace(/^Úsalo (por tu cuenta, sin que te lo pidan, )?(para |al |cuando )?/, '')}{a.present ? '' : ' (sin crear)'}</span>
              {a.present && a.uses !== undefined && <span className="t-small flex-none ml-auto num" style={{ color: a.uses ? 'var(--green)' : 'var(--label-3)' }} title="Veces que algún Claude lo ha llamado en los últimos 7 días">{a.uses ? `${a.uses} ${a.uses === 1 ? 'uso' : 'usos'}` : 'sin usar'}</span>}
            </div>
          ))}
          <div className="t-small c3 mt-1">Buscan, comprueban, miran capturas y dejan el relevo con un modelo más barato, sin llenar la conversación principal.</div>
          {p.skillUses && p.skillUses.length > 0 && <div className="t-small c2 mt-2">Skills que se han usado aquí en 7 días: {p.skillUses.slice(0, 10).map((s) => `${s.name} (${s.n})`).join(', ')}</div>}
          {p.skills.length > 0 && (() => {
            // EV26: the installed ones that fit this kind of project, and which of them nobody has used yet.
            const used = new Set((p.skillUses ?? []).map((s) => s.name.split(':').pop()))
            const idle = p.skillUses ? p.skills.filter((s) => !used.has(s)) : []
            return <div className="t-small c3 mt-2">Skills instaladas que le sirven: {p.skills.slice(0, 10).join(', ')}{p.skills.length > 10 ? ` y ${p.skills.length - 10} más` : ''}{idle.length && p.skillUses ? `. Sin usar aquí esta semana: ${idle.slice(0, 8).join(', ')}` : ''}</div>
          })()}
          {p.mcp && p.mcp.length > 0 && <McpList mcp={p.mcp} />}
          {/* EV117: what fills the Claudes' conversations: big files read whole this week. */}
          {p.bigReads && p.bigReads.length > 0 && <div className="t-small c2 mt-3" title={p.bigReads.map((r) => r.file).join('\n')}><b style={{ fontWeight: 600 }}>Archivos grandes leídos enteros esta semana:</b> {p.bigReads.map((r) => `${r.name} (${r.kb} KB, ${r.n} ${r.n === 1 ? 'vez' : 'veces'})`).join(', ')}. Cada lectura entera mete el archivo en la conversación: mejor buscar en él o leer solo un trozo.</div>}
        </div>
      </div>
      <Routines projectId={projectId} />
      <Backup projectId={projectId} />
      <AutonomyHere projectId={projectId} />
    </div>
  )
}

interface RoutineInfo { now: { trasCommit: boolean; noche: boolean; hora: string }; light: number; all: number; heavy: boolean; running: boolean; last: { at: number; kind: string; title: string }[] }

/** Routines (EV44): the project's own checks, run by the app after each commit and at night, without spending a Claude. */
/** EV28: autonomous mode for every project but this one («ahora quiero el relevo, pero igual en otra ocasión no»). */
function AutonomyHere({ projectId }: { projectId: string }) {
  const { state, toast, refresh } = useStore()
  if (!state?.settings.autonomous) return null
  const off = state.settings.autonomyOff ?? []
  const here = !off.includes(projectId)
  const set = (on: boolean) => void api('setSettings', { autonomyOff: on ? off.filter((x) => x !== projectId) : [...off, projectId] }).then(async () => { await refresh(); toast(on ? 'En este proyecto los Claude siguen hasta agotar su uso' : 'En este proyecto los Claude pueden parar al acabar cada respuesta') }, (e) => toast((e as Error).message))
  return (
    <div style={{ borderTop: '0.5px solid var(--sep)' }} className="pt-4">
      <label className="flex items-start gap-2 t-small">
        <input type="checkbox" className="mt-0.5" checked={here} onChange={(e) => set(e.target.checked)} />
        <span><b style={{ fontWeight: 580 }}>Modo autónomo en este proyecto</b>: sus Claude no terminan el turno y siguen hasta agotar su uso; si se quedan sin tareas, piensan qué mejorar aquí y lo apuntan, y si no hay nada, pasan a otro proyecto. Quítalo aquí si en este proyecto prefieres que paren al acabar cada respuesta; los demás proyectos siguen igual.</span>
      </label>
    </div>
  )
}

function Routines({ projectId }: { projectId: string }) {
  const { toast, now } = useStore()
  const [tick, setTick] = useState(0)
  const r = useAsync(() => api<RoutineInfo>('routines', projectId), [projectId, tick, Math.floor(now / 60_000)])
  const x = r.data
  if (!x) return null
  const set = (patch: Partial<RoutineInfo['now']>, said: string) => void api('setRoutine', projectId, patch).then(() => { setTick((t) => t + 1); toast(said) }, (e) => toast((e as Error).message))
  const ago = (ms: number) => { const m = Math.round((now - ms) / 60_000); return m < 60 ? `hace ${Math.max(1, m)} min` : m < 2880 ? `hace ${Math.round(m / 60)} h` : `hace ${Math.round(m / 1440)} días` }
  return (
    <div style={{ borderTop: '0.5px solid var(--sep)' }} className="pt-4">
      <div className="t-micro c3 mb-1">Rutinas: lo que la app hace sola, sin gastar ningún Claude</div>
      {x.all === 0 ? (
        <div className="t-small c3">Sin comprobaciones declaradas no hay nada que repasar solo. «Prepararlo» las propone en pmc.json.</div>
      ) : (
        <div className="flex flex-col gap-2">
          <label className="flex items-start gap-2 t-small">
            <input type="checkbox" className="mt-0.5" checked={x.now.trasCommit} disabled={x.light === 0} onChange={(e) => set({ trasCommit: e.target.checked }, e.target.checked ? 'Se comprobará tras cada commit' : 'Ya no se comprueba tras cada commit')} />
            <span><b style={{ fontWeight: 580 }}>Tras cada commit</b>, pasar las comprobaciones ligeras{x.light ? ` (${x.light})` : ': no tiene ninguna que no necesite Unity o la gráfica'}. Espera a que la copia esté limpia o a que nadie trabaje en ella, para no avisar de un cambio a medias.</span>
          </label>
          <label className="flex items-start gap-2 t-small">
            <input type="checkbox" className="mt-0.5" checked={x.now.noche} onChange={(e) => set({ noche: e.target.checked }, e.target.checked ? `Se comprobará cada noche a las ${x.now.hora}` : 'Ya no se comprueba de noche')} />
            <span><b style={{ fontWeight: 580 }}>Cada noche</b>, a partir de las{' '}
              <input type="time" className="field" style={{ height: 24, padding: '0 4px', width: 84, display: 'inline-block' }} value={x.now.hora} onChange={(e) => e.target.value && set({ hora: e.target.value }, `Rutina de noche a las ${e.target.value}`)} />
              , todas{x.heavy ? ', también las pesadas (si nadie juega ni trabaja ahí y el recurso está libre)' : ''}.</span>
          </label>
          <div className="t-small c3">Solo leen y apuntan el resultado (Inicio › Tus proyectos y la Cronología); nunca cambian ni borran nada. Solo avisan si algo falla.{x.running ? ' Ahora mismo hay una en marcha.' : ''}</div>
          {/* EV118: the same result again and again (each commit) is shown once, the newest, with how many times. */}
          {x.last.filter((e, i, all) => all.findIndex((y) => y.title === e.title) === i).map((e) => { const times = x.last.filter((y) => y.title === e.title).length; return <div key={e.at} className="t-small" style={{ color: e.kind === 'aviso' ? 'var(--red)' : 'var(--label-2)' }}>{ago(e.at)} · {e.title}{times > 1 ? ` (${times} veces)` : ''}</div> })}
        </div>
      )}
    </div>
  )
}

interface BackupInfo { on: boolean; dir: string; hora: string; target: string; running: boolean; last?: { at: number; ok: boolean; summary: string } }

/** EV44: the nightly copy of this project's git history on another disk (Decidir #135). */
function Backup({ projectId }: { projectId: string }) {
  const { toast, now } = useStore()
  const [tick, setTick] = useState(0)
  const r = useAsync(() => api<BackupInfo | undefined>('backupInfo', projectId), [projectId, tick, Math.floor(now / 60_000)])
  const x = r.data
  if (!x) return null
  const set = (patch: { on?: boolean; hora?: string }, said: string) => void api('setBackup', { projectId: patch.on !== undefined ? projectId : undefined, ...patch }).then(() => { setTick((t) => t + 1); toast(said) }, (e) => toast((e as Error).message))
  const ago = (ms: number) => { const m = Math.round((now - ms) / 60_000); return m < 60 ? `hace ${Math.max(1, m)} min` : m < 2880 ? `hace ${Math.round(m / 60)} h` : `hace ${Math.round(m / 1440)} días` }
  return (
    <div style={{ borderTop: '0.5px solid var(--sep)' }} className="pt-4">
      <div className="t-micro c3 mb-1">Copia de seguridad en otro disco</div>
      <label className="flex items-start gap-2 t-small">
        <input type="checkbox" className="mt-0.5" checked={x.on} onChange={(e) => set({ on: e.target.checked }, e.target.checked ? `Se copiará cada noche en ${x.dir}` : 'Este proyecto ya no se copia')} />
        <span><b style={{ fontWeight: 580 }}>Cada noche</b>, a partir de las{' '}
          <input type="time" className="field" style={{ height: 24, padding: '0 4px', width: 84, display: 'inline-block' }} value={x.hora} onChange={(e) => e.target.value && set({ hora: e.target.value }, `Copias de seguridad a las ${e.target.value}`)} />
          , copiar su historial de git en <b style={{ fontWeight: 580 }}>{x.target}</b>. La primera vez entero; después, solo lo nuevo. Nunca borra nada allí; espera si estás jugando o editando vídeo.</span>
      </label>
      <div className="flex items-center gap-3 mt-1 flex-wrap">
        <div className="t-small flex-1 min-w-0" style={{ color: x.last && !x.last.ok ? 'var(--red)' : 'var(--label-2)' }}>
          {x.running ? 'Copiando ahora… (la primera vez puede tardar; se ve aquí al acabar)' : x.last ? `${ago(x.last.at)} · ${x.last.ok ? 'bien' : 'no se pudo'}: ${x.last.summary}` : x.on ? `Aún no se ha hecho ninguna: la primera, esta noche a partir de las ${x.hora}.` : 'Apagada para este proyecto.'}
        </div>
        {!x.running && <button className="btn btn-sm" title="Hace la copia ya, sin esperar a la noche. La primera vez copia todo el historial y puede tardar unos minutos" onClick={() => void api<boolean>('backupNowProject', projectId).then((ok) => { setTick((t) => t + 1); toast(ok ? 'Copiando ahora: lo verás aquí al acabar' : 'Ya hay otra copia en marcha: espera a que acabe') }, (e) => toast((e as Error).message))}>Copiar ahora</button>}
      </div>
    </div>
  )
}

/** «Crear proyecto»: a name and what the user wants; the app makes the folder, prepares it and opens a Claude in it. */
export function NewProject() {
  const { refresh, toast } = useStore()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [desc, setDesc] = useState('')
  const [kind, setKind] = useState<TemplateId>('libre')
  const [busy, setBusy] = useState(false)
  if (!open) return <button className="btn btn-sm" onClick={() => setOpen(true)}><FolderPlus size={13} /> Crear proyecto</button>
  return (
    <div className="group p-5 flex flex-col gap-3 mt-3">
      <SectionTitle title="Proyecto nuevo" sub="Escribe qué quieres hacer, como se lo dirías a una persona. La app crea la carpeta con git, las primeras tareas, el relevo y los ayudantes que encajan, y abre un Claude para que empiece por el plan." />
      <div className="grid gap-2" role="radiogroup" aria-label="Qué tipo de proyecto" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))' }}>
        {TEMPLATES.map((t) => {
          const on = kind === t.id
          return (
            <button key={t.id} role="radio" aria-checked={on} className="text-left rounded-xl p-2.5 border-0 flex flex-col justify-start" onClick={() => setKind(t.id)}
              style={{ background: on ? 'color-mix(in srgb, var(--indigo) 14%, transparent)' : 'var(--fill)', boxShadow: on ? 'inset 0 0 0 1.5px var(--indigo)' : 'none' }}>
              <b className="t-small block" style={{ fontWeight: 600 }}>{t.label}</b>
              <span className="t-small c3 block mt-0.5">{t.sub}</span>
            </button>
          )
        })}
      </div>
      <input className="field" placeholder="Nombre (será el de la carpeta)" value={name} onChange={(e) => setName(e.target.value)} />
      <textarea className="field" rows={4} placeholder="Qué quieres: «Un juego de plataformas en 2D para móvil con…», «Una web para mi tienda que…»" value={desc} onChange={(e) => setDesc(e.target.value)} />
      <div className="flex gap-2">
        <button className="btn btn-sm btn-primary" disabled={busy || !name.trim() || desc.trim().length < 10} onClick={async () => {
          setBusy(true)
          try {
            const r = await api<{ account?: string } | undefined>('createProject', { name, description: desc, template: kind })
            if (r) { toast(r.account ? `Creado. ${accName(r.account)} empieza por el plan y te lo enseñará en Decidir` : 'Creado. Ninguna cuenta tiene uso ahora: lánzala desde Próximo cuando vuelva'); setOpen(false); setName(''); setDesc(''); setKind('libre'); await refresh() }
          } catch (e) { toast((e as Error).message) } finally { setBusy(false) }
        }}><Sparkles size={13} /> Crear y empezar</button>
        <button className="btn btn-sm btn-ghost" onClick={() => setOpen(false)}>Cancelar</button>
      </div>
    </div>
  )
}
