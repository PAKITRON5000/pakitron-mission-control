// Shared shapes between the core, the main process and the interface. Every value that comes from outside says where it
// came from (`source`) and when it was read, so the interface never shows a number it cannot back up.

/** claude1, claude2...: the user can add and remove accounts in Ajustes, so the number is open. */
export type AccountId = `claude${number}`
export const ACCOUNT_IDS: AccountId[] = ['claude1', 'claude2', 'claude3', 'claude4']
export const isAccountId = (s: unknown): s is AccountId => typeof s === 'string' && /^claude\d{1,2}$/.test(s)

export interface AccountConfig {
  id: AccountId
  alias: string
  /** Empty means Claude Code's default (~/.claude), which is how claude1.cmd launches it. */
  configDir: string
  emailExpected?: string
  color: string
  /** EV99: the name the user gives it in the app. Only shown: launching and what the Claudes are told keep the id. */
  name?: string
}

export interface AccountIdentity {
  email?: string
  /** True when the folder holds a login for an account other than the one expected. */
  emailMismatch: boolean
  /** A credentials file exists, or `claude auth status` said it is signed in another way (EV146). Its content is never read. */
  hasLogin: boolean
  /** EV146: its plan or way of signing in, from `claude auth status`, and whether Claude Code tells apps its usage. */
  plan?: PlanInfo
}

/** EV146 (the user: «que funcione y puedan conectar sus cuentas sea el plan que sea»). */
export interface PlanInfo {
  /** «Pro», «Max 20x», «Team», «Pago por uso (clave)», «Amazon Bedrock»… */
  label: string
  /** Claude Code gives the 5-hour and weekly usage (statusLine `rate_limits`) only to Pro, Max and Ultra. */
  limits: boolean
  /** For one without them: what the app can and cannot know. */
  note?: string
  /** A key, Console or a cloud: every request costs money, so the app never asks it anything by itself (no usage probe). */
  paysPerUse?: boolean
}

export interface UsageWindow {
  usedPct: number
  /** Epoch ms. */
  resetsAt: number
}

export interface UsageSnapshot {
  account: AccountId
  capturedAt: number
  fiveHour?: UsageWindow
  sevenDay?: UsageWindow
  spend?: { usedPct: number; resetsAt: number; usedUsd?: number; limitUsd?: number }
  model?: string
  sessionId?: string
  source: 'statusline'
}

export type LimitKind = '5 horas' | 'semanal' | 'limite'

export interface LimitHit {
  kind: LimitKind
  at: number
  resetsAt: number
  sessionShort?: string
  /**
   * credits_txt and wake_log: The game project's wake hook (only sessions in that project). transcript: the limit message in
   * the conversation itself, with the exact reset the API gave (any project). statusline: a window read at 100 %.
   */
  source: 'credits_txt' | 'wake_log' | 'transcript' | 'statusline'
}

export interface AccountUsage {
  snapshot?: UsageSnapshot
  /** The most recent limit the account ran into that has not reset yet, if any. */
  activeLimit?: LimitHit
  /** Minutes until the 5 hours run out at the pace of the last readings. An estimate, and shown as one. */
  minutesLeft?: number
  /** Last limit seen at all, even if it already reset. */
  lastLimit?: LimitHit
  history: { at: number; five?: number; week?: number; fiveResets?: number; weekResets?: number }[]
}

export type SessionKind = 'interactive' | 'background'

export interface LiveSession {
  sessionId: string
  shortId: string
  pid?: number
  cwd: string
  kind: SessionKind
  name?: string
  /** idle | busy | waiting, as `claude agents --json` reports it. */
  status?: string
  /** For background sessions: running | blocked | done ... */
  state?: string
  waitingFor?: string
  startedAt?: number
  projectId?: string
  worktree?: string
  // Filled from the conversation file's tail (read only).
  model?: string
  lastActivityAt?: number
  title?: string
  lastPrompt?: string
  branch?: string
  rateLimited?: boolean
  /** EV146: stopped because its key or Console account ran out of credit (no reset time: it is back when recharged). */
  noCredit?: boolean
  // Filled from the statusLine, when installed.
  contextPct?: number
  costUsd?: number
}

