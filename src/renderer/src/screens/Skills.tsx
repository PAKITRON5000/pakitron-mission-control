import { t, tn } from '../../../core/i18n'
import { useEffect, useState } from 'react'
import { Puzzle, Search, Download, Trash2, ExternalLink, FolderOpen, Sparkles, ShieldAlert } from 'lucide-react'
import { useStore, useAsync } from '../lib/store'
import { api } from '../lib/api'
import { Avatar, Empty, Segmented, accName } from '../components/ui'
import { whenFull } from '../lib/format'

interface SkillInfo { name: string; description: string; scope: 'proyecto' | 'cuenta' | 'plugin'; accounts: string[]; projects: string[]; dir: string; source?: string; updatedAt?: number }
interface Found { id: string; skill: string; source: string; installs: number; url?: string; term: string; description?: string }
interface SkillsView { es: Record<string, string>; installed: SkillInfo[]; uses: Record<string, number>; usesEverywhere?: Record<string, number>; countedEverywhere?: boolean; aside?: string[]; onlyIn?: Record<string, string>; moved?: { name: string; projectId: string; at: number }[]; usesAt?: number; kinds: string[]; summary?: string; terms: string[]; suggestions: Found[]; searchedAt?: number; gapTerms?: string[]; hinted?: Record<string, { given: number; used: number }> }

