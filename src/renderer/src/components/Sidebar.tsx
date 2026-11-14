import { motion } from 'motion/react'
import { t } from '../../../core/i18n'
import { LayoutGrid, Users, ListChecks, Images, MessageSquareText, Clock, GitBranch, Brain, Settings, Gavel, CalendarClock, MessageCircle, Repeat, Puzzle, Sparkles } from 'lucide-react'
import { useStore, type Route } from '../lib/store'
import { SPRING, ACCOUNT_COLOR, STATE_META, accLabel, accName } from './ui'

// Grouped by what the user comes for (13-11, «que todo fluya mejor»): what waits for him, the Claudes, the project.
export type NavGroup = 'tuyo' | 'claude' | 'proyecto' | 'ajustes'
export const NAV: { route: Route; label: string; icon: typeof LayoutGrid; color: string; group: NavGroup }[] = [
  { route: 'inicio', get label() { return t('Inicio') }, icon: LayoutGrid, color: 'var(--blue)', group: 'tuyo' },
  { route: 'decisiones', get label() { return t('Decidir') }, icon: Gavel, color: 'var(--red)', group: 'tuyo' },
  { route: 'revisiones', get label() { return t('Revisar') }, icon: MessageSquareText, color: 'var(--yellow)', group: 'tuyo' },
  // EV85: last of «lo tuyo», so Ctrl+1…3 stay where they were.
  { route: 'asistente', get label() { return t('Asistente') }, icon: Sparkles, color: 'var(--indigo)', group: 'tuyo' },
  { route: 'relevos', get label() { return t('Relevos') }, icon: Repeat, color: 'var(--green)', group: 'claude' },
  { route: 'proximo', get label() { return t('Próximo') }, icon: CalendarClock, color: 'var(--indigo)', group: 'claude' },
  { route: 'chats', get label() { return t('Chats') }, icon: MessageCircle, color: 'var(--teal)', group: 'claude' },
  { route: 'agentes', get label() { return t('Cuentas') }, icon: Users, color: 'var(--purple)', group: 'claude' },
  { route: 'skills', get label() { return t('Skills') }, icon: Puzzle, color: 'var(--pink)', group: 'claude' },
  { route: 'tareas', get label() { return t('Tareas') }, icon: ListChecks, color: 'var(--orange)', group: 'proyecto' },
  { route: 'galeria', get label() { return t('Galería') }, icon: Images, color: 'var(--pink)', group: 'proyecto' },
  { route: 'cronologia', get label() { return t('Cronología') }, icon: Clock, color: 'var(--indigo)', group: 'proyecto' },
  { route: 'integracion', get label() { return t('Ramas') }, icon: GitBranch, color: 'var(--gray)', group: 'proyecto' },
  { route: 'memoria', get label() { return t('Memoria') }, icon: Brain, color: 'var(--teal)', group: 'proyecto' },
  { route: 'ajustes', get label() { return t('Ajustes') }, icon: Settings, color: 'var(--gray)', group: 'ajustes' }
]

function Item({ n, on, collapsed, badge, onClick }: { n: (typeof NAV)[number]; on: boolean; collapsed: boolean; badge?: number; onClick: () => void }) {
  const I = n.icon
  return (
    <div className="nav-item" onClick={onClick} role="link" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && onClick()} title={collapsed ? n.label : undefined} aria-current={on ? 'page' : undefined}
      style={collapsed ? { justifyContent: 'center', padding: 0 } : undefined}>
      {on && <motion.div layoutId="nav-active" className="absolute inset-0 rounded-[7px]" style={{ background: 'var(--fill-2)' }} transition={SPRING} />}
      <span className="icon-sq" style={{ background: n.color, color: n.color === 'var(--yellow)' ? '#3a2a00' : 'white' }}><I size={13} strokeWidth={2.3} /></span>
      {!collapsed && <span className="relative truncate">{n.label}</span>}
      {!collapsed && badge ? <span className="badge num" style={{ color: 'white', background: 'var(--red)', borderRadius: 99, padding: '0 7px', fontWeight: 650 }}>{badge}</span> : null}
      {collapsed && badge ? <span className="absolute right-1.5 top-1 w-2 h-2 rounded-full" style={{ background: 'var(--red)' }} /> : null}
    </div>
  )
}