export type AgentState = 'trabajando' | 'esperando' | 'sin-uso' | 'bloqueado' | 'disponible' | 'desconectado' | 'apartada' | 'baja'

export interface Heartbeat {
  at: number
  account?: AccountId
  text: string
  file: string
}

export interface AgentCard {
  id: AccountId
  alias: string
  color: string
  configDir: string
  identity: AccountIdentity
  state: AgentState
  stateReason: string
  sessions: LiveSession[]
  usage: AccountUsage
  heartbeat?: Heartbeat
  lastActivityAt?: number
  model?: string
  projectId?: string
  /** Tasks in TASKS.md that name this account and are not done. */
  assigned: { extId?: string; title: string; status: TaskStatus; projectId?: string }[]
  /** When `claude agents --json` answered for this account (undefined: it failed). */
  sessionsReadAt?: number
  sessionsError?: string
}

export type TaskStatus =
  | 'idea'
  | 'pendiente'
  | 'planificada'
  | 'en-desarrollo'
  | 'bloqueada'
  | 'pendiente-integracion'
  | 'en-pruebas'
  | 'revision'
  | 'terminada'

export interface Task {
  id: number
  /** Stable key (the TASKS.md id, or a hash of the title) shared with reservations. */
  key: string
  projectId: string
  extId?: string
  title: string
  detail: string
  status: TaskStatus
  /** What TASKS.md says, when the user moved the task in the app. */
  fileStatus?: TaskStatus
  section: string
  priority: number
  owner?: AccountId
  source: 'TASKS.md' | 'app'
  sourceFile?: string
  sourceLine?: number
  createdAt: number
  updatedAt: number
  /** Raw checkbox from TASKS.md: ' ', '~' or 'x'. */
  mark?: string
  verified: boolean
  /** Done, and its text says the user has yet to see it. */
  waitingLook?: boolean
  /** The user reviewed it and asked for changes that are not done yet. */
  change?: TaskChange
  /** Those changes are done and it waits for the user to look again. */
  changeDone?: TaskChange
  /** The last time the project's checks ran for this task (pmc verifica <ID>): proof, not the agent's word. */
  checks?: { outcome: 'bien' | 'falla'; at: number; summary: string }
  /** From its text in TASKS.md (EV8): the unfinished tasks it waits for, the ones waiting for it, the model that is enough and the single-use resources it needs. */
  waitsFor?: string[]
  unblocks?: string[]
  model?: string
  needs?: string[]
}

export interface TaskChange {
  id: number
  projectId: string
  taskKey: string
  extId?: string
  /** What the user wrote, as written. */
  note: string
  status: 'pedido' | 'hecho' | 'quitado'
  /** Who it is for; none: the first that works. */
  target?: AccountId
  /** For right now: it goes before everything else. */
  urgent: boolean
  instructionId?: number
  /** When it reached the Claude. */
  readAt?: number
  createdAt: number
  updatedAt: number
  doneAt?: number
}

export interface ProjectConfig {
  id: string
  name: string
  root: string
  /** Extra folders that belong to the project (worktrees, mirrors). */
  copies: { path: string; label: string; branch?: string }[]
  docsDirs: string[]
  mediaDirs: string[]
  /** Folders the user took out of the gallery: the automatic detection must not bring them back. */
  mediaExcluded?: string[]
  color: string
  createdAt: number
  readOnly: boolean
  /** Explicit permission to write into the project's Buzón.md. Off by default. */
  allowBuzon: boolean
}

export interface DocSource {
  file: string
  mtime: number
  copy: string
}

export interface ProjectSummary {
  project: ProjectConfig
  tasks: { total: number; done: number; doing: number; open: number; verified: number; checked?: number; review: number; blocked: number }
  tasksSource?: DocSource
  relevoSource?: DocSource
  heartbeats: Heartbeat[]
  lastActivityAt?: number
  alerts: Alert[]
  copies: CopyStatus[]
}

export interface CopyStatus {
  path: string
  label: string
  branch?: string
  head?: string
  headSubject?: string
  headAt?: number
  dirty: number
  untracked: number
  /** EV94: the paths `git status` lists (relative to the copy; a folder ends in «/»), up to 400. */
  changed?: string[]
  ahead?: number
  readAt: number
  error?: string
}