const err = (e: unknown) => (e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
const fmt = (n: number) => (n >= 1000 ? t('{v0} mil', { v0: (n / 1000).toFixed(n >= 10_000 ? 0 : 1).replace('.', ',') }) : String(n))

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
      <h1 className="t-display flex items-center gap-3"><span className="icon-sq icon-sq-lg" style={{ background: 'var(--pink)' }}><Puzzle size={16} /></span>{t('Skills')}<span className="c3" style={{ fontWeight: 450 }}>· {project.name}</span></h1>
      <div className="t-head c2 mt-2 mb-6" style={{ fontWeight: 450 }}>{t('Conocimientos que los Claude cargan cuando les hacen falta (cómo modelar en Blender, cómo usar Unity…). Aquí ves los que hay, cuánto se usan en {name} y cuáles le irían bien.', { name: project.name })}</div>

      {data && weight.length > 0 && (
        <section className="card p-5 mb-6 flex flex-col gap-2">
          <b className="t-body">{t('Lo que pesan en cada sesión')}</b>
          <span className="t-small c2">{t('Cada skill que un Claude puede cargar suma su nombre y su descripción a lo que lee al empezar, la use o no. En {name}:', { name: project.name })} {weight.map((w) => t('{who}, {skills} ≈ {tokens} tokens', { who: accName(w.id), skills: tn(w.n, '{n} skill', '{n} skills'), tokens: fmt(w.tokens) })).join(' · ')}.</span>
          {idle.length > 0 && <span className="t-small c3">{t('Sin usar aquí esta semana ({length}):', { length: idle.length })} {idle.slice(0, 12).map((s) => s.name.replace(/^.*:/, '')).join(', ')}{idle.length > 12 ? '…' : ''}{t('. Ojo: las de las cuentas sirven para todos sus proyectos (las de Unity o Blender no se usan aquí y otro proyecto sí las necesita); antes de quitar una, mira que no se use en ninguno.')}</span>}
          {nowhere.length > 0 && (
            <div className="flex flex-col gap-1.5 mt-1">
              <span className="t-small c2">{t('Sin usar en ningún proyecto esta semana ({length}). Apartarla la saca de la lista que cargan todas las sesiones de esa cuenta, sin borrarla:', { length: nowhere.length })}</span>
              <div className="flex flex-wrap gap-1.5">{nowhere.slice(0, 30).map((s) => <button key={s.dir} className="btn btn-sm" disabled={busy === s.dir} title={s.dir} onClick={() => void run(s.dir, () => api('skillAside', s.dir), t('Apartada: {name}. Puedes volver a ponerla aquí mismo', { name: s.name }))}>{t('Apartar {v0}', { v0: s.name.replace(/^.*:/, '') })}</button>)}</div>
            </div>
          )}
          {/* EV145 (Decidir #149): one only a project uses goes to that project; the others' sessions stop loading it. */}
          {Object.keys(data.onlyIn ?? {}).length > 0 && (
            <div className="flex flex-col gap-1.5 mt-1">
              <span className="t-small c2">{t('Solo las usa un proyecto: llevarla allí la quita de lo que cargan las sesiones de los demás (se devuelve con un clic):')}</span>
              <div className="flex flex-wrap gap-1.5">{Object.entries(data.onlyIn ?? {}).slice(0, 30).map(([name, pid]) => {
                const to = state.projects.find((x) => x.id === pid)?.name ?? pid
                return <button key={name} className="btn btn-sm" disabled={busy === name} onClick={() => void run(name, () => api('skillToProject', name, pid), t('{name} llevada a {to}', { name, to }))}>{t('Llevar {v0} a {to}', { v0: name.replace(/^.*:/, ''), to: to })}</button>
              })}</div>
            </div>
          )}
          {(data.moved ?? []).length > 0 && (
            <details className="mt-1">
              <summary className="t-small c3 cursor-pointer">{t('Llevadas a su proyecto ({length}):', { length: data.moved!.length })} {[...new Set(data.moved!.map((m) => state.projects.find((x) => x.id === m.projectId)?.name ?? m.projectId))].join(', ')} {t('· ver y devolver')}</summary>
              <div className="flex flex-wrap gap-1.5 mt-2">{data.moved!.map((m) => <button key={m.name} className="btn btn-sm btn-ghost" disabled={busy === m.name} onClick={() => void run(m.name, () => api('skillReturn', m.name), t('{name} vuelve a las cuentas', { name: m.name }))}>{t('Devolver {name}', { name: m.name })}</button>)}</div>
            </details>
          )}
          {(data.aside ?? []).length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5 mt-1">
              <span className="t-small c3">{t('Apartadas:')}</span>
              {(data.aside ?? []).map((d) => <button key={d} className="btn btn-sm btn-ghost" disabled={busy === d} title={d} onClick={() => void run(d, () => api('skillAside', d, true), t('Vuelve a estar en su sitio'))}>{t('Volver a poner {v0}', { v0: d.split(/[\\/]/).pop() })}</button>)}
            </div>
          )}
        </section>
      )}

      <section className="card p-5 mb-6 flex flex-col gap-4">
        <div className="flex items-center gap-2 flex-wrap">
          <Sparkles size={16} style={{ color: 'var(--pink)' }} /><b className="t-body">{t('Sugeridas para {name}', { name: project.name })}</b>
          {data?.summary && <span className="t-small c3">{t('· es {v0}', { v0: data.summary.charAt(0).toLowerCase() + data.summary.slice(1) })}</span>}
          <button className="btn btn-sm btn-primary ml-auto" disabled={busy === 'buscar'} onClick={() => void run('buscar', () => api('skillsSearch', project.id), t('Sugerencias al día'))}>
            <Search size={13} /> {busy === 'buscar' ? t('Buscando en skills.sh… (1-2 min)') : data?.searchedAt ? t('Buscar otra vez') : t('Buscar sugerencias')}
          </button>
        </div>
        <div className="t-small c3">{t('Busca en skills.sh por')} {data?.terms.length || data?.gapTerms?.length ? [...(data?.terms ?? []), ...(data?.gapTerms ?? [])].map((t) => `«${t}»`).join(', ') : t('lo que es el proyecto')} {t('y solo propone las de más de mil instalaciones que aún no tienes.{v0}', { v0: data?.searchedAt ? t(' Última búsqueda: {v0}.', { v0: whenFull(data.searchedAt, Date.now()) }) : '' })}</div>
        {data?.suggestions.length ? (
          <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))' }}>
            {data.suggestions.map((f) => (
              <div key={f.id} className="rounded-2xl p-4 flex flex-col gap-2" style={{ background: 'var(--fill)' }}>
                <div className="flex items-baseline gap-2 min-w-0"><b className="t-body truncate">{f.skill}</b><span className="t-small c3 ml-auto whitespace-nowrap">{t('{v0} instalaciones', { v0: fmt(f.installs) })}</span></div>
                <div className="t-small c2 clamp-3" style={{ minHeight: '3.9em' }} title={f.description}>{say(f.skill, f.description) ?? t('Sin descripción: pulsa el enlace para leerla en skills.sh.')}</div>
                <div className="t-small c3 truncate">{t('de {source} · por «{term}»', { source: f.source, term: f.term })}</div>
                <div className="flex items-center gap-1.5 flex-wrap mt-1">
                  <button className="btn btn-sm btn-primary" disabled={!!busy} title={t('Se instala en la carpeta del proyecto: la usan todas las cuentas que trabajen en él')}
                    onClick={() => void run(f.id, () => api('skillInstall', project.id, f.id, 'proyecto'), t('{skill} instalada en {name}', { skill: f.skill, name: project.name }))}><Download size={12} /> {busy === f.id ? t('Instalando…') : t('Al proyecto')}</button>
                  <button className="btn btn-sm" disabled={!!busy} title={t('Para todas las cuentas en uso y todos sus proyectos')}
                    onClick={() => void run(f.id + 'g', () => api('skillInstall', project.id, f.id, 'todas'), t('{skill} instalada para todas las cuentas', { skill: f.skill }))}>{busy === f.id + 'g' ? t('Instalando…') : t('A todas las cuentas')}</button>
                  {f.url && <button className="btn btn-sm btn-ghost" onClick={() => void api('openExternal', f.url)} title={t('Leerla antes en skills.sh')}><ExternalLink size={12} /></button>}
                </div>
              </div>
            ))}
          </div>
        ) : <div className="t-small c3">{data?.searchedAt ? t('Nada nuevo que sugerir: ya tienes las que más se usan para este tipo de proyecto.') : t('Pulsa «Buscar sugerencias» para verlas.')}</div>}
        <div className="t-small flex items-center gap-1.5" style={{ color: 'var(--orange)' }}><ShieldAlert size={13} /> {t('Una skill trabaja con todos los permisos de Claude: instala solo las de autores que conozcas y léelas antes («Ver»).')}</div>
      </section>

      {usedHere.length > 0 && (
        <section className="mb-6">
          <div className="t-section mb-2">{t('Las que más se usan en {name}', { name: project.name })}</div>
          <div className="flex gap-2 flex-wrap">
            {usedHere.slice(0, 12).map((s) => <span key={s.scope + s.name} className="pill" style={{ background: 'var(--fill)', height: 26 }}>{s.name} <b className="num">{uses(s.name)}</b></span>)}
          </div>
          {data?.usesAt && <div className="t-small c3 mt-1">{t('Contadas en las conversaciones de las cuentas en este proyecto ({v0}).', { v0: whenFull(data.usesAt, Date.now()) })}</div>}
        </section>
      )}

      <div className="flex items-center gap-3 mb-3 flex-wrap">
        <div className="t-section">{t('Instaladas')}</div>
        <Segmented value={tab} onChange={setTab} options={[{ value: 'aqui', label: t('En {name} · {length}', { name: project.name, length: mine.length }) }, { value: 'cuentas', label: t('En las cuentas · {length}', { length: accounts.length }) }, { value: 'plugins', label: t('De plugins · {length}', { length: plugins.length }) }]} />
      </div>
      <div className="group">
        {list.map((s) => (
          <div key={s.scope + s.name} className="row" style={{ alignItems: 'flex-start' }}>
            <span className="icon-sq mt-0.5" style={{ background: s.scope === 'proyecto' ? 'var(--pink)' : s.scope === 'cuenta' ? 'var(--indigo)' : 'var(--gray)' }}><Puzzle size={12} /></span>
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline gap-2 flex-wrap">
                <b className="t-body">{s.name}</b>
                {uses(s.name) > 0 ? <span className="t-small" style={{ color: 'var(--green)' }}>{t('usada {v0} {v1} aquí', { v0: uses(s.name), v1: uses(s.name) === 1 ? t('vez') : t('veces') })}</span> : <span className="t-small c3">{t('sin usar aquí')}</span>}
              </div>
              <div className="t-small c2 clamp-2" title={s.description}>{say(s.name, s.description) || t('Sin descripción')}</div>
              {/* EV191: how often pmc claim suggested it to a Claude, and how often it was then loaded (after 5 unused, no more). */}
              {data?.hinted?.[s.name] && <div className="t-small c3 mt-0.5">{t('Sugerida a los Claude {given} {v0} · la cargaron {used}{v1}', { given: data.hinted[s.name].given, v0: data.hinted[s.name].given === 1 ? t('vez') : t('veces'), used: data.hinted[s.name].used, v1: data.hinted[s.name].given >= 5 && !data.hinted[s.name].used ? t(' (ya no se sugiere)') : '' })}</div>}
              {/* EV119: where it came from (skills.sh's registry) and how old it is; a skill with no known origin, said. */}
              {s.scope === 'cuenta' && <div className="t-small mt-0.5" style={{ color: s.source ? 'var(--label-3)' : 'var(--orange)' }}>{s.source ? <>{t('De {source}', { source: s.source })}{s.updatedAt ? <> {t('· puesta al día {v0}{v1}', { v0: new Date(s.updatedAt).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' }), v1: Date.now() - s.updatedAt > 30 * 86400_000 ? t(' (hace más de un mes)') : '' })}</> : null}</> : t('Sin procedencia apuntada: mira su texto antes de seguir usándola')}</div>}
              {s.scope !== 'proyecto' && (
                <div className="flex items-center gap-1 mt-1">{s.accounts.map((id) => <Avatar key={id} id={id as any} size={18} />)}<span className="t-small c3 ml-1">{s.accounts.length === 1 ? accName(s.accounts[0]) : t('{n} cuentas', { n: s.accounts.length })}</span></div>
              )}
            </div>
            <span className="flex items-center gap-1 flex-none">
              <button className="btn btn-sm btn-icon btn-ghost" title={t('Abrir su carpeta')} onClick={() => void api('openPath', s.dir)}><FolderOpen size={13} /></button>
              {s.scope !== 'plugin' && s.name !== 'mission-control' && (
                <button className="btn btn-sm btn-icon btn-ghost" title={s.scope === 'proyecto' ? t('Quitarla de este proyecto') : t('Quitarla de todas las cuentas')}
                  onClick={() => { if (window.confirm(t('¿Quitar la skill «{name}» {v0}?\n\nSe borra su carpeta; se puede volver a instalar.', { name: s.name, v0: s.scope === 'proyecto' ? t('de {name}', { name: project.name }) : t('de todas las cuentas') }))) void run('rm' + s.name, () => api('skillRemove', project.id, s.name, s.scope as 'proyecto' | 'cuenta'), t('{name} quitada', { name: s.name })) }}><Trash2 size={13} /></button>
              )}
            </span>
          </div>
        ))}
        {!list.length && <Empty title={tab === 'aqui' ? t('{name} no tiene skills propias', { name: project.name }) : tab === 'cuentas' ? t('Ninguna cuenta tiene skills propias') : t('Sin skills de plugins')} text={tab === 'aqui' ? t('Instala una sugerida «En este proyecto» y la tendrán todas las cuentas que trabajen aquí.') : undefined} />}
      </div>
      {tab === 'plugins' && <div className="t-small c3 mt-2">{t('Las de plugins se instalan y quitan con /plugin dentro de Claude Code.')}</div>}
    </div>
  )
}
