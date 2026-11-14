import { t } from '../../../core/i18n'
import { Fragment, useState, type ReactNode } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { ExternalLink, Play, RotateCcw, Terminal, MessageSquarePlus, ChevronDown, Hand, Power } from 'lucide-react'
import { useStore, useAsync } from '../lib/store'
import { api, type TimelineEvent, type UsageWindow } from '../lib/api'
import { Sheet, SheetHeader, SPRING, STATE_META, ACCOUNT_COLOR, Bar, workingOn, Recharge, accName } from './ui'
import { AliasEdit } from '../screens/Accounts'
import { ClaudeRing, UsageBar } from './ClaudeRing'
import { ago, clock, countdown, dateShort, modelName, whenFull } from '../lib/format'
const LIMIT_SOURCE: Record<string, string> = { wake_log: 'wake.log', get transcript() { return t('su conversación') }, get statusline() { return t('línea de estado al 100 %') } }

function UsageLine({ label, w, now, blockedUntil }: { label: string; w?: UsageWindow; now: number; blockedUntil?: number }) {
  if (blockedUntil) {
    return (
      <div className="row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 8 }}>
        <div className="flex items-baseline gap-2"><span className="t-body" style={{ fontWeight: 560 }}>{label}</span><span className="ml-auto t-head" style={{ color: 'var(--red)' }}>{t('Agotada')}</span></div>
        <Bar pct={100} color="var(--red)" />
        <div className="t-small c3">{t('Vuelve {v0} · en {v1}', { v0: whenFull(blockedUntil, now), v1: countdown(blockedUntil, now) })}</div>
      </div>
    )
  }
  const live = w && w.resetsAt > now
  const used = live ? Math.round(w!.usedPct) : undefined
  return (
    <div className="row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 8 }}>
      <div className="flex items-baseline gap-2">
        <span className="t-body" style={{ fontWeight: 560 }}>{label}</span>
        <span className="ml-auto t-head num" style={{ color: used == null ? 'var(--label-3)' : used >= 90 ? 'var(--red)' : used >= 75 ? 'var(--orange)' : 'var(--label)' }}>
          {used == null ? (w ? t('Reiniciado') : t('Sin lectura')) : t('{used} % gastado', { used })}
        </span>
      </div>
      <Bar pct={live ? w!.usedPct : 0} />
      <div className="t-small c3">{live ? t('Se reinicia {v0} · en {v1}', { v0: whenFull(w!.resetsAt, now), v1: countdown(w!.resetsAt, now) }) : w ? t('Se reinició {v0}; llegará otra lectura con la próxima respuesta', { v0: ago(w.resetsAt, now) }) : t('Llega con la primera respuesta de una sesión de esta cuenta')}</div>
    </div>
  )
}

function Group({ title, children, right }: { title: string; children: ReactNode; right?: ReactNode }) {
  return (
    <section>
      <div className="flex items-baseline mb-2 px-1"><span className="t-head">{title}</span><span className="ml-auto">{right}</span></div>
      <div className="group" style={{ background: 'var(--bg-elev-2)' }}>{children}</div>
    </section>
  )
}