export interface Alert {
  level: 'info' | 'warn' | 'critical'
  text: string
  account?: AccountId
}

export type AssetKind = 'image' | 'video' | 'model' | 'audio' | 'other'

export interface Asset {
  id: number
  projectId: string
  path: string
  rel: string
  name: string
  kind: AssetKind
  category: string
  size: number
  mtime: number
  firstSeen: number
  hash?: string
  width?: number
  height?: number
  account?: AccountId
  taskExtId?: string
  status: 'nuevo' | 'en-revision' | 'aprobado' | 'con-cambios'
  openComments: number
}

export type CommentStatus = 'pendiente' | 'recibido' | 'en-correccion' | 'corregido' | 'esperando-revision' | 'aprobado' | 'reabierto'

export interface Comment {
  id: number
  projectId: string
  assetId?: number
  x?: number
  y?: number
  timeSec?: number
  shape?: 'pin' | 'circle' | 'rect' | 'arrow' | 'pen'
  /** circle: r (fraction of width); arrow: x2, y2 (fractions); pen: pts (fractions); 3D: p. */
  geom?: { r?: number; x2?: number; y2?: number; p?: [number, number, number]; pts?: [number, number][] }
  /** Video comments: the captured frame, saved next to Mission Control's data. */
  framePath?: string
  /** A copy of the file as it was when the user wrote the note: a Claude saving a new image with the same name cannot take it away. */
  keptPath?: string
  /** The asset's modification time when commented: which version the comment refers to. */
  assetMtime?: number
  body: string
  status: CommentStatus
  target?: AccountId
  createdAt: number
  updatedAt: number
  instructionId?: number
  history: { at: number; status: CommentStatus; note?: string }[]
}

export type InstructionKind = 'nota' | 'idea' | 'tarea' | 'correccion' | 'prioridad' | 'mensaje' | 'general'
export type DeliveryStatus = 'guardada' | 'pendiente-entrega' | 'entregada' | 'recibida' | 'ejecutada' | 'fallida' | 'anulada'

export interface Instruction {
  id: number
  projectId: string
  kind: InstructionKind
  body: string
  target?: AccountId
  status: DeliveryStatus
  /** Where it was delivered, when it was: the Buzón file, an outbox file... */
  channel?: string
  createdAt: number
  updatedAt: number
  deliveredAt?: number
  commentId?: number
  assetId?: number
  error?: string
}

export interface TimelineEvent {
  id: number
  projectId?: string
  at: number
  account?: AccountId
  kind: string
  title: string
  detail?: string
  source: string
  ref?: string
}

/** EV131: the eight shapes of the app (renderer/src/layouts/meta.ts says what each is). */
export type LayoutId = 'pestanas' | 'lateral' | 'columna' | 'tablero' | 'consola' | 'dividida' | 'mosaico' | 'mapa'