/** EV118: a screen's icon and colour as in the menu, next to its big title (some screens had it and others not). */
export function ScreenIcon({ route }: { route: Route }) {
  const n = NAV.find((x) => x.route === route)
  if (!n) return null
  const I = n.icon
  return <span className="icon-sq icon-sq-lg flex-none" style={{ background: n.color, color: n.color === 'var(--yellow)' ? '#3a2a00' : 'white' }}><I size={17} /></span>
}

export function Sidebar({ width, collapsed }: { width: number; collapsed: boolean }) {
  const { route, go, state, setAgentOpen } = useStore()
  const s = state?.summary
  // A red mark wherever something waits for the user: finished tasks in Tareas, finished corrections in Revisar, questions in Decidir.
  // Decidir counts every project: a question in the project that is not on screen is still a question (12-11).
  const allDecisions = Object.values(state?.pending ?? {}).reduce((n, x) => n + x.decisions, 0)
  const badge: Partial<Record<Route, number>> = { tareas: s?.tasks.review || undefined, revisiones: state?.commentsToReview || undefined, decisiones: allDecisions || undefined }
  return (
    <nav className="sidebar" style={{ width }} aria-label={t('Navegación')}>
      <div className="flex-1 overflow-y-auto pt-2 pb-2">
        {NAV.filter((n) => n.group === 'tuyo').map((n) => <Item key={n.route} n={n} on={route === n.route} collapsed={collapsed} badge={badge[n.route]} onClick={() => go(n.route)} />)}

        {!collapsed ? <div className="side-label">{t('Los Claude')}</div> : <div className="h-4" />}
        {NAV.filter((n) => n.group === 'claude').map((n) => <Item key={n.route} n={n} on={route === n.route} collapsed={collapsed} badge={badge[n.route]} onClick={() => go(n.route)} />)}
        <div className="h-1.5" />
        {(state?.agents ?? []).filter((a) => a.state !== 'baja' && a.state !== 'apartada').map((a) => (
          <div key={a.id} className="nav-item" onClick={() => setAgentOpen(a.id)} role="button" tabIndex={0} title={`${accLabel(a.id)} · ${STATE_META[a.state].label}${state?.activity?.[a.id]?.focus ? ' · ' + state.activity[a.id].focus!.text : ''}`}
            style={collapsed ? { justifyContent: 'center', padding: 0 } : undefined}>
            <span className="icon-sq num" style={{ background: ACCOUNT_COLOR[a.id], fontSize: 12, fontWeight: 700 }}>
              {a.id.slice(6)}
              <span className={`absolute -right-[3px] -bottom-[3px] w-[9px] h-[9px] rounded-full ${a.state === 'trabajando' ? 'live-dot' : ''}`}
                style={{ background: STATE_META[a.state].color, color: STATE_META[a.state].color, boxShadow: '0 0 0 2px var(--bg-elev)' }} />
            </span>
            {!collapsed && (
              <span className="min-w-0 flex-1 flex flex-col leading-tight">
                <span className="flex items-baseline gap-1.5 min-w-0"><span className="truncate flex-none">{accName(a.id)}</span><span className="t-small truncate" style={{ color: a.state === 'sin-uso' ? 'var(--red)' : 'var(--label-3)' }}>{STATE_META[a.state].label}</span></span>
              </span>
            )}
          </div>
        ))}

        {!collapsed ? <div className="side-label truncate">{state?.projects.find((p) => p.id === state.activeProjectId)?.name ?? t('Proyecto')}</div> : <div className="h-4" />}
        {NAV.filter((n) => n.group === 'proyecto').map((n) => <Item key={n.route} n={n} on={route === n.route} collapsed={collapsed} badge={badge[n.route]} onClick={() => go(n.route)} />)}
      </div>
      <div className="pb-2 pt-1" style={{ borderTop: '0.5px solid var(--sep)' }}>
        {NAV.filter((n) => n.group === 'ajustes').map((n) => <Item key={n.route} n={n} on={route === n.route} collapsed={collapsed} onClick={() => go(n.route)} />)}
      </div>
    </nav>
  )
}
