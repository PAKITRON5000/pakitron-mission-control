import { useEffect, useState } from 'react'
import { Puzzle, Search, Download, Trash2, ExternalLink, FolderOpen, Sparkles, ShieldAlert } from 'lucide-react'
import { useStore, useAsync } from '../lib/store'
import { api } from '../lib/api'
import { Avatar, Empty, Segmented, accName } from '../components/ui'
import { whenFull } from '../lib/format'

interface SkillInfo { name: string; description: string; scope: 'proyecto' | 'cuenta' | 'plugin'; accounts: string[]; projects: string[]; dir: string; source?: string; updatedAt?: number }
interface Found { id: string; skill: string; source: string; installs: number; url?: string; term: string; description?: string }
interface SkillsView { es: Record<string, string>; installed: SkillInfo[]; uses: Record<string, number>; usesEverywhere?: Record<string, number>; countedEverywhere?: boolean; aside?: string[]; onlyIn?: Record<string, string>; moved?: { name: string; projectId: string; at: number }[]; usesAt?: number; kinds: string[]; summary?: string; terms: string[]; suggestions: Found[]; searchedAt?: number }

const err = (e: unknown) => (e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
const fmt = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1).replace('.', ',')} mil` : String(n))

/**
 * Skills (EV62, the user asked for it and it was never done): instructions the Claudes load when they need them. What is
 * installed for this project and for the accounts, what each is for and how much it is used here, and suggestions found
 * on skills.sh for what the project is, to install with a click.
 */
export function Skills() {
  const { state, toast } = useStore()
  const pid = state?.activeProjectId
  const project = state?.projects.find((p) => p.id === pid)
  const [busy, setBusy] = useState<string>()
  const [tab, setTab] = useState<'aqui' | 'cuentas' | 'plugins'>('aqui')
  // The uses are counted in the background (gigabytes of conversations): asked again until every project is counted.
  const [tick, setTick] = useState(0)
  const v = useAsync(() => (pid ? api<SkillsView>('skills', pid) : Promise.resolve(undefined)), [pid, tick])
  useEffect(() => {
    if (!v.data || v.data.countedEverywhere) return
    const t = setTimeout(() => setTick((n) => n + 1), 15_000)
    return () => clearTimeout(t)
  }, [v.data])
  if (!state || !project) return null
  const data = v.data
  const run = async (key: string, fn: () => Promise<unknown>, ok: string) => {
    setBusy(key)
    try { await fn(); v.reload(); toast(ok) } catch (e) { toast(err(e)) } finally { setBusy(undefined) }
  }
  const mine = (data?.installed ?? []).filter((s) => s.scope === 'proyecto' && s.projects.includes(project.id))
  const accounts = (data?.installed ?? []).filter((s) => s.scope === 'cuenta')
  const plugins = (data?.installed ?? []).filter((s) => s.scope === 'plugin')
  // What it does, in Spanish when a session has written it (pmc skills-es), else as its author wrote it.
  const say = (name: string, original?: string) => data?.es[name.replace(/^.*:/, '')] ?? original
  const uses = (name: string) => data?.uses[name] ?? data?.uses[name.replace(/^.*:/, '')] ?? 0
  const list = tab === 'aqui' ? mine : tab === 'cuentas' ? accounts : plugins
  const usedHere = [...mine, ...accounts, ...plugins].filter((s) => uses(s.name) > 0).sort((a, b) => uses(b.name) - uses(a.name))
  // EV95: every skill a session can load adds its name and description to the fixed context of every session; per
  // account in use, what this project's sessions carry (about 4 characters per token), and which were not used this week.
  const tokensOf = (s: SkillInfo) => Math.ceil((s.name.length + s.description.length + 12) / 4)
  const weight = state.agents.filter((a) => a.state !== 'baja' && a.state !== 'apartada').map((a) => {
    const set = [...mine, ...accounts.filter((s) => s.accounts.includes(a.id)), ...plugins.filter((s) => !s.accounts.length || s.accounts.includes(a.id))]
    return { id: a.id, n: set.length, tokens: set.reduce((t, s) => t + tokensOf(s), 0) }
  })
  // EV118: «mission-control» is used through pmc, without loading the skill: never «sin usar».
  const idle = data?.usesAt ? [...mine, ...accounts].filter((s) => uses(s.name) === 0 && s.name.replace(/^.*:/, '') !== 'mission-control') : []
  // EV95: only what no project used this week can be set aside (an account's skills serve all its projects).
  const nowhere = data?.countedEverywhere ? accounts.filter((s) => !(data.usesEverywhere?.[s.name] ?? data.usesEverywhere?.[s.name.replace(/^.*:/, '')])) : []

  return (
    <div className="content-inner max-w-[1240px]">
      <h1 className="t-display flex items-center gap-3"><span className="icon-sq icon-sq-lg" style={{ background: 'var(--pink)' }}><Puzzle size={16} /></span>Skills<span className="c3" style={{ fontWeight: 450 }}>· {project.name}</span></h1>
      <div className="t-head c2 mt-2 mb-6" style={{ fontWeight: 450 }}>Conocimientos que los Claude cargan cuando les hacen falta (cómo modelar en Blender, cómo usar Unity…). Aquí ves los que hay, cuánto se usan en {project.name} y cuáles le irían bien.</div>

      {data && weight.length > 0 && (
        <section className="card p-5 mb-6 flex flex-col gap-2">
          <b className="t-body">Lo que pesan en cada sesión</b>
          <span className="t-small c2">Cada skill que un Claude puede cargar suma su nombre y su descripción a lo que lee al empezar, la use o no. En {project.name}: {weight.map((w) => `${accName(w.id)}, ${w.n} ${w.n === 1 ? 'skill' : 'skills'} ≈ ${fmt(w.tokens)} tokens`).join(' · ')}.</span>
          {idle.length > 0 && <span className="t-small c3">Sin usar aquí esta semana ({idle.length}): {idle.slice(0, 12).map((s) => s.name.replace(/^.*:/, '')).join(', ')}{idle.length > 12 ? '…' : ''}. Ojo: las de las cuentas sirven para todos sus proyectos (las de Unity o Blender no se usan aquí y otro proyecto sí las necesita); antes de quitar una, mira que no se use en ninguno.</span>}
          {nowhere.length > 0 && (
            <div className="flex flex-col gap-1.5 mt-1">
              <span className="t-small c2">Sin usar en ningún proyecto esta semana ({nowhere.length}). Apartarla la saca de la lista que cargan todas las sesiones de esa cuenta, sin borrarla:</span>
              <div className="flex flex-wrap gap-1.5">{nowhere.slice(0, 30).map((s) => <button key={s.dir} className="btn btn-sm" disabled={busy === s.dir} title={s.dir} onClick={() => void run(s.dir, () => api('skillAside', s.dir), `Apartada: ${s.name}. Puedes volver a ponerla aquí mismo`)}>Apartar {s.name.replace(/^.*:/, '')}</button>)}</div>
            </div>
          )}
          {/* EV145 (Decidir #149): one only a project uses goes to that project; the others' sessions stop loading it. */}
          {Object.keys(data.onlyIn ?? {}).length > 0 && (
            <div className="flex flex-col gap-1.5 mt-1">
              <span className="t-small c2">Solo las usa un proyecto: llevarla allí la quita de lo que cargan las sesiones de los demás (se devuelve con un clic):</span>
              <div className="flex flex-wrap gap-1.5">{Object.entries(data.onlyIn ?? {}).slice(0, 30).map(([name, pid]) => {
                const to = state.projects.find((x) => x.id === pid)?.name ?? pid
                return <button key={name} className="btn btn-sm" disabled={busy === name} onClick={() => void run(name, () => api('skillToProject', name, pid), `${name} llevada a ${to}`)}>Llevar {name.replace(/^.*:/, '')} a {to}</button>
              })}</div>
            </div>
          )}
          {(data.moved ?? []).length > 0 && (
            <details className="mt-1">
              <summary className="t-small c3 cursor-pointer">Llevadas a su proyecto ({data.moved!.length}): {[...new Set(data.moved!.map((m) => state.projects.find((x) => x.id === m.projectId)?.name ?? m.projectId))].join(', ')} · ver y devolver</summary>
              <div className="flex flex-wrap gap-1.5 mt-2">{data.moved!.map((m) => <button key={m.name} className="btn btn-sm btn-ghost" disabled={busy === m.name} onClick={() => void run(m.name, () => api('skillReturn', m.name), `${m.name} vuelve a las cuentas`)}>Devolver {m.name}</button>)}</div>
            </details>
          )}
          {(data.aside ?? []).length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5 mt-1">
              <span className="t-small c3">Apartadas:</span>
              {(data.aside ?? []).map((d) => <button key={d} className="btn btn-sm btn-ghost" disabled={busy === d} title={d} onClick={() => void run(d, () => api('skillAside', d, true), 'Vuelve a estar en su sitio')}>Volver a poner {d.split(/[\\/]/).pop()}</button>)}
            </div>
          )}
        </section>
      )}

      <section className="card p-5 mb-6 flex flex-col gap-4">
        <div className="flex items-center gap-2 flex-wrap">
          <Sparkles size={16} style={{ color: 'var(--pink)' }} /><b className="t-body">Sugeridas para {project.name}</b>
          {data?.summary && <span className="t-small c3">· es {data.summary.charAt(0).toLowerCase() + data.summary.slice(1)}</span>}
          <button className="btn btn-sm btn-primary ml-auto" disabled={busy === 'buscar'} onClick={() => void run('buscar', () => api('skillsSearch', project.id), 'Sugerencias al día')}>
            <Search size={13} /> {busy === 'buscar' ? 'Buscando en skills.sh… (1-2 min)' : data?.searchedAt ? 'Buscar otra vez' : 'Buscar sugerencias'}
          </button>
        </div>
        <div className="t-small c3">Busca en skills.sh por {data?.terms.length ? data.terms.map((t) => `«${t}»`).join(', ') : 'lo que es el proyecto'} y solo propone las de más de mil instalaciones que aún no tienes.{data?.searchedAt ? ` Última búsqueda: ${whenFull(data.searchedAt, Date.now())}.` : ''}</div>
        {data?.suggestions.length ? (
          <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))' }}>
            {data.suggestions.map((f) => (
              <div key={f.id} className="rounded-2xl p-4 flex flex-col gap-2" style={{ background: 'var(--fill)' }}>
                <div className="flex items-baseline gap-2 min-w-0"><b className="t-body truncate">{f.skill}</b><span className="t-small c3 ml-auto whitespace-nowrap">{fmt(f.installs)} instalaciones</span></div>
                <div className="t-small c2 clamp-3" style={{ minHeight: '3.9em' }} title={f.description}>{say(f.skill, f.description) ?? 'Sin descripción: pulsa el enlace para leerla en skills.sh.'}</div>
                <div className="t-small c3 truncate">de {f.source} · por «{f.term}»</div>
                <div className="flex items-center gap-1.5 flex-wrap mt-1">
                  <button className="btn btn-sm btn-primary" disabled={!!busy} title="Se instala en la carpeta del proyecto: la usan todas las cuentas que trabajen en él"
                    onClick={() => void run(f.id, () => api('skillInstall', project.id, f.id, 'proyecto'), `${f.skill} instalada en ${project.name}`)}><Download size={12} /> {busy === f.id ? 'Instalando…' : 'Al proyecto'}</button>
                  <button className="btn btn-sm" disabled={!!busy} title="Para todas las cuentas en uso y todos sus proyectos"
                    onClick={() => void run(f.id + 'g', () => api('skillInstall', project.id, f.id, 'todas'), `${f.skill} instalada para todas las cuentas`)}>{busy === f.id + 'g' ? 'Instalando…' : 'A todas las cuentas'}</button>
                  {f.url && <button className="btn btn-sm btn-ghost" onClick={() => void api('openExternal', f.url)} title="Leerla antes en skills.sh"><ExternalLink size={12} /></button>}
                </div>
              </div>
            ))}
          </div>
        ) : <div className="t-small c3">{data?.searchedAt ? 'Nada nuevo que sugerir: ya tienes las que más se usan para este tipo de proyecto.' : 'Pulsa «Buscar sugerencias» para verlas.'}</div>}
        <div className="t-small flex items-center gap-1.5" style={{ color: 'var(--orange)' }}><ShieldAlert size={13} /> Una skill trabaja con todos los permisos de Claude: instala solo las de autores que conozcas y léelas antes («Ver»).</div>
      </section>

      {usedHere.length > 0 && (
        <section className="mb-6">
          <div className="t-section mb-2">Las que más se usan en {project.name}</div>
          <div className="flex gap-2 flex-wrap">
            {usedHere.slice(0, 12).map((s) => <span key={s.scope + s.name} className="pill" style={{ background: 'var(--fill)', height: 26 }}>{s.name} <b className="num">{uses(s.name)}</b></span>)}
          </div>
          {data?.usesAt && <div className="t-small c3 mt-1">Contadas en las conversaciones de las cuentas en este proyecto ({whenFull(data.usesAt, Date.now())}).</div>}
        </section>
      )}

      <div className="flex items-center gap-3 mb-3 flex-wrap">
        <div className="t-section">Instaladas</div>
        <Segmented value={tab} onChange={setTab} options={[{ value: 'aqui', label: `En ${project.name} · ${mine.length}` }, { value: 'cuentas', label: `En las cuentas · ${accounts.length}` }, { value: 'plugins', label: `De plugins · ${plugins.length}` }]} />
      </div>
      <div className="group">
        {list.map((s) => (
          <div key={s.scope + s.name} className="row" style={{ alignItems: 'flex-start' }}>
            <span className="icon-sq mt-0.5" style={{ background: s.scope === 'proyecto' ? 'var(--pink)' : s.scope === 'cuenta' ? 'var(--indigo)' : 'var(--gray)' }}><Puzzle size={12} /></span>
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline gap-2 flex-wrap">
                <b className="t-body">{s.name}</b>
                {uses(s.name) > 0 ? <span className="t-small" style={{ color: 'var(--green)' }}>usada {uses(s.name)} {uses(s.name) === 1 ? 'vez' : 'veces'} aquí</span> : <span className="t-small c3">sin usar aquí</span>}
              </div>
              <div className="t-small c2 clamp-2" title={s.description}>{say(s.name, s.description) || 'Sin descripción'}</div>
              {/* EV119: where it came from (skills.sh's registry) and how old it is; a skill with no known origin, said. */}
              {s.scope === 'cuenta' && <div className="t-small mt-0.5" style={{ color: s.source ? 'var(--label-3)' : 'var(--orange)' }}>{s.source ? <>De {s.source}{s.updatedAt ? <> · puesta al día {new Date(s.updatedAt).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' })}{Date.now() - s.updatedAt > 30 * 86400_000 ? ' (hace más de un mes)' : ''}</> : null}</> : 'Sin procedencia apuntada: mira su texto antes de seguir usándola'}</div>}
              {s.scope !== 'proyecto' && (
                <div className="flex items-center gap-1 mt-1">{s.accounts.map((id) => <Avatar key={id} id={id as any} size={18} />)}<span className="t-small c3 ml-1">{s.accounts.length === 1 ? accName(s.accounts[0]) : `${s.accounts.length} cuentas`}</span></div>
              )}
            </div>
            <span className="flex items-center gap-1 flex-none">
              <button className="btn btn-sm btn-icon btn-ghost" title="Abrir su carpeta" onClick={() => void api('openPath', s.dir)}><FolderOpen size={13} /></button>
              {s.scope !== 'plugin' && s.name !== 'mission-control' && (
                <button className="btn btn-sm btn-icon btn-ghost" title={s.scope === 'proyecto' ? 'Quitarla de este proyecto' : 'Quitarla de todas las cuentas'}
                  onClick={() => { if (window.confirm(`¿Quitar la skill «${s.name}» ${s.scope === 'proyecto' ? `de ${project.name}` : 'de todas las cuentas'}?\n\nSe borra su carpeta; se puede volver a instalar.`)) void run('rm' + s.name, () => api('skillRemove', project.id, s.name, s.scope as 'proyecto' | 'cuenta'), `${s.name} quitada`) }}><Trash2 size={13} /></button>
              )}
            </span>
          </div>
        ))}
        {!list.length && <Empty title={tab === 'aqui' ? `${project.name} no tiene skills propias` : tab === 'cuentas' ? 'Ninguna cuenta tiene skills propias' : 'Sin skills de plugins'} text={tab === 'aqui' ? 'Instala una sugerida «En este proyecto» y la tendrán todas las cuentas que trabajen aquí.' : undefined} />}
      </div>
      {tab === 'plugins' && <div className="t-small c3 mt-2">Las de plugins se instalan y quitan con /plugin dentro de Claude Code.</div>}
    </div>
  )
}