export interface Settings {
  /** The notice's tone (see renderer/lib/ding.ts) and its volume, 0 to 100. */
  notifyTone?: string
  notifyVolume?: number
  /** From midnight to nine it only flashes, without sound. */
  quietNights?: boolean
  theme: 'system' | 'dark' | 'light'
  reduceMotion: 'system' | 'on' | 'off'
  activeProjectId?: string
  density: 'comfortable' | 'compact'
  /** «Próximo»: the order the user wants the accounts to start in (empty: by when each comes back). */
  nextOrder?: string[]
  /** The same turn, kept by project: each project has its own (the user, 12-11). `nextOrder` is the old, shared one. */
  nextOrderBy?: Record<string, string[]>
  /** When the app last wrote each account's hooks: windows opened before keep the old ones (Claude Code reads them at start). */
  hooksAt?: Record<string, number>
  /** Folders the user does not want as projects (Decidir #119: The video project): «Añadirlo como proyecto» is not offered for them. */
  declinedFolders?: string[]
  /** Projects taken out of autonomous mode (EV28): their sessions may end their turn even with the mode on. */
  autonomyOff?: string[]
  /** Routines per project (EV44, core/routines.ts): what the user chose; missing means the defaults. */
  routines?: Record<string, { trasCommit?: boolean; noche?: boolean; hora?: string }>
  /** Backups of the projects on another disk (EV44, core/backup.ts; Decidir #135: G:\Copias de proyectos). Missing: the defaults. */
  backup?: { on?: boolean; dir?: string; hora?: string; off?: string[] }
  /** Starts scheduled with Windows' Task Scheduler (Próximo › Programar arranque), by account. */
  schedules?: Record<string, { at: number; projectId: string }>
  /** The app version that already opened the installer of a missing Git once (main/index.ts › offerMissingTools). */
  toolsOfferedFor?: string
  /** What only the user knows about an account: set aside (not to be used) or no longer paid. Absent: in use. */
  accountStatus?: Record<string, 'pausada' | 'baja' | undefined>
  /** EV68: the user hid «Primeros pasos» (Inicio); it comes back only while there is no project. */
  firstRunDone?: boolean
  /** Backup accounts (IV1, core/reserve.ts): opened on their project when every other account in use is out of usage. */
  reserves?: { account: AccountId; projectId: string; on: boolean; note?: string; marginMin?: number }[]
  /** Accounts the user marked as out of Fable: Claude Code does not report each model's limit. */
  noFable?: string[]
  /** When an account stops for its limit in the middle of a project, open the next one there to take over. */
  autoRelay?: boolean
  /** Automatic distribution (EV20): the app opens accounts by itself on projects with tasks left and nobody on them. */
  autoPlan?: boolean
  /** Accounts at once on one project when the app distributes by itself (default 1). */
  maxFronts?: number
  /** «La he recargado» (set by hand, by account): limits hit before that time no longer count. */
  recharged?: Record<string, number>
  /** Autonomous mode: sessions are told to go on while their project has work, and are started again when their usage is back. */
  autonomous?: boolean
  /**
   * EV128: who set the way of working. 'app': chosen by the app for the accounts there are (first start), and kept fitting
   * them as accounts are signed in; 'usuario' (or unset, as before 0.32.1): the user's choice, never changed by the app.
   */
  workModeBy?: 'app' | 'usuario'
  /**
   * EV140 (Decidir #147 «B»): when the user read Anthropic's rules and turned on the hand-over between accounts. Until then
   * a new install keeps each account on its own work; on a PC that already had the app, it was set on updating.
   */
  relayRulesAt?: number
  /** EV142: the app version whose subagents are already written in every project (a new one rewrites the marked ones). */
  agentsVersion?: string
  /** EV141 (Decidir #148 «A»): the wheel gives turns to background sessions instead of windows. Off unless the user turns it on. */
  bgSessions?: boolean
  /** EV149 (Decidir #150): an editor the user has open (Premiere…) does not hold heavy work back. Playing still does. */
  fullPower?: boolean
  /**
   * How the accounts hand over (the user, 12-11): 'conjunto', the next one goes on with the work of the one that stopped,
   * on its project; 'proyecto', each keeps to its own project and takes it up again in its own window when it comes back.
   */
  relayMode?: 'conjunto' | 'proyecto'
  /** With one project each: heavy work (Unity, Blender) by turns; one that comes back while another has it running waits. */
  heavyTurns?: boolean
  /** The relay wheel of each project (core/chain.ts, «Relevos»): who works, in what order, round and round. */
  relayChains?: Record<string, import('./chain').RelayChain | undefined>
  /** The look of the whole app (EV82, renderer/looks.css): the base, or one of the three proposed to the user. */
  /** EV88: what the app answers to a «1. Yes / 2. No» nobody answers (default «todo»: the user, 13-11: «siempre yes, 1») and after how many minutes (default 3). */
  awayPolicy?: 'seguro' | 'todo' | 'esperar'
  awayMinutes?: number
  /** Requests the user closed in Memoria («Ya está / no hace falta», EV64), by hash. */
  requestsClosed?: string[]
  /** The wheel closes the idle windows of accounts out of usage (the user, 13-11); off only if set to false. */
  closeIdleWindows?: boolean
  look?: 'sobria' | 'viva' | 'ludica' | 'mando' | 'neon' | 'comic'
  /**
   * EV131 (the user, 13-11: «al menos 8 estilos de app muy diferentes visualmente… no me refiero a más colores»): the
   * shape of the whole app, renderer/src/layouts. Where everything is and how one moves; the same screens underneath.
   */
  layout?: LayoutId
  /**
   * The size of the whole app, as a zoom (13-11, the user: «la interfaz es muy pequeña y difícil de leer»). Missing: 1.25
   * on a wide screen (2560 px or more), 1.1 otherwise (main/index.ts › uiScale).
   */
  uiScale?: number
  /** EV161: the language of the app and of what the Claudes are told («es», «en»); none: the system's. */
  lang?: 'es' | 'en'
  /**
   * EV156: where the Claudes the app opens live: in their own console window ('ventana', the default) or inside the app,
   * in Chats ('app'), where each one can be popped out to a window of its own and docked again.
   */
  sessionsWhere?: 'ventana' | 'app'
  /**
   * EV96 (Decidir #130 «B»): Claude Code's gifted limit resets (`/limit-reset`): used by the app at the best moment
   * ('sola', the default), only told to the user ('avisar'), or left alone ('no').
   */
  smartRecharge?: 'sola' | 'avisar' | 'no'
  /** EV171: when «Mejorar mi proyecto» was last asked for each project (by itself on adding it, at most once a week). */
  improveAsked?: Record<string, number>
  /** EV100: projects where what was set aside and nobody asked for goes to the bin by itself (smart deletion). */
  smartClean?: Record<string, boolean>
  /**
   * EV101: accounts the app itself marked out of Fable (at «You've reached your Fable limit», with no Fable reset to use),
   * and when the mark ends (their week's reset). They are in `noFable` meanwhile; the user's own marks are not here.
   */
  fableAuto?: Record<string, number>
  /** EV96: what each account's window showed about its reset at the limit, and when the app used one (main/recharge.ts). */
  resets?: Record<string, { available: boolean; kinds?: string[]; left?: number; useBy?: string; seenAt: number; usedAt?: number; lastTryAt?: number; tries?: number; noneAt?: number }>
  /** EV87: the colour theme over the look (lib/themes.ts › PALETTES); «clasico» or none is the base. */
  palette?: string
}