export function AgentSheet() {
  const { state, agentOpen, setAgentOpen, now, toast, openComposer } = useStore()
  const [tech, setTech] = useState(false)
  const [moreTasks, setMoreTasks] = useState(false)
  const a = state?.agents.find((x) => x.id === agentOpen)
  const project = state?.projects.find((p) => p.id === state.activeProjectId)
  const recent = useAsync(() => (agentOpen && project ? api<TimelineEvent[]>('timeline', project.id, now - 7 * 86400_000, now) : Promise.resolve([])), [agentOpen, project?.id])
  const saved = useAsync(() => (agentOpen && project ? api<any[]>('sessions', project.id) : Promise.resolve([])), [agentOpen, project?.id])
  const close = () => { setAgentOpen(undefined); setTech(false); setMoreTasks(false) }
  const run = async (fn: () => Promise<unknown>, ok: string) => { try { await fn(); toast(ok) } catch (e) { toast((e as Error).message) } }
  if (!a) return <Sheet open={false} onClose={close}>{null}</Sheet>
  const m = STATE_META[a.state]
  const snap = a.usage.snapshot
  const hbs = (state?.summary?.heartbeats ?? []).filter((h) => h.account === a.id)
  const history = [
    ...hbs.map((h) => ({ at: h.at, t: h.text, k: t('Dejó el relevo') })),
    ...(recent.data ?? []).filter((e) => e.account === a.id && e.kind !== 'relevo').map((e) => ({ at: e.at, t: e.title, k: e.kind === 'peticion' ? t('Le pediste') : e.kind === 'limite' ? t('Límite') : t('Tarea') }))
  ].sort((x, y) => y.at - x.at).slice(0, 8)
  const mine = (saved.data ?? []).filter((s) => s.account === a.id && !s.live).slice(0, 5)
  const tasks = moreTasks ? a.assigned : a.assigned.slice(0, 5)
  return (
    <Sheet open onClose={close} width={600}>
      <SheetHeader onClose={close}>
        <div className="flex items-center gap-5">
          <ClaudeRing a={a} size={104} now={now} />
          <div className="min-w-0">
            <div className="t-display">{accName(a.id)}</div>
            <div className="t-small c3">{t('Claude {v0}{v1}', { v0: a.id.slice(6), v1: a.alias ? t(' · cuenta {alias}', { alias: a.alias }) : '' })}</div>
            <div className="mt-1"><AliasEdit a={a} /></div>
            <div className="t-head mt-1" style={{ color: m.color }}>{m.label}</div>
            <div className="t-small c3 mt-1 truncate">{[a.identity.email ?? (a.identity.hasLogin ? '' : t('sin sesión iniciada')), a.identity.plan?.label].filter(Boolean).join(' · ') || t('sesión iniciada')}</div>
          </div>
        </div>
      </SheetHeader>
      <div className="flex-1 overflow-auto px-5 py-5 flex flex-col gap-6">
        <div className="flex flex-wrap gap-2">
          {project && a.state !== 'sin-uso' && (
            <button className="btn btn-primary" title={t('Abre este Claude en la copia donde se trabaja y le dice «sigue»: recoge lo que dejó a medias otra cuenta sin uso, o la siguiente tarea libre')}
              onClick={() => run(async () => { const r = await api<any>('putToWork', project.id, a.id); return r }, t('{v0} se pone a trabajar en {name}', { v0: accName(a.id), name: project.name }))}>
              <Play size={15} /> {t('Poner a trabajar')}
            </button>
          )}
          {project && <button className="btn" onClick={() => run(() => api('openSession', a.id, project.root), t('Abriendo {v0} en {name}', { v0: accName(a.id), name: project.name }))}><Terminal size={15} /> {t('Abrir sesión')}</button>}
          <button className="btn" onClick={() => openComposer({ target: a.id, kind: 'mensaje' })}><MessageSquarePlus size={15} /> {t('Instrucción')}</button>
          {a.sessions.length > 0 && (
            <button className="btn" title={t('En su próximo paso lee que debe cerrar el paso en curso, dejar el relevo al día, liberar sus tareas y parar')}
              onClick={() => run(() => api('stopClaude', a.id, 'pedir'), t('{v0} cerrará al acabar el paso en curso', { v0: accName(a.id) }))}><Hand size={15} /> {t('Pedir que cierre')}</button>
          )}
          {a.sessions.some((s) => s.pid) && (
            <button className="btn" style={{ color: 'var(--red)' }} title={t('Corta su proceso ahora mismo')}
              onClick={() => { if (window.confirm(t('¿Cerrar ya la sesión de {v0}? Lo que esté escribiendo puede quedar a medias. «Pedir que cierre» es más seguro.', { v0: accName(a.id) }))) void run(() => api('stopClaude', a.id, 'ya'), t('Sesión de {v0} cerrada', { v0: accName(a.id) })) }}><Power size={15} /> {t('Cerrar ya')}</button>
          )}
          <button className="btn" onClick={() => run(() => api('openUsagePage'), t('Abierta la página de uso: entra con ') + (a.identity.email ?? a.id))}><ExternalLink size={15} /> {t('Uso en la web')}</button>
        </div>

        {a.state === 'sin-uso' && a.usage.activeLimit && (
          <div className="rounded-2xl p-4" style={{ background: 'color-mix(in srgb, var(--red) 12%, transparent)' }}>
            <div className="t-head" style={{ color: 'var(--red)' }}>{t('Vuelve {v0}', { v0: whenFull(a.usage.activeLimit.resetsAt, now) })}</div>
            <div className="t-small c2 mt-0.5">{t('Faltan {v0}{v1}. Puedes pasar su trabajo a otro Claude con una instrucción.', { v0: countdown(a.usage.activeLimit.resetsAt, now), v1: a.assigned.length ? t(' · {length} tareas suyas esperan', { length: a.assigned.length }) : '' })}</div>
            <div className="mt-2"><Recharge a={a} recharged={state?.settings?.recharged} onDone={toast} /></div>
          </div>
        )}

        {(() => {
          const act = state?.activity?.[a.id]
          if (!act?.now && !act?.focus) return null
          const w = workingOn(a, act, [], now)
          return (
            <Group title={t('Qué hace')} right={<span className="t-small c3">{t('lo dice él y sus hooks, sin gastar uso')}</span>}>
              <div className="row items-start" style={{ background: `color-mix(in srgb, ${ACCOUNT_COLOR[a.id]} 12%, transparent)` }}>
                <span className="t-micro w-11 flex-none pt-0.5" style={{ color: ACCOUNT_COLOR[a.id] }}>{w.fresh ? t('Ahora') : t('Último')}</span>
                <span className="t-head flex-1">{w.text}</span>
              </div>
              {act.focusHistory.slice(0, 3).map((f, i) => (
                <div key={'f' + i} className="row">
                  <span className="t-small num c3 w-11 flex-none">{new Date(f.at).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}</span>
                  <span className="t-body c2 flex-1 min-w-0 truncate">{f.text}</span>
                </div>
              ))}
              {act.recent.slice(0, 6).map((r, i) => (
                <div key={i} className="row">
                  <span className="t-small num c3 w-11 flex-none">{new Date(r.at).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}</span>
                  <span className={`t-body flex-1 min-w-0 ${i ? 'c2' : ''}`} style={i ? undefined : { fontWeight: 580 }}>{r.text}</span>
                </div>
              ))}
              {act.lastMessage && <div className="row items-start"><span className="t-small c3 w-11 flex-none">{t('Dijo')}</span><span className="t-small c2 flex-1 whitespace-pre-wrap selectable">{act.lastMessage.text}</span></div>}
            </Group>
          )
        })()}

        <Group title={t('Uso')} right={<span className="t-small c3">{snap ? t('leído {v0}', { v0: ago(snap.capturedAt, now) }) : ''}</span>}>
          {/* EV146: a plan Claude Code gives no usage for (Team, Enterprise, a key, a cloud): said, not left as empty bars. */}
          {a.identity.plan && !a.identity.plan.limits && !snap?.fiveHour && !snap?.sevenDay ? <div className="row t-small c2">{a.identity.plan.note}</div> : <>
            <div className="row" style={{ alignItems: 'stretch' }}><div className="flex-1 min-w-0"><UsageBar a={a} which="five" now={now} /></div></div>
            <div className="row" style={{ alignItems: 'stretch' }}><div className="flex-1 min-w-0"><UsageBar a={a} which="week" now={now} /></div></div>
          </>}
        </Group>

        <Group title={a.sessions.length ? t('Ahora') : t('Sin sesiones abiertas')}>
          {a.sessions.map((s) => (
            <div key={s.sessionId} className="row">
              <span className="dot" style={{ background: s.status === 'busy' ? 'var(--green)' : s.status === 'waiting' ? 'var(--orange)' : 'var(--gray)' }} />
              <span className="min-w-0 flex-1">
                <span className="t-body block truncate" style={{ fontWeight: 560 }}>{s.title ?? s.shortId}</span>
                <span className="t-small c3 block truncate">{s.status === 'busy' ? t('Trabajando') : s.status === 'waiting' ? t('Te espera') : t('En reposo')} · {s.worktree ?? s.cwd.split('\\').pop()} · {ago(s.lastActivityAt, now)}</span>
              </span>
              {s.kind === 'background' && <button className="btn btn-sm" onClick={() => run(() => api('attachSession', a.id, s.cwd, s.shortId), t('Abriendo la sesión'))}><Play size={12} /> {t('Ver')}</button>}
              {/* EV151: its window in front of the others, to watch it or write in it. */}
              {s.kind !== 'background' && s.pid && <button className="btn btn-sm" title={t('Pone su ventana delante de las demás, para mirarla o escribirle')} onClick={() => run(() => api('frontSession', s.sessionId), t('Ventana delante'))}><Play size={12} /> {t('Ver ventana')}</button>}
            </div>
          ))}
          {!a.sessions.length && <div className="row t-small c3">{t('Abre una con «Abrir sesión» o retoma una conversación.')}</div>}
        </Group>

        {a.assigned.length > 0 && (
          <Group title={t('Sus tareas')} right={a.assigned.length > 5 && <button className="t-small border-0 bg-transparent" style={{ color: 'var(--accent)' }} onClick={() => setMoreTasks(!moreTasks)}>{moreTasks ? t('Menos') : t('Ver las {length}', { length: a.assigned.length })}</button>}>
            {tasks.map((task, i) => (
              <div key={i} className="row">
                <span className="t-small num c3 w-11 flex-none" style={{ fontWeight: 600 }}>{task.extId ?? '—'}</span>
                <span className="t-body truncate flex-1">{task.title}</span>
                {task.status === 'en-desarrollo' && <span className="t-small" style={{ color: 'var(--accent)' }}>{t('en curso')}</span>}
              </div>
            ))}
          </Group>
        )}

        {a.assigned.length > 0 && project && (
          <Group title={t('Pasar su trabajo a…')}>
            {(state?.agents ?? []).filter((x) => x.id !== a.id).sort((x, y) => (y.state === 'sin-uso' ? -1 : 0) - (x.state === 'sin-uso' ? -1 : 0) || (x.usage.snapshot?.sevenDay?.usedPct ?? 101) - (y.usage.snapshot?.sevenDay?.usedPct ?? 101)).map((x) => {
              const busy = x.state === 'trabajando'
              const out = x.state === 'sin-uso'
              return (
                <div key={x.id} className="row">
                  <span className="icon-sq icon-sq-lg num" style={{ background: ACCOUNT_COLOR[x.id], fontWeight: 700 }}>{x.id.slice(6)}</span>
                  <span className="min-w-0 flex-1">
                    <span className="t-body block" style={{ fontWeight: 560 }}>{accName(x.id)}</span>
                    <span className="t-small block truncate" style={{ color: out ? 'var(--red)' : 'var(--label-3)' }}>{STATE_META[x.state].label}{x.usage.snapshot?.sevenDay && x.usage.snapshot.sevenDay.resetsAt > now ? t(' · semana {free} % libre', { free: 100 - Math.round(x.usage.snapshot.sevenDay.usedPct) }) : ''}{busy ? t(' · está con otra cosa') : ''}</span>
                  </span>
                  <button className={`btn btn-sm ${!busy && !out ? 'btn-primary' : ''}`} disabled={out}
                    onClick={() => run(async () => { const r = await api<any>('handoff', project.id, a.id, x.id); return r }, t('Relevo preparado: {v0} lo recibirá al abrir su próxima sesión{v1}', { v0: accName(x.id), v1: state?.hooks?.[x.id] ? '' : t(' (activa la coordinación en Ajustes, o entrégalo desde Revisar)') }))}>
                    {t('Pasar')}
                  </button>
                </div>
              )
            })}
            <div className="row t-small c3">{t('Se le escribe qué hacía {v0}, sus {length} tareas, lo que quedó sin guardar y por dónde empezar. Sus reservas pasan al nuevo.', { v0: accName(a.id), length: a.assigned.length })}</div>
          </Group>
        )}

        {mine.length > 0 && (
          <Group title={t('Retomar una conversación')}>
            {mine.map((s) => (
              <div key={s.sessionId} className="row">
                <span className="min-w-0 flex-1">
                  <span className="t-body block truncate">{s.title ?? s.lastPrompt ?? s.sessionId.slice(0, 8)}</span>
                  <span className="t-small c3 block">{ago(s.mtime, now)} · {s.copy}</span>
                </span>
                <button className="btn btn-sm" onClick={() => run(() => api('resumeSession', a.id, s.cwd, s.sessionId), t('Retomando en una ventana'))}><RotateCcw size={12} /> {t('Retomar')}</button>
              </div>
            ))}
          </Group>
        )}

        {history.length > 0 && (
          <Group title={t('Últimos días')}>
            {history.map((e, i) => (
              <div key={i} className="row" style={{ alignItems: 'flex-start' }}>
                <span className="t-small c3 num w-20 flex-none pt-0.5">{dateShort(e.at)} {clock(e.at)}</span>
                <span className="min-w-0"><span className="t-small c3 block">{e.k}</span><span className="t-body clamp-2 block">{e.t}</span></span>
              </div>
            ))}
          </Group>
        )}

        <section>
          <button className="flex items-center gap-1.5 t-small c3 border-0 bg-transparent px-1" onClick={() => setTech(!tech)} aria-expanded={tech}>
            <motion.span animate={{ rotate: tech ? 0 : -90 }} transition={SPRING}><ChevronDown size={14} /></motion.span> {t('Detalles técnicos')}
          </button>
          <AnimatePresence initial={false}>
            {tech && (
              <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={SPRING} className="overflow-hidden">
                <div className="t-small c2 px-1 pt-3 grid grid-cols-[150px_1fr] gap-x-3 gap-y-1.5 selectable">
                  <span className="c3">{t('Carpeta')}</span><span className="break-all">{a.configDir || '%USERPROFILE%\\.claude'}</span>
                  <span className="c3">{t('Cuenta esperada')}</span><span>{a.identity.emailMismatch ? <b style={{ color: 'var(--red)' }}>{t('{email} (no es la suya)', { email: a.identity.email })}</b> : a.identity.email ?? '—'}</span>
                  <span className="c3">{t('Modelo')}</span><span>{modelName(a.model) ?? '—'}</span>
                  <span className="c3">{t('Sesiones leídas')}</span><span>{a.sessionsReadAt ? `claude agents --json, ${ago(a.sessionsReadAt, now)}` : a.sessionsError ?? '—'}</span>
                  <span className="c3">{t('Consumo')}</span><span>{snap ? t('línea de estado, {v0} {v1}', { v0: dateShort(snap.capturedAt), v1: clock(snap.capturedAt) }) : t('sin lectura')}</span>
                  <span className="c3">{t('Último límite')}</span><span>{a.usage.lastLimit ? `${a.usage.lastLimit.kind}, ${dateShort(a.usage.lastLimit.at)} ${clock(a.usage.lastLimit.at)} → ${dateShort(a.usage.lastLimit.resetsAt)} ${clock(a.usage.lastLimit.resetsAt)} (${LIMIT_SOURCE[a.usage.lastLimit.source] ?? 'credits_' + a.id + '.txt'})` : '—'}</span>
                  {a.sessions.map((s) => <Fragment key={s.sessionId}><span className="c3">{t('Sesión {shortId}', { shortId: s.shortId })}</span><span>{s.kind} · {s.status}/{s.state ?? '—'}{typeof s.contextPct === 'number' ? t(' · contexto {pct} %', { pct: Math.round(s.contextPct) }) : ''}{s.branch ? t(' · rama {branch}', { branch: s.branch }) : ''}</span></Fragment>)}
                  <span className="c3">{t('Color')}</span><span><span className="dot inline-block align-middle" style={{ background: ACCOUNT_COLOR[a.id] }} /> {a.id}</span>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </section>
      </div>
    </Sheet>
  )
}
