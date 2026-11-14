import { t } from '../../../core/i18n'
import { motion } from 'motion/react'
import { Clock, Cpu, FolderGit2, GitBranch, Hourglass, ChevronRight, CircleAlert } from 'lucide-react'
import type { AgentCard, UsageWindow } from '../lib/api'
import { Avatar, Bar, StatePill, SPRING, usageColor, accName } from './ui'
import { ago, countdown, duration, modelName, whenFull } from '../lib/format'
import { useStore } from '../lib/store'

const STALE_MS = 30 * 60_000

export function UsageRow({ label, w, capturedAt, now }: { label: string; w?: UsageWindow; capturedAt?: number; now: number }) {
  if (!w) {
    return (
      <div>
        <div className="flex items-baseline justify-between t-small">
          <span className="c2">{label}</span>
          <span className="c3">{t('Sin datos')}</span>
        </div>
        <div className="bar mt-1.5" style={{ opacity: 0.5 }} />
      </div>
    )
  }
  const reset = w.resetsAt <= now
  const stale = capturedAt ? now - capturedAt > STALE_MS : false
  return (
    <div>
      <div className="flex items-baseline justify-between t-small gap-2">
        <span className="c2">{label}</span>
        {reset ? (
          <span className="c3 truncate">{t('Se reinició {v0} · sin lectura nueva', { v0: ago(w.resetsAt, now) })}</span>
        ) : (
          <span className="num truncate" style={{ color: usageColor(w.usedPct), fontWeight: 620 }}>
            {Math.round(w.usedPct)} {t('% usado')}
            <span className="c3" style={{ fontWeight: 450 }}> {t('· quedan {v0} %', { v0: Math.max(0, 100 - Math.round(w.usedPct)) })}</span>
          </span>
        )}
      </div>
      <div className="mt-1.5" style={{ opacity: reset || stale ? 0.45 : 1 }}>
        <Bar pct={reset ? 0 : w.usedPct} />
      </div>
      {!reset && (
        <div className="flex justify-between t-small c3 mt-1 num">
          <span>{t('Reinicio {v0}', { v0: whenFull(w.resetsAt, now) })}</span>
          <span>{t('en {v0}', { v0: countdown(w.resetsAt, now) })}</span>
        </div>
      )}
    </div>
  )
}