/** What an account is doing, from its own hooks (no usage spent): the last tool it ran, what it said when it stopped. */
export interface Activity {
  at: number
  sessionId?: string
  cwd?: string
  event: string
  text: string
  file?: string
}

export interface AccountActivity {
  now?: Activity
  recent: Activity[]
  lastMessage?: { at: number; text: string }
  /** What it says it is working on, in one sentence for the user (`pmc ahora`), and what it said before. */
  focus?: { at: number; text: string; sessionId?: string }
  focusHistory: { at: number; text: string }[]
}

export type DecisionStatus = 'pendiente' | 'decidida' | 'descartada'

export interface DecisionMedia {
  path: string
  source?: string
  caption?: string
  group?: string
  kind?: 'image' | 'audio' | 'video' | 'other'
}

export interface DecisionOption {
  id: string
  label: string
  detail?: string
}

/** Something a Claude needs the user to decide or approve, with the pictures to decide it. */
export interface Decision {
  id: number
  projectId: string
  title: string
  question: string
  context: string
  options: DecisionOption[]
  /**
   * Pictures, sounds and videos to decide on, copied by Mission Control (the originals may be overwritten). `caption`
   * says what it is, `group` what it is for (a moment of the game, a screen…), `source` where it came from.
   */
  images: DecisionMedia[]
  /** What the user liked or not of each one (index into `images`). */
  reactions?: Record<number, 'si' | 'no'>
  askedBy?: AccountId
  taskExtId?: string
  /** 0 urgente · 1 alta · 2 normal · 3 baja, as tasks. */
  priority: number
  status: DecisionStatus
  choice?: string
  note?: string
  instructionId?: number
  createdAt: number
  updatedAt: number
  decidedAt?: number
  /** When the Claude that asked received the answer. */
  deliveredAt?: number
  /** EV79: the option taken if nobody answers by `waitUntil` (an option id). */
  defaultChoice?: string
  waitUntil?: number
}

export const PRIORITY_LABEL = ['Urgente', 'Alta', 'Normal', 'Baja'] as const