export function AgentPanel({ a, index }: { a: AgentCard; index: number }) {
  const { now, setAgentOpen, state } = useStore()
  // The session in the project on screen comes first; another project's session is named as such.
  const s = a.sessions.find((x) => x.projectId === state?.activeProjectId) ?? a.sessions[0]
  const otherProject = s && s.projectId !== state?.activeProjectId ? state?.projects.find((p) => p.id === s.projectId)?.name ?? s.cwd.split(/[\\/]/).pop() : undefined
  const snap = a.usage.snapshot
  const lim = a.usage.activeLimit
  const task = a.assigned.find((t) => t.status === 'en-desarrollo') ?? a.assigned[0]
  const title = s?.title ?? (a.heartbeat ? a.heartbeat.text.split(/(?<=[.:])\s/)[0] : undefined)
  const near = snap && ((snap.fiveHour && snap.fiveHour.usedPct >= 80 && snap.fiveHour.resetsAt > now) || (snap.sevenDay && snap.sevenDay.usedPct >= 80 && snap.sevenDay.resetsAt > now))
  return (
    <motion.button
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ ...SPRING, delay: index * 0.04 }}
      onClick={() => setAgentOpen(a.id)}
      className="card text-left p-0 flex flex-col overflow-hidden group"
      style={{ border: 0, minWidth: 0 }}
      whileTap={{ scale: 0.99 }}
    >
      <div className="flex items-center gap-3 px-5 pt-5">
        <Avatar id={a.id} size={42} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="t-head">{accName(a.id)}</span>
            
          </div>
          <div className="t-small c3 truncate">{[a.identity.email ?? (a.identity.hasLogin ? '' : t('Sin sesión iniciada')), a.identity.plan?.label].filter(Boolean).join(' · ') || t('Sesión iniciada')}</div>
        </div>
        <StatePill state={a.state} />
      </div>

      <div className="px-5 pt-4 min-h-[76px]">
        <div className="t-micro c3">{a.state === 'sin-uso' && lim ? t('En espera hasta el reinicio') : t('Ahora')}</div>
        {a.state === 'sin-uso' && lim ? (
          <div className="mt-1">
            <div className="t-title num" style={{ color: 'var(--red)' }}>{countdown(lim.resetsAt, now)}</div>
            <div className="t-small c2 mt-0.5">
              {t('Vuelve')} {t('{v0} · límite {v1}', { v0: whenFull(lim.resetsAt, now), v1: lim.kind === 'semanal' ? t('semanal') : t('de 5 horas') })}
              {a.assigned.length > 0 && <> · <b>{a.assigned.length}</b> {a.assigned.length === 1 ? t('tarea espera') : t('tareas esperan')}</>}
            </div>
          </div>
        ) : (
          <div className="mt-1">
            <div className="t-body clamp-2" style={{ fontWeight: 560 }}>
              {title ?? <span className="c3">{a.stateReason}</span>}
            </div>
            {otherProject && <div className="t-small mt-0.5" style={{ color: 'var(--teal)' }}>{t('En otro proyecto: {otherProject}', { otherProject: otherProject })}</div>}
            {task && (
              <div className="t-small c3 mt-1 truncate">
                {t('Tarea:')} {task.extId ? <b className="c2">{task.extId}</b> : null} {task.title}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="px-5 pt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 t-small c2">
        <span className="flex items-center gap-1.5 min-w-0"><Clock size={13} className="c3 flex-none" /><span className="truncate">{a.lastActivityAt ? ago(a.lastActivityAt, now) : t('Sin actividad')}</span></span>
        <span className="flex items-center gap-1.5 min-w-0"><Hourglass size={13} className="c3 flex-none" /><span className="truncate">{s?.startedAt ? t('Sesión de {v0}', { v0: duration(now - s.startedAt) }) : '—'}</span></span>
        <span className="flex items-center gap-1.5 min-w-0"><FolderGit2 size={13} className="c3 flex-none" /><span className="truncate">{s?.worktree ?? (s ? s.cwd.split(/[\\/]/).pop() : '—')}</span></span>
        <span className="flex items-center gap-1.5 min-w-0"><Cpu size={13} className="c3 flex-none" /><span className="truncate">{modelName(a.model) ?? t('Modelo sin datos')}</span></span>
        {s?.branch && <span className="flex items-center gap-1.5 min-w-0 col-span-2"><GitBranch size={13} className="c3 flex-none" /><span className="truncate">{s.branch}</span></span>}
      </div>

      <div className="mx-5 mt-4 mb-4 p-3.5 well flex flex-col gap-3" style={near ? { boxShadow: 'inset 0 0 0 1px color-mix(in srgb, var(--orange) 45%, transparent)' } : undefined}>
        <UsageRow label={t('Ventana de 5 horas')} w={snap?.fiveHour} capturedAt={snap?.capturedAt} now={now} />
        <UsageRow label={t('Semana')} w={snap?.sevenDay} capturedAt={snap?.capturedAt} now={now} />
        <div className="flex items-center justify-between t-small c3">
          <span className="truncate">
            {snap ? t('Última lectura {v0}', { v0: ago(snap.capturedAt, now) }) : lim ? t('Límite registrado {v0} (wake.log)', { v0: ago(lim.at, now) }) : t('Aún no hay lectura de consumo')}
            {snap && now - snap.capturedAt > STALE_MS && <span style={{ color: 'var(--orange)' }}> {t('· desactualizado')}</span>}
          </span>
          <ChevronRight size={14} className="flex-none opacity-0 group-hover:opacity-100 transition-opacity" />
        </div>
      </div>
      {a.identity.emailMismatch && (
        <div className="mx-5 mb-4 -mt-1 t-small flex items-center gap-2" style={{ color: 'var(--red)' }}>
          <CircleAlert size={14} /> {t('Su carpeta tiene iniciada otra cuenta: {email}', { email: a.identity.email })}
        </div>
      )}
    </motion.button>
  )
}
