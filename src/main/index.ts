import { app, BrowserWindow, ipcMain, Menu, nativeImage, nativeTheme, Notification, protocol, shell, dialog, clipboard, screen, Tray } from 'electron'
import { askChange, removeChange, responsibleFor, updateChange } from '../core/changes'
import { createReadStream, existsSync, mkdirSync, statSync, writeFileSync, readdirSync, readFileSync, realpathSync, unlinkSync } from 'node:fs'
import { basename, join, extname, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Readable } from 'node:stream'
import { spawn, execFile } from 'node:child_process'
import { constants as osConstants, homedir, setPriority } from 'node:os'
import { Service, timed, nodeArgs } from './service'
import { createModelThumbs } from './modelThumbs'
import { AttentionBell, WaitCounter } from '../core/attentionBell'
import { AnswerWatch } from '../core/answerWatch'
import { createRemote } from './remote'
import { bringToFront, fontLine, fontPrefix, readScreen, typeKey, typeText } from './consoleTyper'
import { LATEST_URL, updateFrom, type UpdateInfo } from '../core/updates'
import { closePosixClaude, openTerminalWindow, writeTerminalScript, type TerminalJob } from './terminal'
import { asTasklist, fixPosixPath, isMac, isWin, PROCESS_LIST, shQuote } from '../core/platform'
import { markOpening, markTyped, noteStatus, pickNoteRoute, sentNotes, typedNoteText, type NoteRoute } from '../core/notes'
import { t, tn, pickLang, setLang } from '../core/i18n'
import { answerPrompt, endedTurnSince, onlyTaskFinished, onlyTaskOf, onlyTaskPrompt, readClosedOnly, readOnlyTasks, rememberClosed, reopenForAnswer, setOnlyTask } from '../core/onlytask'
import { readChat } from '../core/chats'
import { paths } from '../core/paths'
import type { AccountConfig, AccountId, CommentStatus, InstructionKind, ProjectConfig, TaskStatus } from '../core/types'
import { setTaskStatus, listTasks } from '../core/engine'
import { addComment, addInstruction, deliverToBuzon, listComments, listInstructions, setCommentStatus, setInstructionStatus, guessKind, buzonLine, editComment, deleteComment } from '../core/review'
import { installStatusLine, uninstallStatusLine, statusLineState } from '../core/integrations'
import { claudeInstalled, envFor, findClaude, findTranscript, projectsDir, projectsDirs, encodeCwd } from '../core/sessions'
import { nodeRunner, nodeShimPath } from '../core/shim'
import { addAppTask } from '../core/engine'
import { binnable, detectProject, integration, isInside, newestDoc, taskDiff } from '../core/projects'
import { queryAssets, assetFacets, assetFolder, galleryHome, type AssetQuery } from '../core/gallery'
import { detectAccounts } from '../core/accounts'
import { claudeJsonOf, ensureTrusted, projectFolders, trustEverywhere } from '../core/trust'
import { reserveDue, reservePrompt, reservedFor, reserveWrapUp, wrapUpText } from '../core/reserve'
import { conflictsOf } from '../core/contradict'
import { costByModel, heavyNow, taskCosts } from '../core/taskcost'
import { asideIn, bringBack, setAside } from '../core/skillaside'
import { gitExcludeOf, readMoved, returnSkill, takeSkillToProject } from '../core/skillmove'
import { pendingInstructions } from '../core/coord'
import { claimTask, listClaims, claimHistory, handoffText, addAssignment, assignedTasks, listAssignments, isWorkingOn, launchRefusal, moveAssignment, pruneAssignments, removeAssignment, scheduleAfterLaunch, setAssignmentOrder } from '../core/coord'
import { cardFile, getTaskCard, simpleText, taskCovers, taskMedia } from '../core/cards'
import { listJobs, removeJob } from '../core/jobs'
import { excludeClaudeMd, hooksState, installHooks, installProjectHooks, uninstallHooks } from '../core/integrations'
import { addEvent } from '../core/db'
import { addDecision, answerDecision, decisionImage, expireDecisions, listDecisions, reopenDecision } from '../core/decisions'
import { keepCopy, readActivity, writeProtected } from '../core/live'
import { addNotice, expireStaleRelays, nextTasks, protocolText } from '../core/coord'
import { bgResumeArgs } from '../core/bgsessions'
import { effortArgs, modelArgs } from '../core/models'
import { pickSuccessor, relayPrompt, shouldRelay, STATUS_LABEL } from '../core/relay'
import { backMessage, goMessage, heavyProjects, heavyTurns, relayModeOf, shouldCallBack, waitMessage, type Waiting } from '../core/turns'
import { addInstruction as addIns } from '../core/review'
import { improveOnAdd, improveText } from '../core/improve'
import { metrics } from '../core/metrics'
import { checkReadings, checkTools, type Check } from '../core/health'
import { readUsageHistory } from '../core/accounts'
import { detectBusy, doingOf, freeResource, heldResources, isLoaded, LOAD_ARGS, loadText, parseLoad, type Busy, type Load } from '../core/resources'
import { planFronts, staffGap } from '../core/plan'
import { ranks } from '../core/rank'
import { taskTags } from '../core/coord'
import { isSessionWorking } from '../core/working'
import { decideLaunch, workingMap, type AccountWindow, type LaunchDecision, type LaunchReason } from '../core/dispatch'
import { guessProject, pickAccount, type RouteAccount } from '../core/route'
import { RELAY_RULES, WORK_MODES, chainTurnsOnRelay, modeOf, settingsFor, turnsOnRelay, type WorkMode } from '../core/workmode'
import { detectProfile, prepareProject, profileAs, KIND_LABEL, looksLikeProject, refreshMarkedAgents } from '../core/profile'
import { templateClaudeMd, templateOf, templateTasks } from '../core/templates'
import { subagentUse } from '../core/subagentuse'
import { mcpLabel, mcpServers } from '../core/mcp'
import { listBackups, requestRestore } from '../core/restore'
import { leftUnsaved, projectHealth } from '../core/projecthealth'
import { lastVerification as lastCheckOf, readChecks as checksOf, type Check as ProjectCheck } from '../core/verify'
import { dueRoutines, remember, routineDefaults, type RoutineMemory, type RoutineProject } from '../core/routines'
import { createWheel, type Wheel } from './wheel'
import { createAssistant, type Assistant } from './assistant'
import { createRecharge, type Recharge } from './recharge'
import { createBackup } from './backup'
import { createProbe } from './probe'
import { hasUsage, probeWords } from '../core/probe'
import { createCleanup, type Cleanup } from './cleanup'
import { statfs } from 'node:fs/promises'
import { parseAuthStatus, loginWarning, type LoginState } from '../core/logins'
import { strictClashes } from '../core/mdclash'
import { awayAnswer, pendingToolUse, riskOf, yesOnScreen } from '../core/away'
import { addMemory, editMemory, forgetMemory, listMemories, recentDecisions, memoryText, MEMORY_KINDS } from '../core/memory'
import { classify, corpusOf, isRequest, placeRequest, textsSignature, type UserRequest } from '../core/requests'
import { readHistory } from '../core/sessions'
import { scanSkills, parseFind, parseList, pickSuggestions, projectToSearch, termsFor, skillsTally, mergeSkills, skillsStamp, type FoundSkill, type SkillInfo, type SkillsTally } from '../core/skills'
import { cpSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { exec } from 'node:child_process'

const here = dirname(fileURLToPath(import.meta.url))

// If Mission Control was started from a Claude Code session, drop the markers it inherited, so the sessions it opens
// (Abrir sesión, Retomar) are normal ones that save their conversation.
for (const k of ['CLAUDE_CODE_CHILD_SESSION', 'CLAUDECODE', 'CLAUDE_CODE_SESSION_ID', 'CLAUDE_PID', 'CLAUDE_EFFORT', 'CLAUDE_CODE_MESSAGING_SOCKET',
  'CLAUDE_CODE_MESSAGING_TOKEN', 'CLAUDE_CODE_SESSION_ATTENDED', 'CLAUDE_CODE_ENTRYPOINT', 'CLAUDE_CODE_EXECPATH', 'CLAUDE_CODE_SKIP_PROMPT_HISTORY', 'AI_AGENT', 'CLAUDE_CONFIG_DIR']) delete process.env[k]

// macOS: opened from the Finder or the Dock the app would not find node, git nor claude (core/platform.ts).
if (isMac) fixPosixPath()

protocol.registerSchemesAsPrivileged([
  { scheme: 'pmc', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true } }
])

// The visual review runs as its own instance (own cache folder) so it never disturbs the user's open window.
if (process.env.PMC_SHOT_DIR) app.setPath('userData', join(app.getPath('temp'), 'pmc-shots'))
else if (!app.requestSingleInstanceLock()) app.quit()

let win: BrowserWindow | undefined
let floating: BrowserWindow | undefined
let service: Service
/** The relay wheels (Relevos): created once the service is up. */
let wheel: Wheel
/** The assistant (EV85): answers from the app's data and passes requests on. */
let assistant: Assistant
/** Smart recharge (EV96): Claude Code's gifted limit resets, used at the best moment. */
let recharge: Recharge
/** A clean project (EV100): what takes space in each project and in which pile. */
let cleanup: Cleanup
/** EV115: a periodic job of the app, timed like the window's calls (service.ts › timed: «lento: <nombre> N ms (sola)»). */
function every(ms: number, name: string, fn: () => unknown): void {
  setInterval(() => timed((s) => service.log(s), name, fn), ms).unref()
}
/** EV44: each night, the projects' git history copied to another disk (Decidir #135: G:\Copias de proyectos). */
let backup: ReturnType<typeof createBackup>
/** EV120: asks Claude Code, with no window, whether an account believed out of usage has usage again. */
let probe: ReturnType<typeof createProbe>
let awayMemo: { from: number; at: number; v: ReturnType<Assistant['away']> } | undefined

/** EV98: each account's sign-in, as `claude auth status` gives it (no usage spent). */
const logins: Record<string, LoginState> = {}
/** `claude auth status` for a folder of accounts (free: it reads the sign-in, sends nothing to the model). */
function authStatus(acc: Pick<AccountConfig, 'configDir'>): Promise<LoginState | undefined> {
  return new Promise((resolve) => execFile(findClaude(), ['auth', 'status'], { env: envFor(acc as AccountConfig), windowsHide: true, timeout: 20_000 }, (_e, so, se) => resolve(parseAuthStatus(`${so ?? ''}${se ?? ''}`))))
}
async function checkLogins(): Promise<void> {
  for (const acc of service.accounts) {
    if (service.settings.accountStatus?.[acc.id]) continue
    const s = await authStatus(acc)
    if (s) logins[acc.id] = s
  }
  // EV146: kept for core/accounts.ts (a sign-in with no credentials file, and each account's plan). Method and plan only.
  try { writeFileSync(paths.logins(), JSON.stringify(logins, null, 1)) } catch { /* next round */ }
  service.push()
}

const MIME: Record<string, string> = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.bmp': 'image/bmp', '.avif': 'image/avif',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime', '.m4v': 'video/mp4', '.mkv': 'video/x-matroska',
  '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json', '.bin': 'application/octet-stream', '.fbx': 'application/octet-stream', '.obj': 'text/plain', '.ogg': 'audio/ogg', '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.flac': 'audio/flac'
}

function assetPath(id: number): string | undefined {
  const r = service.db.prepare('SELECT path FROM assets WHERE id = ?').get(id) as { path: string } | undefined
  if (r?.path && existsSync(r.path)) return r.path
  // The file is gone (or was replaced and then deleted): the copy kept when the user wrote a note on it.
  const k = service.db.prepare('SELECT kept_path FROM comments WHERE asset_id = ? AND kept_path IS NOT NULL ORDER BY created_at DESC LIMIT 1').get(id) as { kept_path: string } | undefined
  return k?.kept_path && existsSync(k.kept_path) ? k.kept_path : r?.path
}

async function serveFile(file: string, req: Request): Promise<Response> {
  const st = statSync(file)
  const type = MIME[extname(file).toLowerCase()] ?? 'application/octet-stream'
  const range = req.headers.get('range')
  const m = range?.match(/bytes=(\d*)-(\d*)/)
  if (m) {
    const start = m[1] ? Number(m[1]) : Math.max(0, st.size - Number(m[2]))
    const end = m[1] && m[2] ? Math.min(Number(m[2]), st.size - 1) : st.size - 1
    const stream = Readable.toWeb(createReadStream(file, { start, end })) as ReadableStream
    return new Response(stream, {
      status: 206,
      headers: { 'Content-Type': type, 'Content-Range': `bytes ${start}-${end}/${st.size}`, 'Accept-Ranges': 'bytes', 'Content-Length': String(end - start + 1) }
    })
  }
  const stream = Readable.toWeb(createReadStream(file)) as ReadableStream
  return new Response(stream, { headers: { 'Content-Type': type, 'Content-Length': String(st.size), 'Accept-Ranges': 'bytes', 'Cache-Control': 'max-age=60' } })
}

const thumbJobs = new Map<string, Promise<string | undefined>>()
function thumbnail(id: number, size: number): Promise<string | undefined> {
  const row = service.db.prepare('SELECT path, mtime, kind FROM assets WHERE id = ?').get(id) as { path: string; mtime: number; kind: string } | undefined
  if (!row) return Promise.resolve(undefined)
  row.path = assetPath(id) ?? row.path
  const dir = paths.thumbsDir()
  const out = join(dir, `${id}-${row.mtime}-${size}.jpg`)
  if (existsSync(out)) return Promise.resolve(out)
  const modelShot = join(dir, `${id}-${row.mtime}-model2.jpg`)
  if (row.kind === 'model') return Promise.resolve(existsSync(modelShot) ? modelShot : undefined)
  const key = out
  if (!thumbJobs.has(key)) {
    thumbJobs.set(
      key,
      (async () => {
        try {
          mkdirSync(dir, { recursive: true })
          const img = await nativeImage.createThumbnailFromPath(row.path, { width: size, height: size })
          if (img.isEmpty()) return undefined
          writeFileSync(out, img.toJPEG(84))
          const s = img.getSize()
          if (row.kind === 'image') service.db.prepare('UPDATE assets SET width = COALESCE(width, ?), height = COALESCE(height, ?) WHERE id = ?').run(s.width, s.height, id)
          return out
        } catch {
          return undefined
        } finally {
          setTimeout(() => thumbJobs.delete(key), 1000)
        }
      })()
    )
  }
  return thumbJobs.get(key)!
}

async function servePmc(req: Request): Promise<Response> {
  {
    try {
      const u = new URL(req.url)
      const id = Number(u.pathname.replace(/^\//, ''))
      if (u.host === 'file') {
        const f = assetPath(id)
        if (!f || !existsSync(f)) return new Response('no', { status: 404 })
        return await serveFile(f, req)
      }
      if (u.host === 'rel') {
        // pmc://rel/<id>/<path>: a file next to an indexed asset (a .gltf's .bin and textures). Never outside its folder.
        const [, idPart, ...rest] = u.pathname.split('/')
        const f = assetPath(Number(idPart))
        if (!f) return new Response('no', { status: 404 })
        const dir = dirname(f)
        const target = join(dir, ...rest.map((x) => decodeURIComponent(x)))
        if (!target.toLowerCase().startsWith(dir.toLowerCase()) || !existsSync(target)) return new Response('no', { status: 404 })
        return await serveFile(target, req)
      }
      if (u.host === 'converted') {
        const row = service.db.prepare('SELECT mtime FROM assets WHERE id = ?').get(id) as { mtime: number } | undefined
        const f = row ? join(paths.root(), 'converted', `${id}-${row.mtime}.glb`) : ''
        if (!f || !existsSync(f)) return new Response('no', { status: 404 })
        return await serveFile(f, req)
      }
      if (u.host === 'dimg') {
        // pmc://dimg/<decision>/<n>: a picture attached to a decision (Mission Control's own copy).
        const [, d, n] = u.pathname.split('/')
        const f = decisionImage(service.db, Number(d), Number(n))
        if (!f) return new Response('no', { status: 404 })
        return await serveFile(f, req)
      }
      if (u.host === 'card') {
        // pmc://card/<project>/<task>/<n>: a file of a task's card (Mission Control's own copy).
        const [, proj, ext, n] = u.pathname.split('/')
        const f = cardFile(service.db, decodeURIComponent(proj), decodeURIComponent(ext), Number(n))
        if (!f) return new Response('no', { status: 404 })
        return await serveFile(f, req)
      }
      if (u.host === 'kept') {
        // pmc://kept/<comment>: the file as it was when the user wrote that note.
        const r = service.db.prepare('SELECT kept_path FROM comments WHERE id = ?').get(id) as { kept_path?: string } | undefined
        if (!r?.kept_path || !existsSync(r.kept_path)) return new Response('no', { status: 404 })
        return await serveFile(r.kept_path, req)
      }
      if (u.host === 'thumb') {
        const size = Math.min(1024, Number(u.searchParams.get('s')) || 420)
        const f = await thumbnail(id, size)
        if (!f) return new Response('no', { status: 404 })
        return await serveFile(f, req)
      }
      return new Response('no', { status: 404 })
    } catch (e) {
      return new Response(String(e), { status: 500 })
    }
  }
}

function registerProtocol(): void {
  protocol.handle('pmc', servePmc)
}

// ---- launching sessions (only when the user presses a button) ---------------------------------------------------

function launcherFor(id: AccountId): string | undefined {
  if (!isWin) return undefined
  const f = join(process.env.USERPROFILE ?? '', 'claude-accesos', `${id}.cmd`)
  return existsSync(f) ? f : undefined
}

function openTerminal(account: AccountId, cwd: string, args: string[], title: string): void {
  const acc = service.accounts.find((a) => a.id === account)
  if (!acc) throw new Error(t('Cuenta desconocida'))
  if (!existsSync(cwd)) throw new Error(t('La carpeta no existe'))
  const safe = args.map((a) => (/^[\w.:/\\-]+$/.test(a) ? a : `"${a.replace(/"/g, '')}"`))
  // EV103: Claude Code would stop at «Is this a project you trust?» (with «No, exit» chosen) in a folder this account
  // has not trusted yet: marked here, before the window opens.
  const trust = ensureTrusted(claudeJsonOf(acc), [cwd])
  if (trust.added.length) service.log(`confianza: ${account} ya confía en ${trust.added.join(', ')}`)
  else if (trust.skipped) service.log(`confianza: ${account} en ${cwd}: ${trust.skipped}`)
  if (!isWin) { openTerminalWindow({ title, cwd, configDir: acc.configDir, argv: [findClaude(), ...args] }); return }
  const launcher = launcherFor(account)
  const cmdline = launcher ? [launcher, ...safe].join(' ') : [`"${findClaude()}"`, ...safe].join(' ')
  // EV151 (the user, 14-11 04:50: «no puedo ver los cmd bien… me gusta ver los cmd si quiero e interactuar con ellos»):
  // on Windows 11 a plain `start cmd` became one more tab of the same Windows Terminal window (six Claude sessions hidden
  // behind one tab). conhost.exe gives each session its own window; tried 14-11: the account's environment arrives whole
  // and no tab is added. The app still types into it the same way (AttachConsole).
  const child = spawn('cmd.exe', ['/d', '/s', '/c', `start "${title.replace(/"/g, '')}" conhost.exe cmd.exe /k ${fontPrefix()}${cmdline}`], {
    cwd,
    env: envFor(acc),
    detached: true,
    windowsHide: false,
    windowsVerbatimArguments: true,
    stdio: 'ignore'
  })
  child.unref()
}

/** EV103: the project folders (roots and copies) marked as trusted in every account that has started on this PC. */
function trustSweep(): void {
  // A capture run touches nothing outside its own data (the accounts' .claude.json are written by Claude Code too).
  if (process.env.PMC_SHOT_DIR) return
  try {
    const out = trustEverywhere(service.accounts, projectFolders(service.projects))
    const added = out.filter((r) => r.added.length)
    if (!added.length) return
    service.log(`confianza: ${added.map((r) => `${r.account} → ${r.added.join(', ')}`).join('; ')}`)
    addEvent(service.db, { projectId: service.projects[0]?.id ?? '', at: Date.now(), kind: 'relevo-app', title: t('Carpetas de confianza puestas solas'), detail: t('Para que ninguna ventana se pare a preguntar si confías en la carpeta: {v0}', { v0: added.map((r) => `Claude ${r.account.slice(6)}: ${r.added.join(', ')}`).join(' · ') }), source: 'Mission Control' })
  } catch (e) {
    service.log(`confianza: ${(e as Error).message}`)
  }
}

/**
 * EV52 (the user, 13-11, on Decidir #140: «quiero que todo sea lo más automático e intuitivo posible, es que no entiendo
 * bien la pregunta»): an account in use whose hooks are missing or out of date gets them from the app itself, with a copy
 * of its settings first, instead of a red row in Inicio for the user to press. Hooks in the project folders are not
 * needed: every account in use has its own (13-11), and both would run every hook twice on every tool. At most once a
 * day per account, so a check that keeps failing never piles up copies.
 */
const hooksSwept: Record<string, number> = {}
function hooksSweep(): void {
  if (process.env.PMC_SHOT_DIR || !service.nodeExe || !existsSync(service.pmcPath)) return
  const now = Date.now()
  for (const acc of service.accounts) {
    if (service.settings.accountStatus?.[acc.id]) continue
    if (service.agents.find((a) => a.id === acc.id)?.identity.hasLogin === false) continue
    if (now - (hooksSwept[acc.id] ?? 0) < 86400_000) continue
    const st = hooksState(acc)
    if (st.installed && !st.outdated) continue
    hooksSwept[acc.id] = now
    try {
      const r = installHooks(acc, service.nodeExe, service.pmcPath)
      service.setSettings({ hooksAt: { ...(service.settings.hooksAt ?? {}), [acc.id]: now } })
      service.log(`ganchos ${st.installed ? 'puestos al día' : 'puestos'} solos en ${acc.id} (copia: ${r.backup ?? 'sin archivo previo'})`)
      addEvent(service.db, { projectId: service.projects[0]?.id ?? '', at: now, account: acc.id, kind: 'relevo-app', title: t('La app ha {v0} sola los ganchos de Claude {v1}: ya se ve lo que hace y recibe los relevos (en las ventanas que abra desde ahora)', { v0: st.installed ? 'puesto al día' : 'puesto', v1: acc.id.slice(6) }), detail: r.backup ? t('Copia de su configuración anterior: {backup}', { backup: r.backup }) : undefined, source: 'Mission Control' })
      service.push()
    } catch (e) {
      service.log(`ganchos de ${acc.id}: ${(e as Error).message}`)
    }
  }
}

/** Slow reads kept for a while by the window's calls, and the calls that make them stale (the IPC handler). */
const SLOW_READS: Record<string, { ms: number; clearedBy: RegExp }> = {
  requests: { ms: 5 * 60_000, clearedBy: /request/i },
  health: { ms: 2 * 60_000, clearedBy: /health|hook|statusline|install|tool|login/i },
  away: { ms: 60_000, clearedBy: /away|seen/i }
}
const readCache = new Map<string, { at: number; value: unknown }>()

const lastRelay = new Map<string, number>()
/** When the app last opened each account by itself: the dispatcher does not open the same one twice in ten minutes. */
const lastOpened: Record<string, number | undefined> = {}

/** Every window and session of every account, as the dispatcher sees them. */
function windowsNow(): AccountWindow[] {
  return service.agents.flatMap((a) => a.sessions.filter((x) => x.pid || isSessionWorking(x)).map((x) => ({
    account: a.id, sessionId: x.sessionId, pid: x.kind === 'background' ? undefined : x.pid, projectId: x.projectId, working: isSessionWorking(x)
  })))
}

/**
 * Every automatic window goes through here (core/dispatch.ts): one window per account, a cap per project. When the
 * account already has its window open on the project, the message is typed there instead of opening another.
 */
async function autoOpen(o: { account: AccountId; project: ProjectConfig; reason: LaunchReason; cwd: string; args: string[]; title: string; message: string }): Promise<LaunchDecision> {
  const now = Date.now()
  const d = decideLaunch({ account: o.account, projectId: o.project.id, reason: o.reason }, {
    windows: windowsNow(), status: service.settings.accountStatus ?? {}, workingOn: workingMap(windowsNow()),
    maxPerProject: Math.max(1, Number(service.settings.maxFronts) || 1), lastOpened, now
  })
  const who = `Claude ${o.account.slice(6)}`
  const label = { relevo: 'Relevo', reparto: 'Reparto', arranque: 'Arranque', vuelta: 'Vuelta', reserva: 'Cuenta de reserva' }[o.reason]
  if (d.action === 'abrir') {
    openTerminal(o.account, o.cwd, o.args, o.title)
    lastOpened[o.account] = now
    addEvent(service.db, { projectId: o.project.id, at: now, account: o.account, kind: 'relevo-app', title: t('{label}: Mission Control ha abierto a {who} en {name}', { label: label, who: who, name: o.project.name }), detail: d.why, source: 'Mission Control' })
  } else if (d.action === 'avisar') {
    // An idle window with the old hooks would stop again after this message: reopened with it instead (12-11).
    const stale = ((api.staleWindows() as { sessionId: string }[]) ?? []).some((x) => x.sessionId === d.sessionId)
    if (stale) await api.reopenWindow(o.account, d.sessionId, o.message)
    else await typeText(d.pid, o.message)
    addEvent(service.db, { projectId: o.project.id, at: now, account: o.account, kind: 'relevo-app', title: t('{label}: se le ha escrito a {who} en su ventana abierta', { label: label, who: who }), detail: d.why, source: 'Mission Control', dedupe: `av:${o.account}:${o.project.id}:${Math.floor(now / 600_000)}` })
  } else {
    addEvent(service.db, { projectId: o.project.id, at: now, account: o.account, kind: 'relevo-app', title: t('{label} no hecho: {why}', { label: label, why: d.why }), source: 'Mission Control', dedupe: `no:${o.account}:${o.project.id}:${Math.floor(now / 1800_000)}` })
  }
  service.push()
  return d
}
/**
 * Ends a Claude and, when its terminal was opened just for it (a `cmd` whose command line names claude: the app's own
 * windows and the launchers), that terminal too: killing only Claude left an empty tab behind (12-11, the user: «no para
 * de abrir pestañas»). A shell the user opened by hand and ran claude in stays.
 */
/** Short descriptions in Spanish, by skill name, written by a Claude session (`pmc skills-es`): shown instead of the original. */
function skillsEs(): Record<string, string> {
  try { return JSON.parse(readFileSync(join(paths.root(), 'skills-es.json'), 'utf8')) } catch { return {} }
}

/**
 * Every request the user typed in any account's windows in the last days, placed in its project (the folder of the
 * window, or the project its words point to when they clearly name another: 12-11, a Mission Control request typed in a
 * The game project window), and checked against what each project wrote down (tasks, memories, decisions).
 */
/** The same list for a minute, unless what was written down or closed changes (Inicio asks for it every time it opens). */
let requestsMemo: { at: number; key: string; list: UserRequest[] } | undefined
function recentRequests(days: number): UserRequest[] {
  // 13-11: with the docs' read time in the key (it changes every 8 s), the memo never held: 2.264 calls of ~180 ms in a
  // day, all blocking the app. A minute old is fine for what the user asked; closing one still refreshes it at once.
  const key = `${days}:${(service.settings.requestsClosed ?? []).length}`
  // EV115: five minutes (it was one): each count reads every account's history (~180 ms with the app stopped), and what the
  // user asked changes when he writes, not every minute.
  if (requestsMemo && requestsMemo.key === key && Date.now() - requestsMemo.at < 5 * 60_000) return requestsMemo.list
  const list = allRequests(days)
  requestsMemo = { at: Date.now(), key, list }
  return list
}

let corpusMemo: { sig: string; corpus: Record<string, string[]> } | undefined

function allRequests(days: number): UserRequest[] {
  const since = Date.now() - days * 86400_000
  const roots = service.projects.flatMap((p) => [p.root, ...p.copies.map((c) => c.path)].map((r) => ({ id: p.id, r: r.toLowerCase().replace(/[\\/]+$/, '') }))).sort((a, b) => b.r.length - a.r.length)
  const vocab = service.projects.map((p) => ({ id: p.id, name: p.name, vocabulary: (service.db.prepare("SELECT title, substr(COALESCE(detail, ''), 1, 300) AS d FROM tasks WHERE project_id = ? AND gone = 0 ORDER BY source_line DESC LIMIT 400").all(p.id) as { title: string; d: string }[]).map((x) => `${x.title} ${x.d}`) }))
  // Best clue first: the project where that account wrote files in the next 40 minutes (12-11: requests about Mission
  // Control typed in a window opened in the game project's folder); then the project its words name; then the window's folder.
  // Writes outside every project count too (13-11: three requests typed in D:\Video App, where Claude 5 then wrote
  // all its files, went to the game project because only project writes were counted); the session's scratch files do not.
  const wrote = service.db.prepare("SELECT project_id AS id, count(*) AS n FROM events WHERE account = ? AND kind = 'archivo' AND title NOT LIKE '%\\Temp\\claude\\%' AND at BETWEEN ? AND ? GROUP BY project_id ORDER BY n DESC LIMIT 1")
  // EV115: only the requests (a third of the messages, 13-11) are placed; the rest of the chat is left out anyway.
  const prompts = service.accounts.flatMap((acc) => readHistory(acc).filter((h) => h.at > since && isRequest(h.text)).map((h) => {
    // The folder itself or one inside it: «D:\Video App» is not inside «D:\Video» (13-11: its requests were taken
    // for the video project's, and then their words sent them to the game project).
    const byFolder = h.project ? roots.find((x) => isInside(h.project!, x.r))?.id : undefined
    // Mostly outside every project (id null): no project from the writes.
    const byWork = (wrote.get(acc.id, h.at, h.at + 40 * 60_000) as { id?: string | null } | undefined)?.id ?? undefined
    const byWords = guessProject(h.text, vocab)?.id
    // EV64: a window in a folder that is no project (D:\Video App, the band's website) only counts where that account
    // then wrote files: guessed by its words, Mission Control's large vocabulary took them all («ventana», «app»…).
    const outside = Boolean(h.project) && !byFolder
    // 13-11: an account with two windows at once (the science project and Mission Control) had its science project requests placed
    // in Mission Control, where it was writing meanwhile. When the window's folder is a project and the writes say
    // another, the words decide; without words for the other one, the folder wins.
    return { at: h.at, account: acc.id, text: h.text, projectId: placeRequest({ byFolder, byWork, byWords, outside }) }
  }))
  const texts: Record<string, string[]> = {}
  for (const p of service.projects) {
    const tasks = (service.db.prepare("SELECT title, COALESCE(detail, '') AS d FROM tasks WHERE project_id = ? AND gone = 0").all(p.id) as { title: string; d: string }[]).map((x) => `${x.title} ${x.d}`)
    const mems = listMemories(service.db, p.id).map((m) => m.text)
    const decs = (service.db.prepare('SELECT title, COALESCE(question, \'\') AS q, COALESCE(note, \'\') AS n FROM decisions WHERE project_id = ?').all(p.id) as { title: string; q: string; n: string }[]).map((x) => `${x.title} ${x.q} ${x.n}`)
    // Section titles too: the Claudes often write a request there, quoted, above the tasks it became (13-11: «piensa en
    // los puntos débiles y fuertes de Claude», in the title of «Rediseño general», showed as never written down).
    const sections = (service.db.prepare("SELECT DISTINCT section FROM tasks WHERE project_id = ? AND gone = 0 AND section != ''").all(p.id) as { section: string }[]).map((x) => x.section)
    texts[p.id] = [...tasks, ...sections, ...mems, ...decs]
  }
  // EV115: the same written-down texts give the same corpus object, so its index (core/requests › indexOf, kept by
  // object) is built once and not on every call (13-11: half of the ~170 ms of each call).
  const sig = textsSignature(texts)
  if (!corpusMemo || corpusMemo.sig !== sig) corpusMemo = { sig, corpus: Object.fromEntries(Object.entries(texts).map(([id, t]) => [id, corpusOf(t)])) }
  return classify(prompts, corpusMemo.corpus, new Set(service.settings.requestsClosed ?? []))
}

/**
 * EV88: a window waiting for a «1. Yes / 2. No» that nobody answers is answered by the app after a few minutes, so the
 * work goes on when the user is away (the user, 13-11: «si no respondo a esas, os quedáis ahí… siempre yes, 1»).
 */
const permissionSeen = new Map<string, number>()
/** Windows already reported as waiting on something the app does not answer (once per session). */
const permissionUnsure = new Set<string>()
async function awayTick(): Promise<void> {
  if (process.env.PMC_SHOT_DIR) return
  const policy = service.settings.awayPolicy ?? 'todo'
  const wait = Math.max(1, Number(service.settings.awayMinutes) || 3) * 60_000
  const now = Date.now()
  const live = new Set<string>()
  for (const a of service.agents) for (const s of a.sessions) {
    if (!s.pid || s.status !== 'waiting' || !/permission|permiso/i.test(s.waitingFor ?? '')) continue
    live.add(s.sessionId)
    const first = permissionSeen.get(s.sessionId) ?? now
    permissionSeen.set(s.sessionId, first)
    if (policy === 'esperar' || now - first < wait) continue
    const pend = pendingToolUse(chatFile(s.cwd, s.sessionId))
    const risk = riskOf(pend?.name, pend?.input)
    const what = pend ? `${pend.name}${pend.input?.command ? ': ' + String(pend.input.command).slice(0, 160) : pend.input?.file_path ? ': ' + pend.input.file_path : ''}` : 'una orden'
    const answer = awayAnswer(policy, risk)
    // Look before pressing: Claude Code calls any dialog «permission prompt», and some menus put «No, exit» first
    // (13-11: an Intro there closed a window). Without a screen (an old console), only a real pending tool call counts.
    let screen: string | undefined
    try { screen = await readScreen(s.pid) } catch { /* no console to read */ }
    const seen = screen != null ? yesOnScreen(screen) : undefined
    if (answer === 'aceptar' && (seen ? !seen.key : !pend)) {
      if (!permissionUnsure.has(s.sessionId)) {
        permissionUnsure.add(s.sessionId)
        addEvent(service.db, { projectId: s.projectId, at: now, account: a.id, kind: 'aviso', title: t('{id} espera algo que la app no contesta sola: mira su ventana', { id: a.id }), detail: seen && !seen.key ? seen.why : t('no se ve qué pide'), source: 'Mission Control' })
        service.push()
      }
      continue
    }
    try {
      if (answer === 'aceptar') {
        await typeKey(s.pid, '1')
        await new Promise((r) => setTimeout(r, 1500))
        let after: string | undefined
        try { after = await readScreen(s.pid) } catch { /* gone */ }
        const again = after != null ? yesOnScreen(after) : undefined
        const before = seen?.key ? seen : undefined
        const still = Boolean(before && again?.key && again.question === before.question && pendingToolUse(chatFile(s.cwd, s.sessionId)))
        addEvent(service.db, { projectId: s.projectId, at: now, account: a.id, kind: 'aviso', title: t('{v0} (nadie contestó en {v1} min): {what}', { v0: still ? 'Pulsado 1, pero la pregunta sigue en pantalla' : 'Aceptado solo', v1: Math.round(wait / 60_000), what: what }), detail: before ? t('En pantalla: «{v0}»', { v0: before.question ?? '1. Yes' }) : undefined, source: 'Mission Control' })
      } else if (answer === 'rechazar') {
        await typeKey(s.pid, 'esc')
        await new Promise((r) => setTimeout(r, 800))
        await typeText(s.pid, `Mission Control: el usuario no está y esta orden es de las que quiere confirmar él (${risk.why}). No la hagas ahora; sigue con otra tarea. Se la he dejado en Decidir.`)
        if (s.projectId) addDecision(service.db, { projectId: s.projectId, title: t('¿Dejo hacer esto a {id}?', { id: a.id }), question: t('Mientras no estabas, {id} pidió permiso para {what}. Es de lo que quieres confirmar tú ({why}), así que no se ha hecho.', { id: a.id, what: what, why: risk.why }), options: ['Sí, que lo haga', 'No'], askedBy: a.id } as any)
        addEvent(service.db, { projectId: s.projectId, at: now, account: a.id, kind: 'aviso', title: t('Rechazado ({why}), te espera en Decidir: {what}', { why: risk.why, what: what }), source: 'Mission Control' })
      }
    } catch (err) { console.error('respuesta sola:', (err as Error).message) }
    permissionSeen.delete(s.sessionId)
    service.push()
  }
  for (const k of [...permissionSeen.keys()]) if (!live.has(k)) permissionSeen.delete(k)
  for (const k of [...permissionUnsure]) if (!live.has(k)) permissionUnsure.delete(k)
}

/** Looks on skills.sh for what fits the project (one search per term; a minute or two) and keeps what it found. */
async function searchSkillsFor(p: ProjectConfig): Promise<void> {
  const terms = termsFor(profileOf(p.root).kinds)
  const found: FoundSkill[] = []
  for (const t of terms) {
    const out = await runNpx(`npx -y skills find "${t.replace(/"/g, '')}"`, tmpdir(), 90_000).catch((e: Error) => e.message)
    found.push(...parseFind(out, t))
  }
  // What each suggested one does: one listing per repository (it clones it; some seconds each).
  const chosen = pickSuggestions(found, [], 18, 5, profileOf(p.root).kinds)
  const desc: Record<string, string> = {}
  for (const source of [...new Set(chosen.map((f) => f.source))]) {
    const out = await runNpx(`npx -y skills add ${source} -l`, tmpdir(), 120_000).catch(() => '')
    for (const [k, v] of Object.entries(parseList(out))) desc[`${source}@${k}`] = v
  }
  for (const f of found) if (desc[f.id]) f.description = desc[f.id]
  const all = skillCache()
  // Offline or without npx nothing comes back: what was found last time is kept, not wiped.
  all[p.id] = { at: Date.now(), found: found.length ? found : all[p.id]?.found ?? [] }
  try { writeFileSync(join(paths.root(), 'skills-search.json'), JSON.stringify(all)) } catch { /* next time */ }
}

/**
 * EV167 (the user, 14-11 13:47: «buscando skills para cada proyecto de cada persona… eso son cosas que debe hacer la
 * app también»): the same search, alone, for a project just added and once a week for each one, one project at a time
 * and never while the PC is loaded. Installing stays the user's click (a skill works with every permission): Inicio
 * says how many would fit and the Cronología keeps it.
 */
let skillSearching = false
async function autoSkillSearch(onlyId?: string): Promise<void> {
  if (skillSearching || process.env.PMC_SHOT_DIR) return
  if (lastLoad && Date.now() - lastLoad.at < 10 * 60_000 && isLoaded(lastLoad.load)) return
  const cache = skillCache()
  const p = projectToSearch(service.projects, cache, Date.now(), onlyId)
  if (!p) return
  skillSearching = true
  try {
    const before = service.skillsTally[p.id]?.suggested ?? 0
    await searchSkillsFor(p)
    await api.skills(p.id)
    const now = service.skillsTally[p.id]?.suggested ?? 0
    if (now > before) addEvent(service.db, { projectId: p.id, at: Date.now(), kind: 'relevo-app', title: tn(now, '{n} skill recomendada para {name}', '{n} skills recomendadas para {name}', { name: p.name }), detail: t('Buscadas solas en skills.sh para lo que es el proyecto. Míralas en Skills: instalar es cosa tuya.'), source: 'Mission Control' })
    service.push()
  } catch (e) {
    service.log(`skills solas: ${p.name}: ${(e as Error).message}`)
  } finally {
    skillSearching = false
  }
}

/** Skill searches already made, by project (skills.sh is asked again only when the user presses «Buscar»). */
function skillCache(): Record<string, { at: number; found: FoundSkill[] }> {
  try { return JSON.parse(readFileSync(join(paths.root(), 'skills-search.json'), 'utf8')) } catch { return {} }
}

/**
 * EV142: once per app version, the subagents the app wrote (with its mark) rewritten in each project's work copy, so the
 * improvements reach every project without anyone pressing «Preparar». Never creates anything, never touches edited ones.
 */
async function refreshAgentsEverywhere(): Promise<void> {
  const version = app.getVersion()
  // The capture copies (npm run capturas, primera-vez) touch nothing outside their own data folder.
  if (service.settings.agentsVersion === version || process.env.PMC_SHOT_DIR) return
  // One project per step, with the window's calls in between (all four at once took 651 ms, 13-11).
  for (const p of [...service.projects]) {
    await new Promise<void>((r) => setImmediate(r))
    const copy = workCopy(p)?.path ?? p.root
    const t0 = performance.now()
    try {
      const done = refreshMarkedAgents(copy, detectProfile(copy).agents)
      const ms = performance.now() - t0
      if (ms > 80) service.log(`lento: subagentes (${p.id}) ${Math.round(ms)} ms`)
      if (done.length) addEvent(service.db, { projectId: p.id, at: Date.now(), kind: 'proyecto', title: t('Ayudantes de los Claude puestos al día con la versión {version}: {v0}', { version: version, v0: done.map((f) => f.replace(/^\.claude\/agents\/|\.md$/g, '')).join(', ') }), detail: t('En {copy}. Quien trabaje allí lo guarda en su próximo commit.', { copy: copy }), source: 'Mission Control' })
    } catch (e) { service.log(`subagentes de ${p.name}: ${(e as Error).message}`) }
  }
  service.setSettings({ agentsVersion: version })
}

/** Where skills are looked for: the accounts in use and every project's folders (its root and its work copies). */
function skillScan(): Parameters<typeof scanSkills>[0] & { accounts: { id: string; configDir: string }[] } {
  const accounts = service.accounts.filter((a) => !service.settings.accountStatus?.[a.id]).map((a) => ({ id: a.id, configDir: envFor(a).CLAUDE_CONFIG_DIR ?? (a.configDir || join(homedir(), '.claude')) }))
  return { accounts, projects: service.projects.map((x) => ({ id: x.id, roots: [x.root, ...x.copies.map((c) => c.path)] })) }
}

/** EV133: a project's skills for the board, kept in skills-tally.json; true when the figure changed. */
function saveSkillsTally(projectId: string, t: SkillsTally): boolean {
  const before = service.skillsTally[projectId]
  service.skillsTally[projectId] = t
  if (before && before.installed === t.installed && before.suggested === t.suggested) return false
  try { writeFileSync(join(paths.root(), 'skills-tally.json'), JSON.stringify(service.skillsTally)) } catch { /* next time */ }
  return true
}

/** EV144: the last full reading of the skills and the stamp of the folders it read (core/skills.ts › skillsStamp). */
let skillScanSaved: { stamp: string; list: SkillInfo[] } | undefined

/** The skills there are now: the saved reading while the folders' stamp is the same, a new one otherwise. */
function installedSkills(input = skillScan()): SkillInfo[] {
  const stamp = skillsStamp(input)
  if (skillScanSaved?.stamp === stamp) return skillScanSaved.list
  skillScanSaved = { stamp, list: scanSkills(input) }
  return skillScanSaved.list
}

/** EV144: what each project is (the game project takes ~160 ms to look at), kept half an hour: it hardly ever changes. */
const profilesSaved = new Map<string, { at: number; prof: ReturnType<typeof detectProfile> }>()
function profileOf(root: string): ReturnType<typeof detectProfile> {
  const c = profilesSaved.get(root)
  if (c && Date.now() - c.at < 30 * 60_000) return c.prof
  const prof = detectProfile(root)
  profilesSaved.set(root, { at: Date.now(), prof })
  return prof
}

/**
 * EV133: every project's skills counted in the background (skill folders and the last search; nothing from internet).
 * One account or one project per step, with the window's calls in between: all at once took 537 ms at start (13-11).
 */
async function tallyAllSkills(): Promise<void> {
  const input = skillScan()
  // EV144: the stamp before reading, so a change made while it reads makes the next opening read again.
  const stamp = skillsStamp(input)
  const installed: SkillInfo[] = []
  const pause = () => new Promise<void>((r) => setImmediate(r))
  const step = async (what: string, part: Parameters<typeof scanSkills>[0]) => {
    await pause()
    const t0 = performance.now()
    installed.push(...scanSkills(part))
    const ms = performance.now() - t0
    if (ms > 80) service.log(`lento: skills (${what}) ${Math.round(ms)} ms`)
  }
  for (const a of input.accounts) await step(a.id, { accounts: [a], projects: [] })
  for (const p of input.projects) await step(p.id, { accounts: [], projects: [p] })
  await pause()
  skillScanSaved = { stamp, list: mergeSkills(installed) }
  const names = [...new Set(installed.map((s) => s.name))]
  const cache = skillCache()
  let changed = false
  for (const p of service.projects) {
    const c = cache[p.id]
    let suggested: number | undefined
    if (c) { await pause(); const kinds = profileOf(p.root).kinds; suggested = pickSuggestions(c.found.filter((f) => termsFor(kinds).includes(f.term)), names, 18, 5, kinds).length }
    if (saveSkillsTally(p.id, skillsTally(installed, p.id, suggested))) changed = true
  }
  if (changed) service.push()
}

/** Runs an npx command and gives back what it printed (stdout and stderr together). */
function runNpx(cmd: string, cwd: string, timeout: number): Promise<string> {
  return new Promise((resolve, reject) => exec(cmd, { cwd, timeout, windowsHide: true, maxBuffer: 8 << 20, env: { ...process.env, CI: '1', NO_COLOR: '1' } }, (err, out, errOut) => {
    const text = `${out ?? ''}\n${errOut ?? ''}`
    if (err && !text.trim()) reject(new Error(err.message)); else resolve(text)
  }))
}

function closeClaudeWindow(pid: number): void {
  if (!isWin) { void closePosixClaude(pid, true); return }
  const ps = `$p = Get-CimInstance Win32_Process -Filter "ProcessId=${Math.floor(pid)}"; if ($p) { $q = Get-CimInstance Win32_Process -Filter "ProcessId=$($p.ParentProcessId)"; if ($q -and $q.Name -eq 'cmd.exe' -and $q.CommandLine -match 'claude') { $q.ProcessId } }`
  execFile('powershell.exe', ['-NoProfile', '-Command', ps], { windowsHide: true, timeout: 10_000 }, (_err, out) => {
    const parent = Number(String(out ?? '').trim())
    const target = Number.isInteger(parent) && parent > 0 ? ['/PID', String(parent), '/T', '/F'] : ['/PID', String(pid), '/F']
    try { execFile('taskkill.exe', target, { windowsHide: true }, () => undefined) } catch { /* gone */ }
  })
}

/**
 * A window the app opened for the wheel (its cmd runs a launcher in claude-accesos with a «Mission Control ·» prompt),
 * closed with its cmd. `byHandToo` (EV130, an account whose turn already went to another: the user, 13-11 16:20, «que los
 * claude que no se usen y hayáis cogido relevo se cierren solos»): also one the user opened from its launcher in
 * claude-accesos. Never anything that is not a Claude launcher's cmd.
 */
function closeIdleWindow(pid: number, byHandToo = false): Promise<boolean> {
  if (!isWin) return closePosixClaude(pid, byHandToo)
  const mine = byHandToo ? '' : ` -and $q.CommandLine -match 'Mission Control'`
  const ps = `$p = Get-CimInstance Win32_Process -Filter "ProcessId=${Math.floor(pid)}"; if ($p) { $q = Get-CimInstance Win32_Process -Filter "ProcessId=$($p.ParentProcessId)"; if ($q -and $q.Name -eq 'cmd.exe' -and $q.CommandLine -match 'claude-accesos'${mine}) { $q.ProcessId } }`
  return new Promise((resolve) => execFile('powershell.exe', ['-NoProfile', '-Command', ps], { windowsHide: true, timeout: 15_000 }, (_err, out) => {
    const parent = Number(String(out ?? '').trim())
    if (!Number.isInteger(parent) || parent <= 0) { resolve(false); return }
    execFile('taskkill.exe', ['/PID', String(parent), '/T', '/F'], { windowsHide: true }, (err) => resolve(!err))
  }))
}

/**
 * EV112: the machine's load, read every two minutes without waiting (Windows takes seconds to list every process), and
 * kept with the time it was read. Inicio shows it when the PC is loaded; the assistant answers «¿por qué va lento?».
 */
let lastLoad: { at: number; load: Load } | undefined
let readingLoad = false
function readLoad(): void {
  if (readingLoad || process.platform !== 'win32') return
  readingLoad = true
  execFile('powershell.exe', LOAD_ARGS, { windowsHide: true, timeout: 30_000, maxBuffer: 8 << 20 }, (_err, out) => {
    readingLoad = false
    const load = parseLoad(String(out ?? ''))
    if (load) lastLoad = { at: Date.now(), load }
  })
}

/** Subagent calls per project (EV32), counted in the background: one count at a time, each at most every ten minutes. */
const subagentCounts = new Map<string, { at: number; uses: Record<string, number> }>()
const subagentCounting = new Set<string>()
function refreshSubagentCounts(p: ProjectConfig): void {
  if (subagentCounting.has(p.id)) return
  subagentCounting.add(p.id)
  const dirs = service.accounts.map((a) => envFor(a).CLAUDE_CONFIG_DIR ?? a.configDir).filter((d): d is string => Boolean(d))
  void subagentUse(dirs, [p.root, ...p.copies.map((c) => c.path)])
    .then((uses) => { subagentCounts.set(p.id, { at: Date.now(), uses }) })
    .catch(() => undefined)
    .finally(() => subagentCounting.delete(p.id))
}
let healthCache: { at: number; tools: Check[] } | undefined
let busyCache: { at: number; busy: Busy } | undefined
let busyReading = false
/**
 * EV115: what is running (tasklist and nvidia-smi) read without waiting: done in the main process with execFileSync it
 * held the app 600-730 ms each time (resources, staffPlans, the dispatcher). Read every 15 s at most, in the background.
 */
function refreshBusy(): void {
  if (busyReading) return
  busyReading = true
  const opts = { windowsHide: true, timeout: 8000, maxBuffer: 8 << 20 }
  execFile(PROCESS_LIST[0], PROCESS_LIST[1], opts, (_e, procs) => {
    const list = asTasklist(String(procs ?? ''))
    execFile('nvidia-smi', ['--query-gpu=memory.used,memory.total', '--format=csv,noheader,nounits'], opts, (_e2, gpu) => {
      busyReading = false
      busyCache = { at: Date.now(), busy: detectBusy((cmd) => String((cmd === 'tasklist' ? list : gpu) ?? '')) }
    })
  })
}
/** The last reading (asking for a new one when it is older than 15 s); undefined before the first one has come. */
function busyNow_(): Busy | undefined {
  if (!busyCache || Date.now() - busyCache.at > 15_000) refreshBusy()
  return busyCache?.busy
}
const NOTHING_BUSY: Busy = { userApps: [], unityEditors: 0, blender: 0 }

/** An account stopped for its limit in a project: the next one that can go on is opened there (switch in Relevos › Cómo trabajan los Claude). */
/** Where an account has really been working: the project it wrote most files in during the last half hour, else its window's. */
function workedOn(account: AccountId, fallback?: ProjectConfig): ProjectConfig | undefined {
  try {
    const rows = service.db.prepare("SELECT project_id AS id, count(*) AS n FROM events WHERE account = ? AND kind = 'archivo' AND project_id IS NOT NULL AND at > ? GROUP BY project_id ORDER BY n DESC LIMIT 1").all(account, Date.now() - 30 * 60_000) as { id: string; n: number }[]
    return (rows[0] && service.project(rows[0].id)) || fallback
  } catch { return fallback }
}

function autoRelay(e: { at: number; account: AccountId; error?: string; event?: string; sessionId?: string }, project?: ProjectConfig): void {
  try {
    project = workedOn(e.account, project)
    // A project with its relay wheel on is the wheel's: it decides who goes on (core/chain.ts).
    if (project && wheel?.governs(project.id, e.account)) { void wheel.tick(`Claude ${e.account.slice(6)} se ha parado`); return }
    if (!service.settings.autoRelay || !project || process.env.PMC_SHOT_DIR) return
    // IV1: a project kept for a backup account is not handed to another one; reserveTick opens it again when it can.
    if (reservedFor(service.settings.reserves, project.id)) return
    const key = `${e.account}|${project.id}`
    const now = Date.now()
    // A turn that ends with the usage nearly gone is a stop too: the account was told to close and hand over.
    const snap = service.agents.find((a) => a.id === e.account)?.usage.snapshot
    const usedPct = snap && now - snap.capturedAt < 15 * 60_000 ? Math.max(...[snap.fiveHour, snap.sevenDay].map((w) => (w && w.resetsAt > now ? w.usedPct : 0))) : undefined
    if (!shouldRelay({ ...e, usedPct }, lastRelay.get(key))) return
    lastRelay.set(key, Date.now())
    // One project each (the user, 12-11): nobody takes over its work; the others go on with theirs, and it takes its own
    // up again in its window when its usage is back (autoWake). Whoever was waiting for its heavy work is told now.
    if (relayModeOf(service.settings) === 'proyecto') {
      const back = service.agents.find((a) => a.id === e.account)?.usage.activeLimit?.resetsAt
      addEvent(service.db, { projectId: project.id, at: now, account: e.account, kind: 'relevo-app', title: t('Claude {v0} se ha quedado sin uso en {name}: cada una en su proyecto, nadie toma su trabajo; lo retoma ella en su ventana al volver{v1}', { v0: e.account.slice(6), name: project.name, v1: back && back > now ? ` (${new Date(back).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })})` : '' }), source: 'Mission Control' })
      service.push()
      void turnTick()
      return
    }
    const agents = service.agents.map((a) => {
      const w = a.usage.snapshot?.sevenDay
      const f = a.usage.snapshot?.fiveHour
      return { id: a.id, state: a.state, sessions: a.sessions, weekFree: w && w.resetsAt > now ? Math.max(0, 100 - Math.round(w.usedPct)) : undefined, fiveFree: f && f.resetsAt > now ? Math.max(0, 100 - Math.round(f.usedPct)) : undefined }
    })
    const from = service.agents.find((a) => a.id === e.account)
    const wantsFable = /fable/i.test(from?.usage.snapshot?.model ?? '')
    const choice = pickSuccessor({ from: e.account, projectId: project.id, agents, order: service.settings.nextOrderBy?.[project.id] ?? service.settings.nextOrder ?? [], status: service.settings.accountStatus ?? {}, wantsFable, noFable: service.settings.noFable ?? [] })
    const who = `Claude ${e.account.slice(6)}`
    // The one that should go on is about to get its usage back (the user, 12-11: «te quedarás sin créditos minutos antes
    // de que claude5 vuelva»): better to wait for it than to open a worse one now. Its start is scheduled for that moment.
    const order = service.settings.nextOrderBy?.[project.id] ?? service.settings.nextOrder ?? []
    const soon = service.agents
      .filter((a) => a.id !== e.account && !service.settings.accountStatus?.[a.id] && a.state === 'sin-uso' && a.usage.activeLimit && a.usage.activeLimit.resetsAt - now < 30 * 60_000 && a.usage.activeLimit.resetsAt > now)
      .filter((a) => !wantsFable || !(service.settings.noFable ?? []).includes(a.id))
      .sort((x, y) => (order.indexOf(x.id) < 0 ? 99 : order.indexOf(x.id)) - (order.indexOf(y.id) < 0 ? 99 : order.indexOf(y.id)))[0]
    const better = soon && (!choice.to || (wantsFable && !choice.fable) || (order.indexOf(soon.id) >= 0 && (order.indexOf(choice.to) < 0 || order.indexOf(soon.id) < order.indexOf(choice.to))))
    if (soon && better) {
      const at = soon.usage.activeLimit!.resetsAt + 2 * 60_000
      void (api.scheduleStart(project.id, soon.id, at, { fable: wantsFable, prompt: relayPrompt(e.account, project.name, wantsFable, wantsFable) }) as Promise<unknown>).catch((err: Error) => console.error('relevo en espera:', err.message))
      addEvent(service.db, { projectId: project.id, at: now, account: soon.id, kind: 'relevo-app', title: t('Relevo automático en espera: {who} se ha quedado sin uso y sigue Claude {v0} cuando recupere el suyo ({v1})', { who: who, v0: soon.id.slice(6), v1: new Date(at).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' }) }), source: 'Mission Control' })
      service.push()
      return
    }
    if (!choice.to) {
      addEvent(service.db, { projectId: project.id, at: now, account: e.account, kind: 'relevo-app', title: t('{who} se ha quedado sin uso y nadie puede seguir: {why}', { who: who, why: choice.why }), source: 'Mission Control' })
      service.push()
      return
    }
    const copy = workCopy(project)
    const args = ['--permission-mode', 'auto', ...(choice.fable ? ['--model', 'fable'] : []), relayPrompt(e.account, project.name, choice.fable, wantsFable)]
    void autoOpen({ account: choice.to, project, reason: 'relevo', cwd: copy?.path ?? project.root, args, title: t('{to} · relevo de {account} · {name}', { to: choice.to, account: e.account, name: project.name }), message: relayPrompt(e.account, project.name, choice.fable, wantsFable) })
  } catch (err) {
    console.error('relevo automático:', (err as Error).message)
  }
}

/**
 * Automatic distribution (EV20): every minute, each project worked on in the last day that still has free tasks and
 * nobody on them gets the next account of its turn, in the copy where it is being worked on. More than one account at
 * once only if the user raised the cap, and then each front goes to its own copy.
 */
/** What the automatic distribution would do in a project now, and why (EV20: shown in Próximo, used by autoStaff). */
function staffPlanFor(p: ProjectConfig, c: { now: number; busyNow: ReturnType<typeof detectBusy>; held: string[]; taken: Set<string> }): { why: string; plan?: ReturnType<typeof planFronts> } {
  const s = service.settings
  const now = c.now
  if (wheel?.governs(p.id)) return { why: t('tiene la rueda de relevos encendida: ella decide quién sigue') }
  // IV1: a project kept for a backup account is opened only by reserveTick, and only with that account.
  if (reservedFor(s.reserves, p.id)) return { why: t('es de la cuenta de reserva (Claude {v0})', { v0: reservedFor(s.reserves, p.id)!.slice(6) }) }
  const lastActivityAt = (service.db.prepare("SELECT max(at) AS at FROM events WHERE project_id = ? AND kind IN ('archivo', 'sesion', 'reserva')").get(p.id) as { at?: number } | undefined)?.at ?? undefined
  const lastLaunchAt = (service.db.prepare("SELECT max(at) AS at FROM events WHERE project_id = ? AND source = 'Mission Control' AND kind IN ('sesion', 'relevo-app')").get(p.id) as { at?: number } | undefined)?.at ?? undefined
  const launches = (service.db.prepare("SELECT count(*) AS n FROM events WHERE project_id = ? AND source = 'Mission Control' AND kind IN ('sesion', 'relevo-app') AND at > ? AND (title LIKE 'Reparto automático%' OR title LIKE 'Relevo automático%')").get(p.id, now - 6 * 3600_000) as { n: number }).n
  const claims = listClaims(service.db, p.id).filter((x) => !x.abandoned)
  const working = service.agents.filter((a) => isWorkingOn(a, p.id)).length
  const scheduledSoon = Object.values(s.schedules ?? {}).some((x) => x.projectId === p.id && x.at > now && x.at - now < 30 * 60_000)
  const gap = staffGap({ working, claims: claims.length, lastActivityAt, lastLaunchAt, launches, scheduledSoon, playing: Boolean(c.busyNow.playing), max: Math.max(1, Number(s.maxFronts) || 1), now })
  if (!gap.open) return { why: gap.why }
  const heldKeys = new Set(claims.map((x) => x.taskKey))
  const rows = (service.db.prepare("SELECT key, ext_id, title, detail, section, priority, COALESCE(override, status) AS st FROM tasks WHERE project_id = ? AND gone = 0 AND COALESCE(override, status) IN ('pendiente', 'planificada', 'en-desarrollo') ORDER BY priority, st != 'en-desarrollo', source_line IS NULL, source_line").all(p.id) as any[]).filter((r) => !heldKeys.has(r.key))
  const open = new Set(rows.map((r) => r.ext_id).filter(Boolean))
  const tasks = rows.filter((r) => !taskTags(`${r.title} ${r.detail ?? ''}`).after.some((id) => id !== r.ext_id && open.has(id)))
    .map((r) => ({ key: r.key, extId: r.ext_id ?? undefined, title: r.title, detail: r.detail, section: r.section, priority: r.priority, status: r.st }))
  if (!tasks.length) return { why: t('no quedan tareas libres') }
  const order = s.nextOrderBy?.[p.id] ?? s.nextOrder ?? []
  const place = (id: string) => { const n = order.indexOf(id); return n < 0 ? 1e6 : n }
  const accounts = service.agents
    .filter((a) => !s.accountStatus?.[a.id] && !c.taken.has(a.id) && a.state !== 'sin-uso' && a.state !== 'desconectado' && a.state !== 'trabajando' && !a.sessions.some((x) => isSessionWorking(x)))
    .map((a) => { const w = a.usage.snapshot?.sevenDay; const f = a.usage.snapshot?.fiveHour; return { a, weekFree: w && w.resetsAt > now ? 100 - w.usedPct : undefined, fiveFree: f && f.resetsAt > now ? 100 - f.usedPct : undefined } })
    .filter((x) => (x.weekFree == null || x.weekFree >= 5) && (x.fiveFree == null || x.fiveFree >= 5))
    .sort((x, y) => place(x.a.id) - place(y.a.id) || (y.weekFree ?? 50) - (x.weekFree ?? 50))
    .map((x) => ({ id: x.a.id, weekFree: x.weekFree, hasFable: !(s.noFable ?? []).includes(x.a.id) }))
  if (!accounts.length) return { why: t('ninguna cuenta libre tiene uso ahora') }
  // The copy where the project is being worked on goes first; another front needs another copy with nobody in it.
  const main = workCopy(p)
  const inUse = new Set(service.agents.flatMap((a) => a.sessions.filter((x) => x.projectId === p.id && isSessionWorking(x)).map((x) => (x.worktree ?? '').toLowerCase())))
  const copies = [...(main ? [main] : []), ...p.copies.filter((x) => x !== main)].filter((x) => !inUse.has(x.label.toLowerCase()))
  const freeCopies = working || claims.length ? copies.filter((x) => x !== main) : copies
  const plan = planFronts({ tasks, accounts, freeCopies: freeCopies.map((x) => x.label), busy: [...c.held, ...(c.busyNow.userApps.length ? ['unity', 'gpu', 'build'] : [])], max: gap.open })
  return { why: plan.why, plan }
}

function autoStaff(): void {
  try {
    const s = service.settings
    if (!s.autoPlan || process.env.PMC_SHOT_DIR) return
    const now = Date.now()
    const busyNow = busyNow_()
    if (!busyNow) return
    const held = heldResources(service.db).map((h) => h.name)
    const taken = new Set<string>()
    for (const p of service.projects) {
      const { plan } = staffPlanFor(p, { now, busyNow, held, taken })
      if (!plan) continue
      for (const f of plan.fronts) {
        const copy = p.copies.find((c) => c.label === f.copy)
        const fable = Boolean(f.model && /fable/.test(f.model) && !/sonnet|opus|haiku/.test(f.model))
        try {
          taken.add(f.account)
          void autoOpen({ account: f.account, project: p, reason: 'reparto', cwd: copy?.path ?? p.root, args: ['--permission-mode', 'auto', ...(fable ? ['--model', 'fable'] : []), 'sigue'], title: t('{account} · {name} · {copy} (reparto automático)', { account: f.account, name: p.name, copy: f.copy }), message: t('Mission Control (reparto automático): quedan tareas en {name} y nadie trabaja en ellas. Sigue con {task} y las siguientes (pmc parte).', { name: p.name, task: f.task }) })
        } catch (err) { console.error('reparto automático:', (err as Error).message) }
      }
      if (plan.fronts.length) service.push()
    }
  } catch (err) {
    console.error('reparto automático:', (err as Error).message)
  }
}

/** Autonomous mode: an account cut by its limit is scheduled to start again, in the same project, when its usage is back. */
function autoWake(e: { at: number; account: AccountId; error?: string }, project?: ProjectConfig): void {
  try {
    project = workedOn(e.account, project)
    const mode = relayModeOf(service.settings)
    if ((!service.settings.autonomous && mode !== 'proyecto') || !project || process.env.PMC_SHOT_DIR || e.error !== 'rate_limit') return
    // In a relay wheel it is not called back on its own: it waits for its turn.
    if (wheel?.governs(project.id, e.account)) return
    const now = Date.now()
    if (now - e.at > 3 * 60_000) return
    if ((service.settings.schedules?.[e.account]?.at ?? 0) > now) return
    const u = service.agents.find((a) => a.id === e.account)?.usage
    const full = [u?.snapshot?.sevenDay, u?.snapshot?.fiveHour].find((w) => w && w.resetsAt > now && w.usedPct >= 99)
    const back = u?.activeLimit?.resetsAt ?? full?.resetsAt ?? u?.snapshot?.fiveHour?.resetsAt
    if (!back || back <= now) return
    // Its window still open (the user, 12-11: «que le llegue el aviso al chat abierto y siga»; a new window loses what
    // the old one knew): no new one. At the reset it is called back in it, unless it got going by itself.
    const anyWindow = windowsNow().find((x) => x.account === e.account && x.pid)
    if (anyWindow && anyWindow.projectId !== project.id) {
      addEvent(service.db, { projectId: project.id, at: now, account: e.account, kind: 'relevo-app', title: t('Claude {v0} se ha quedado sin uso; tiene su ventana en otro proyecto: no se programa ningún arranque', { v0: e.account.slice(6) }), source: 'Mission Control' })
      service.push()
      return
    }
    if (openWindow(e.account, project.id)) {
      const target = project
      setTimeout(() => void callBack(e.account, target, e.at), Math.max(0, back + 3 * 60_000 - now)).unref?.()
      addEvent(service.db, { projectId: project.id, at: now, account: e.account, kind: 'relevo-app', title: t('Claude {v0} seguirá en su misma ventana al volver ({v1})', { v0: e.account.slice(6), v1: new Date(back + 3 * 60_000).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' }) }), source: 'Mission Control' })
      service.push()
      return
    }
    void (api.scheduleStart(project.id, e.account, back + 3 * 60_000, { fable: /fable/i.test(u?.snapshot?.model ?? '') }) as Promise<unknown>).catch((err: Error) => console.error('arranque al volver:', err.message))
  } catch (err) {
    console.error('arranque al volver:', (err as Error).message)
  }
}

/** An account's window open on a project (not a background session): where it can be called back. */
function openWindow(account: AccountId, projectId: string) {
  const a = service.agents.find((x) => x.id === account)
  return a?.sessions.filter((x) => x.pid && x.kind !== 'background' && x.projectId === projectId)
    .sort((x, y) => (y.lastActivityAt ?? 0) - (x.lastActivityAt ?? 0))[0]
}

/** When an account's conversation in a window last moved. */
function lastMoved(x: { cwd: string; sessionId: string; lastActivityAt?: number }): number {
  return Math.max(x.lastActivityAt ?? 0, readChat(chatFile(x.cwd, x.sessionId), 1, 100 << 10)?.mtime ?? 0)
}

/** Back from its limit with its window open: told in it to go on (or to wait its turn for heavy work). */
async function callBack(account: AccountId, project: ProjectConfig, stoppedAt: number): Promise<void> {
  // EV28: a project taken out of autonomous mode is not resumed by itself.
  if (service.settings.autonomyOff?.includes(project.id)) return
  if (wheel?.governs(project.id, account)) return
  try {
    const w = openWindow(account, project.id)
    if (!w?.pid) return
    const others = service.agents.filter((a) => a.id !== account && isWorkingOn(a, project.id)).length
    if (!shouldCallBack({ stoppedAt, lastMovedAt: lastMoved(w), mode: relayModeOf(service.settings), othersOnProject: others })) return
    // A window opened before its account's coordination was updated would stop again at the end of every answer: it is
    // idle anyway (it was cut by the limit), so it is reopened on the same conversation with the new hooks (12-11).
    const stale = ((api.staleWindows() as { sessionId: string }[]) ?? []).some((x) => x.sessionId === w.sessionId)
    if (stale) await api.reopenWindow(account, w.sessionId)
    else await typeText(w.pid, backMessage(project.name))
    resumed.set(account, Date.now())
    addEvent(service.db, { projectId: project.id, at: Date.now(), account, kind: 'relevo-app', title: t('Claude {v0} ha vuelto: sigue en su misma {v1}', { v0: account.slice(6), v1: stale ? 'conversación (ventana reabierta con la coordinación nueva)' : 'ventana' }), source: 'Mission Control' })
    service.push()
    void turnTick()
  } catch (err) {
    console.error('aviso al volver:', (err as Error).message)
  }
}

/** Heavy work by turns between projects (Próximo › Piloto automático): who came back when, who waits for whom. */
const lastState = new Map<string, string>()
const resumed = new Map<string, number>()
/** Limits already answered with a call back in the window (account:limit time). */
const calledBack = new Set<string>()
const waitingTurn: Record<string, Waiting | undefined> = {}

/** The command lines of the Unity and Blender running now (what tells which project each belongs to). */
function heavyCommandLines(): Promise<string[]> {
  if (!isWin) return new Promise((resolve) => execFile('ps', ['-A', '-o', 'command='], { timeout: 15000, maxBuffer: 8 << 20 }, (err, out) => resolve(err ? [] : String(out).split(/\r?\n/).filter((l) => /\/(Unity|Blender)(\.app\/|\s|$)/i.test(l)))))
  const ps = "Get-CimInstance Win32_Process -Filter \"Name='Unity.exe' OR Name='blender.exe'\" | ForEach-Object { $_.CommandLine }"
  return new Promise((resolve) => execFile('powershell.exe', ['-NoProfile', '-Command', ps], { windowsHide: true, timeout: 15000, maxBuffer: 4 << 20 }, (err, out) => resolve(err ? [] : String(out).split(/\r?\n/).filter(Boolean))))
}

/** The project an account is on: its working session's, else where it wrote files lately, else its window's. */
function projectOfAccount(a: (typeof service.agents)[number]): string | undefined {
  return a.sessions.find((x) => x.projectId && isSessionWorking(x))?.projectId ?? workedOn(a.id)?.id ?? a.projectId
}

/** Every account in use out of usage at once (EV53): said once, on the phone too, with when the first one is back. */
let allOutSaid = false
function allOutCheck(now: number): void {
  const usable = service.agents.filter((a) => !service.settings.accountStatus?.[a.id] && a.state !== 'baja' && a.state !== 'apartada')
  const out = usable.length > 0 && usable.every((a) => a.state === 'sin-uso')
  if (!out) { allOutSaid = false; return }
  if (allOutSaid) return
  allOutSaid = true
  const back = Math.min(...usable.map((a) => a.usage.activeLimit?.resetsAt ?? Infinity))
  const when = Number.isFinite(back) ? new Date(back).toLocaleString('es-ES', { weekday: 'short', hour: '2-digit', minute: '2-digit' }) : undefined
  // EV128: and whether anything has to be done then (with one account this is its own limit).
  const goesOn = service.settings.autonomous || relayModeOf(service.settings) === 'proyecto'
  const body = `Nadie puede trabajar ahora.${when ? ` La primera vuelve el ${when}.` : ''} ${goesOn ? 'Seguirá sola donde lo dejó: no tienes que hacer nada.' : 'Ábrela cuando vuelva, o en Relevos elige que siga sola.'}`
  addEvent(service.db, { at: now, kind: 'aviso', title: t('Todas las cuentas se han quedado sin uso. {body}', { body: body }), source: 'Mission Control' })
  void remote.push(usable.length === 1 ? 'Tu Claude se ha quedado sin uso' : 'Todas las cuentas sin uso', body, 'inicio').catch(() => undefined)
  if (!process.env.PMC_SHOT_DIR) try { if (Notification.isSupported()) new Notification({ title: usable.length === 1 ? t('Tu Claude se ha quedado sin uso') : t('Todas las cuentas sin uso'), body, silent: true }).show() } catch { /* no notifications */ }
}

/**
 * IV1: a backup account opens on its project when every other account in use is out of usage, even if it is set aside
 * (the user asked for it by name). decideLaunch keeps the rest: one window per account, the 10-minute cooldown, and an
 * idle window of it on that project is written to instead of opening another.
 */
const reserveSaid = new Map<string, string>()
/** EV150: the last «wrap up» said to each backup account (once per return), kept on disk so a restart does not repeat it. */
const wrappedFile = () => join(paths.root(), 'reserve-wrap.json')
function readWrapped(): Record<string, string> { try { return JSON.parse(readFileSync(wrappedFile(), 'utf8')) } catch { return {} } }
function writeWrapped(account: string, key: string): void { try { writeFileSync(wrappedFile(), JSON.stringify({ ...readWrapped(), [account]: key })) } catch { /* said again next time */ } }
/** What is left for a backup account in its project: open tasks, and what the user sent it that it has not read. */
function reserveWork(r: { account: AccountId; projectId: string }): { openTasks: number; toRead: number } {
  const openTasks = (service.db.prepare("SELECT count(*) AS n FROM tasks WHERE project_id = ? AND gone = 0 AND COALESCE(override, status) NOT IN ('terminada', 'idea')").get(r.projectId) as { n: number }).n
  let toRead = 0
  try { toRead = pendingInstructions(service.db, r.projectId, r.account).length } catch { /* none */ }
  return { openTasks, toRead }
}
/** EV166: when each backup was told to wrap up (in this run of the app), to close its windows once it has. */
const wrapTold = new Map<string, number>()
/** EV166: a backup still at work in its project while it should be leaving (the wheel waits for it). */
function reserveBusy(): { account: AccountId; project: string } | undefined {
  for (const r of service.settings.reserves ?? []) {
    if (!r.on || onlyTaskOf(r.account)) continue
    const a = service.agents.find((x) => x.id === r.account)
    if (a?.sessions.some((x) => x.projectId === r.projectId && isSessionWorking(x))) return { account: r.account, project: service.project(r.projectId)?.name ?? r.projectId }
  }
  return undefined
}
async function reserveTick(now: number): Promise<void> {
  for (const r of service.settings.reserves ?? []) {
    const p = service.project(r.projectId)
    if (!p) continue
    // EV150 (the user, 14-11 04:50: claude5 «solo en momentos muertos que haya bastante margen… que lo deje en un punto
    // seguro antes de que vuelva alguien y cerrar todo»; this replaces 0.32.33's «never with Toda la potencia»): at work
    // there while another account is back or about to be, it is told once to leave everything safe and close.
    // Any session of it there counts, idle too (14-11: Claude 5 sat idle in two windows and never read a notice, which only
    // arrives with a tool call): it is typed into its windows, as the wheel tells a turn; a notice only with no window.
    const mine = service.agents.find((a) => a.id === r.account)?.sessions.filter((x) => x.projectId === r.projectId && (x.pid || isSessionWorking(x))) ?? []
    // EV159: opened by the user for one task: it finishes that and closes by itself; nobody tells it to stop before.
    const wrap = mine.length && !onlyTaskOf(r.account) ? reserveWrapUp(r, service.agents, service.settings.accountStatus ?? {}, now) : undefined
    // EV166: told to wrap up a while ago and nothing of it at work there any more: its windows close, so the wheel (which
    // waits for this) goes on with the PC free. Only windows the app or its launchers opened.
    const told = wrapTold.get(r.account)
    if (wrap && told && readWrapped()[r.account] === wrap.key && now - told > 90_000 && !mine.some((x) => isSessionWorking(x))) {
      wrapTold.delete(r.account)
      let closed = 0
      for (const w of mine.filter((x) => x.pid && x.kind !== 'background')) { if (await closeIdleWindow(w.pid!, true)) closed++ }
      addEvent(service.db, { projectId: p.id, at: now, account: r.account, kind: 'relevo-app', title: t('Cuenta de reserva: Claude {v0} ha dejado {name} a salvo{v1}; la rueda sigue', { v0: r.account.slice(6), name: p.name, v1: closed ? ` y se ${closed === 1 ? 'ha cerrado su ventana' : `han cerrado sus ${closed} ventanas`}` : '' }), source: 'Mission Control' })
      setTimeout(() => void service.refreshAgents(), 2500)
    }
    if (wrap && readWrapped()[r.account] !== wrap.key) {
      writeWrapped(r.account, wrap.key)
      wrapTold.set(r.account, now)
      const text = wrapUpText(p.name, wrap.why)
      const wins = mine.filter((x) => x.pid && x.kind !== 'background')
      let typed = 0
      for (const w of wins) { try { await typeText(w.pid!, text); typed++ } catch { /* the notice below */ } }
      if (!typed) addNotice(r.account, text, [p.root, ...p.copies.map((c) => c.path)], now)
      addEvent(service.db, { projectId: p.id, at: now, account: r.account, kind: 'relevo-app', title: t('Cuenta de reserva: {why}; se le pide a Claude {v0} que deje {name} a salvo y cierre', { why: wrap.why, v0: r.account.slice(6), name: p.name }), detail: typed ? t('Escrito en {v0}.', { v0: typed === 1 ? 'su ventana' : `sus ${typed} ventanas` }) : t('Por aviso, en su próximo paso.'), source: 'Mission Control' })
    }
    const v = reserveDue(r, service.agents, service.settings.accountStatus ?? {}, now, reserveWork(r))
    const key = `${r.account}:${r.projectId}`
    if (!v.open) { reserveSaid.delete(key); continue }
    // Already at work there: nothing to do and nothing to write (13-11: «Cuenta de reserva no hecho: ya está trabajando»
    // every half hour in the timeline while Claude 5 worked from 05:58 to 08:57).
    if (service.agents.find((a) => a.id === r.account)?.sessions.some((x) => x.projectId === r.projectId && isSessionWorking(x))) continue
    const d = await autoOpen({ account: r.account, project: p, reason: 'reserva', cwd: p.root, args: ['--permission-mode', 'auto', reservePrompt(p.name, r.note)], title: t('{account} · {name} (cuenta de reserva)', { account: r.account, name: p.name }), message: reservePrompt(p.name, r.note) })
    if (d.action !== 'nada' && reserveSaid.get(key) !== d.action) {
      reserveSaid.set(key, d.action)
      void remote.push(`Claude ${r.account.slice(6)} trabaja en ${p.name}`, `Cuenta de reserva: ${v.why}.`, 'inicio').catch(() => undefined)
    }
  }
}

/**
 * EV154: a note from the dock goes straight to a Claude: typed into the window of one doing nothing in the project;
 * if all are busy, the one at work reads it after its next step (its hook); with nobody there, a free account is opened
 * for it (only when it is sent: `open`). What happened is kept on the note, for the dock to show.
 */
async function routeNote(id: number, open: boolean): Promise<NoteRoute | undefined> {
  const row = service.db.prepare("SELECT project_id, body, target, status FROM instructions WHERE id = ?").get(id) as { project_id: string; body: string; target: string | null; status: string } | undefined
  const p = row ? service.project(row.project_id) : undefined
  if (!row || !p || row.status !== 'guardada') return undefined
  const route = pickNoteRoute({ agents: service.agents, projectId: p.id, target: (row.target ?? undefined) as AccountId | undefined, excluded: service.settings.accountStatus ?? {}, chains: service.settings.relayChains ?? {} })
  if (route.kind === 'ventana') {
    try {
      await typeText(route.pid, typedNoteText(p.name, id, row.body))
      markTyped(service.db, id, route.account)
      addEvent(service.db, { projectId: p.id, at: Date.now(), account: route.account, kind: 'entrega', title: t('Tu nota se ha escrito en la ventana de Claude {v0}: «{v1}»', { v0: route.account.slice(6), v1: row.body.slice(0, 100) }), source: 'Mission Control', ref: `ins:${id}` })
      return route
    } catch (e) {
      service.log(`nota ${id}: no se pudo escribir en la ventana de ${route.account}: ${(e as Error).message}`)
      return { kind: 'espera', why: t('no se pudo escribir en su ventana; la leerá en su próximo paso') }
    }
  }
  if (route.kind === 'abrir') {
    if (!open) return { kind: 'espera', why: t('la leerá el primer Claude que trabaje aquí') }
    try {
      await api.putToWork(p.id, route.account)
      markOpening(service.db, id, route.account)
      addEvent(service.db, { projectId: p.id, at: Date.now(), account: route.account, kind: 'entrega', title: t('Se abre Claude {v0} en {name} con tu nota: «{v1}»', { v0: route.account.slice(6), name: p.name, v1: row.body.slice(0, 100) }), source: 'Mission Control', ref: `ins:${id}` })
      return route
    } catch (e) {
      return { kind: 'espera', why: (e as Error).message }
    }
  }
  return route
}

/** EV171: a project added that already had work in it is gone over and improved by itself (once a week at most). */
async function improveAdded(projectId: string): Promise<void> {
  const p = service.project(projectId)
  if (!p) return
  let hasWork = false
  try { hasWork = looksLikeProject(p.root) } catch { /* unreadable: leave it */ }
  if (!improveOnAdd({ hasWork, lastAskedAt: service.settings.improveAsked?.[projectId], now: Date.now() })) return
  try { await api.improveProject(projectId) } catch (e) { service.log(`mejorar ${projectId}: ${(e as Error).message}`) }
}

/** Notes still waiting (sent while every Claude was busy, or nobody was in): to a window that is now free. */
async function notesTick(now: number): Promise<void> {
  // A capture works on a copy of the data: it must never type into the real windows.
  if (process.env.PMC_SHOT_DIR) return
  const rows = service.db.prepare("SELECT id FROM instructions WHERE status = 'guardada' AND kind IN ('general', 'tarea') AND comment_id IS NULL AND created_at > ? AND created_at < ? ORDER BY created_at LIMIT 5")
    .all(now - 2 * 86400_000, now - 60_000) as { id: number }[]
  for (const r of rows) {
    const done = await routeNote(r.id, false).catch(() => undefined)
    if (done?.kind === 'ventana') service.push()
  }
}

/**
 * EV160 (the user, 14-11 13:10): the user answered a question of a Claude the app had closed after its one task: it is
 * opened again, for that answer only, and closed again when it ends its turn. Returns whether it was opened.
 */
function followAnswer(decisionId: number): boolean {
  const d = service.db.prepare('SELECT id, project_id, title, asked_by, task_ext_id, status, created_at FROM decisions WHERE id = ?').get(decisionId) as { id: number; project_id: string; title: string; asked_by: string | null; task_ext_id: string | null; status: string; created_at: number } | undefined
  if (!d || d.status !== 'decidida' || !d.asked_by || process.env.PMC_SHOT_DIR) return false
  const account = d.asked_by as AccountId
  const p = service.project(d.project_id)
  const agent = service.agents.find((a) => a.id === account)
  if (!p || !agent || agent.state === 'sin-uso' || service.settings.accountStatus?.[account] === 'baja') return false
  const there = agent.sessions.some((s) => s.projectId === p.id && (s.pid || isSessionWorking(s)))
  const c = reopenForAnswer({ askedBy: account, projectId: p.id, createdAt: d.created_at }, readClosedOnly(), there)
  if (!c || onlyTaskOf(account)) return false
  const copy = workCopy(p)
  const now = Date.now()
  setOnlyTask(account, { projectId: p.id, taskKey: c.taskKey, label: c.label, at: now, decisionId })
  openTerminal(account, copy?.path ?? p.root, ['--permission-mode', 'auto', answerPrompt({ projectName: p.name, label: c.label, title: d.title, decisionId })], `${account} · ${p.name} · tu respuesta a #${decisionId}`)
  addEvent(service.db, { projectId: p.id, at: now, account, kind: 'sesion', title: t('Has contestado a Claude {v0} (#{decisionId}): se vuelve a abrir para hacerlo y se cerrará al terminar', { v0: account.slice(6), decisionId: decisionId }), source: 'Mission Control' })
  setTimeout(() => void service.refreshAgents(), 4000)
  return true
}

/**
 * EV159: an account opened for one task only. Once it handed the task in (released, done) and its window there is idle,
 * the window is closed and the mark goes; with no window left (the user closed it) the mark goes too.
 */
function onlyTaskTick(now: number): void {
  if (process.env.PMC_SHOT_DIR) return
  for (const [acc, only] of Object.entries(readOnlyTasks(now))) {
    const account = acc as AccountId
    const a = service.agents.find((x) => x.id === account)
    const here = (a?.sessions ?? []).filter((s) => s.projectId === only.projectId)
    if (!here.length) {
      // Two minutes to show up after the launch; afterwards, no session there means it was closed.
      if (now - only.at > 4 * 60_000) setOnlyTask(account, undefined)
      continue
    }
    // EV160: opened again for an answer, it is done when it ends a turn after that; for a task, when it hands it in.
    const finished = only.decisionId ? endedTurnSince(readActivity(account, 40).recent, only.at) : onlyTaskFinished(service.db, account, only)
    if (!finished || here.some((s) => isSessionWorking(s))) continue
    for (const s of here) if (s.pid && s.kind !== 'background') closeClaudeWindow(s.pid)
    setOnlyTask(account, undefined)
    rememberClosed(account, only, now)
    const what = only.decisionId ? `lo que le contestaste en #${only.decisionId} (${only.label})` : `${only.label}, la tarea para la que la abriste,`
    addEvent(service.db, { projectId: only.projectId, at: now, account, kind: 'sesion', title: t('Claude {v0} ha hecho {what} y se ha cerrado', { v0: account.slice(6), what: what }), source: 'Mission Control' })
    void remote.push(`Claude ${account.slice(6)} ha terminado`, only.decisionId ? `Ha hecho lo que le contestaste en #${only.decisionId}: su ventana se ha cerrado.` : `Era su única tarea (${only.label}): su ventana se ha cerrado.`, 'inicio').catch(() => undefined)
    setTimeout(() => void service.refreshAgents(), 2500)
    service.push()
  }
}

async function turnTick(): Promise<void> {
  try {
    const now = Date.now()
    allOutCheck(now)
    await reserveTick(now)
    await notesTick(now).catch((e) => service.log(`notas: ${(e as Error).message}`))
    try { onlyTaskTick(now) } catch (e) { service.log(`solo esta tarea: ${(e as Error).message}`) }
    // Starts that already fired (or were skipped by the gate) leave nothing behind: no Windows task, no line in Próximo.
    for (const [acc, sch] of Object.entries(service.settings.schedules ?? {})) if (sch && sch.at < now - 10 * 60_000) await cancelSchedule(acc as AccountId).catch(() => undefined)
    // Back from a limit with its window still open on a project: called back in it once (a timer set at the limit is lost
    // when the app restarts, which is when it updates). callBack itself skips a window that already got going.
    for (const a of (service.settings.autonomous ? service.agents : [])) {
      const l = a.usage.lastLimit
      if (!l || a.state === 'sin-uso' || service.settings.accountStatus?.[a.id]) continue
      if (l.resetsAt > now - 3 * 60_000 || l.resetsAt < now - 60 * 60_000) continue
      const key = `${a.id}:${l.at}`
      if (calledBack.has(key)) continue
      const w = a.sessions.find((x) => x.pid && x.kind !== 'background' && x.rateLimited && x.projectId)
      const p = w?.projectId ? service.project(w.projectId) : undefined
      if (!p) continue
      calledBack.add(key)
      await callBack(a.id, p, l.at)
    }
    for (const a of service.agents) {
      if (lastState.get(a.id) === 'sin-uso' && a.state === 'trabajando') resumed.set(a.id, now)
      lastState.set(a.id, a.state)
    }
    const s = service.settings
    if (relayModeOf(s) !== 'proyecto' || !s.heavyTurns || process.env.PMC_SHOT_DIR) {
      for (const k of Object.keys(waitingTurn)) delete waitingTurn[k]
      return
    }
    const busy = busyNow_()
    if (!busy) return
    const lines = busy.unityEditors || busy.blender ? await heavyCommandLines() : []
    const heavy = new Set(heavyProjects(lines, service.projects.map((p) => ({ id: p.id, roots: [p.root, ...p.copies.map((c) => c.path)] }))))
    for (const h of heldResources(service.db)) {
      if (!['unity', 'gpu', 'build'].includes(h.name)) continue
      const holder = service.agents.find((a) => a.id === h.account)
      const p = holder && projectOfAccount(holder)
      if (p) heavy.add(p)
    }
    const accounts = service.agents.filter((a) => !s.accountStatus?.[a.id]).map((a) => ({
      id: a.id, projectId: projectOfAccount(a), working: a.state === 'trabajando' && a.sessions.some((x) => isSessionWorking(x)), resumedAt: resumed.get(a.id)
    }))
    for (const act of heavyTurns({ now, accounts, heavy: [...heavy], waiting: waitingTurn })) {
      const project = service.project(act.projectId)
      const w = openWindow(act.account, act.projectId)
      if (!project || !w?.pid) { delete waitingTurn[act.account]; continue }
      if (act.kind === 'esperar') {
        const holderProject = service.project(act.holderProjectId)?.name ?? act.holderProjectId
        await typeText(w.pid, waitMessage(act.holder, holderProject))
        waitingTurn[act.account] = { since: now, holder: act.holder, projectId: act.projectId }
        resumed.delete(act.account)
        addEvent(service.db, { projectId: act.projectId, at: now, account: act.account, kind: 'relevo-app', title: t('Claude {v0} espera su turno de trabajo pesado: Claude {v1} está con Unity o Blender en {holderProject}', { v0: act.account.slice(6), v1: act.holder.slice(6), holderProject: holderProject }), source: 'Mission Control' })
      } else {
        await typeText(w.pid, goMessage(act.holder, project.name))
        delete waitingTurn[act.account]
        addEvent(service.db, { projectId: act.projectId, at: now, account: act.account, kind: 'relevo-app', title: t('Le toca a Claude {v0}: Claude {v1} ha soltado lo pesado o se ha quedado sin uso', { v0: act.account.slice(6), v1: act.holder.slice(6) }), source: 'Mission Control' })
      }
      service.push()
    }
  } catch (err) {
    console.error('turnos de trabajo pesado:', (err as Error).message)
  }
}

/** The copy where the project is being worked on: the one with the newest relevo, or the newest list of tasks. */
function workCopy(p: ProjectConfig): ProjectConfig['copies'][number] | undefined {
  const src = newestDoc(p, 'RELEVO.md') ?? newestDoc(p, 'TASKS.md')
  if (!src) return undefined
  return p.copies.filter((c) => src.file.toLowerCase().startsWith(join(c.path.toLowerCase(), 'x').slice(0, -1))).sort((a, b) => b.path.length - a.path.length)[0]
}

const TASK_FOLDER = '\\PakitronMC\\'

// macOS: the scheduled start is a launchd agent of the user's (~/Library/LaunchAgents) that opens a Terminal window at
// that hour; launchd runs it on waking if the Mac was asleep then. The window takes the agent out when it starts.
const launchdLabel = (account: AccountId) => `es.pakitron.missioncontrol.arrancar.${account}`
const launchdPlist = (account: AccountId) => join(homedir(), 'Library', 'LaunchAgents', `${launchdLabel(account)}.plist`)
const launchctl = (args: string[]) => new Promise<{ ok: boolean; err: string }>((resolve) => execFile('launchctl', args, { timeout: 15000 }, (e, _o, se) => resolve({ ok: !e, err: String(se || e?.message || '') })))
async function unloadLaunchd(account: AccountId): Promise<void> {
  await launchctl(['bootout', `gui/${process.getuid?.() ?? 501}/${launchdLabel(account)}`])
  try { unlinkSync(launchdPlist(account)) } catch { /* none */ }
}
async function scheduleLaunchd(account: AccountId, at: number, job: TerminalJob): Promise<void> {
  const uid = process.getuid?.() ?? 501
  const script = writeTerminalScript({ ...job, once: false, before: [`launchctl bootout gui/${uid}/${launchdLabel(account)} 2>/dev/null; rm -f ${shQuote(launchdPlist(account))}`, ...(job.before ?? [])] }, join(paths.root(), 'scheduled', `${account}.command`))
  const x = (v: string) => v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const d = new Date(at)
  const when = ([['Month', d.getMonth() + 1], ['Day', d.getDate()], ['Hour', d.getHours()], ['Minute', d.getMinutes()]] as const).map(([k, v]) => `<key>${k}</key><integer>${v}</integer>`).join('')
  const plist = ['<?xml version="1.0" encoding="UTF-8"?>', '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">', '<plist version="1.0"><dict>',
    `<key>Label</key><string>${launchdLabel(account)}</string>`,
    `<key>ProgramArguments</key><array><string>/usr/bin/open</string><string>-a</string><string>Terminal</string><string>${x(script)}</string></array>`,
    `<key>StartCalendarInterval</key><dict>${when}</dict>`, '</dict></plist>', ''].join('\n')
  await unloadLaunchd(account)
  mkdirSync(dirname(launchdPlist(account)), { recursive: true })
  writeFileSync(launchdPlist(account), plist)
  const r = await launchctl(['bootstrap', `gui/${uid}`, launchdPlist(account)])
  if (!r.ok) throw new Error(t('macOS no ha dejado programar el arranque: {v0}', { v0: r.err.split('\n')[0] }))
}

/**
 * Takes the start out of Windows' Task Scheduler and out of the settings. If Windows refuses, the settings stay as they
 * are and the user is told: saying «quitado» while the task still fires would start a session nobody expects.
 */
async function cancelSchedule(account: AccountId): Promise<void> {
  if (!isWin) {
    await unloadLaunchd(account)
    const schedules = { ...(service.settings.schedules ?? {}) }
    delete schedules[account]
    service.setSettings({ schedules })
    return
  }
  const ps = `$t = Get-ScheduledTask -TaskPath '${TASK_FOLDER}' -TaskName 'Arrancar ${account}' -ErrorAction SilentlyContinue; if ($t) { Unregister-ScheduledTask -InputObject $t -Confirm:$false -ErrorAction Stop }; exit 0`
  await new Promise<void>((resolve, reject) => execFile('powershell.exe', ['-NoProfile', '-Command', ps], { windowsHide: true, timeout: 30000 }, (err, _o, e) => (err ? reject(new Error(t('Windows no ha dejado quitar el arranque: {v0}', { v0: String(e || err.message).split('\n')[0] }))) : resolve())))
  const schedules = { ...(service.settings.schedules ?? {}) }
  delete schedules[account]
  service.setSettings({ schedules })
}

/** «Que lo haga ya» cannot be promised for nobody, or for an account without usage: the note is not saved as if it could. */
function refuseNow(a: { target?: AccountId | null; now?: boolean }): void {
  if (!a.now) return
  if (!a.target) throw new Error(t('Elige un Claude para mandárselo ya'))
  if (service.agents.find((x) => x.id === a.target)?.state === 'sin-uso') throw new Error(t('Claude {v0} no tiene uso ahora: déjalo en su cola o elige a otro', { v0: a.target.slice(6) }))
}

/** With the note saved: if it is for now, an account at work reads it in its next step; one that is not, gets launched with it. */
async function afterChange(projectId: string, a: { target?: AccountId; now?: boolean }): Promise<{ how?: string }> {
  service.tasks.set(projectId, listTasks(service.db, projectId))
  service.push()
  if (!a.now || !a.target) return {}
  const agent = service.agents.find((x) => x.id === a.target)
  if (agent && isWorkingOn(agent, projectId)) return { how: 'siguiente-paso' }
  await api.putToWork(projectId, a.target)
  return { how: 'lanzado' }
}

// ---- IPC --------------------------------------------------------------------------------------------------------

type Handler = (...args: any[]) => unknown
const api: Record<string, Handler> = {
  state: () => ({ ...service.state(), floating: Boolean(floating && !floating.isDestroyed()) }),
  /** From the floating window: brings the main window up on a screen. */
  focusMain: (hash?: string) => {
    if (!win) return
    if (win.isMinimized()) win.restore()
    win.show()
    win.focus()
    if (hash) void win.webContents.executeJavaScript(`window.location.hash = ${JSON.stringify(hash)}`)
  },
  closeWindow: () => { floating?.close() },
  refresh: async () => {
    service.syncDocs(true)
    await service.refreshAgents()
    await service.scanAllMedia()
    await service.refreshGit()
    return service.state()
  },
  tasks: (projectId: string) => listTasks(service.db, projectId),
  setTaskStatus: (projectId: string, id: number, status: TaskStatus, verified?: boolean) => {
    setTaskStatus(service.db, projectId, id, status, verified)
    service.tasks.set(projectId, listTasks(service.db, projectId))
    service.rebuildAgents()
    return service.tasks.get(projectId)
  },
  assets: (q: AssetQuery) => queryAssets(service.db, q),
  assetFacets: (q: AssetQuery | string) => assetFacets(service.db, typeof q === 'string' ? { projectId: q } : q),
  assetFolder: (q: AssetQuery) => assetFolder(service.db, q),
  galleryHome: (q: AssetQuery) => galleryHome(service.db, q),
  /** Ajustes › Galería: one more folder to index, anywhere on the PC. */
  addMediaFolder: async (projectId: string) => {
    const p = service.project(projectId)
    if (!p) throw new Error(t('Proyecto desconocido'))
    const r = await dialog.showOpenDialog(win!, { title: t('Carpeta que quieres ver en la galería'), properties: ['openDirectory'] })
    if (r.canceled || !r.filePaths[0]) return undefined
    const next = service.updateProject(projectId, { mediaDirs: [...new Set([...p.mediaDirs, r.filePaths[0]])], mediaExcluded: (p.mediaExcluded ?? []).filter((d) => d !== r.filePaths[0]) })
    void service.scanAllMedia()
    return next
  },
  /** EV169: takes the project out of Mission Control and, if asked, sends its folder to the bin (never the app's own or a drive). */
  removeProject: async (projectId: string, toBin?: boolean) => {
    const r = service.removeProject(projectId)
    if (!toBin) return { ...r, binned: false }
    if (!binnable(r.root, process.cwd())) return { ...r, binned: false, error: 'esa carpeta no se manda a la papelera desde aquí' }
    try {
      await shell.trashItem(r.root)
      return { ...r, binned: true }
    } catch (e) {
      return { ...r, binned: false, error: (e as Error).message }
    }
  },
  removeMediaFolder: (projectId: string, dir: string) => {
    const p = service.project(projectId)
    if (!p) throw new Error(t('Proyecto desconocido'))
    const next = service.updateProject(projectId, { mediaDirs: p.mediaDirs.filter((d) => d !== dir), mediaExcluded: [...new Set([...(p.mediaExcluded ?? []), dir])] })
    void service.scanAllMedia()
    return next
  },
  assetVersions: (projectId: string, id: number) => {
    const a = service.db.prepare('SELECT name, rel, hash FROM assets WHERE id = ?').get(id) as any
    if (!a) return []
    // Same file name in other folders or copies: earlier and later versions of the same capture.
    return service.db.prepare('SELECT id, rel, mtime, size, hash FROM assets WHERE project_id = ? AND name = ? AND gone = 0 ORDER BY mtime DESC LIMIT 30').all(projectId, a.name)
  },
  setAssetStatus: (id: number, status: string) => {
    service.db.prepare('UPDATE assets SET status = ? WHERE id = ?').run(status, id)
    return true
  },
  comments: (projectId: string, assetId?: number) => listComments(service.db, projectId, assetId),
  addComment: (c: any, label: string) => {
    if (typeof c.frameDataUrl === 'string' && c.frameDataUrl.startsWith('data:image/')) {
      const dir = join(paths.root(), 'frames')
      mkdirSync(dir, { recursive: true })
      const f = join(dir, `frame-${c.assetId ?? 'x'}-${Date.now()}.png`)
      writeFileSync(f, Buffer.from(c.frameDataUrl.split(',')[1], 'base64'))
      c.framePath = f
    }
    delete c.frameDataUrl
    if (c.assetId) {
      const row = service.db.prepare('SELECT mtime FROM assets WHERE id = ?').get(c.assetId) as { mtime: number } | undefined
      c.assetMtime = row?.mtime
    }
    const r = addComment(service.db, c, label)
    // Keep the file as it is now: a later capture with the same name, or a delete, cannot take away what was noted.
    if (c.assetId) {
      const a = service.db.prepare('SELECT path, mtime FROM assets WHERE id = ?').get(c.assetId) as { path: string; mtime: number } | undefined
      const kept = a && existsSync(a.path) ? keepCopy(c.assetId, a.path, a.mtime) : undefined
      if (kept) {
        service.db.prepare('UPDATE comments SET kept_path = ? WHERE id = ?').run(kept, r.comment.id)
        r.comment.keptPath = kept
      }
      writeProtected(service.db)
    }
    service.push()
    return r
  },
  editComment: (id: number, body: string) => {
    const r = editComment(service.db, id, body)
    service.push()
    return r
  },
  deleteComment: (id: number) => {
    deleteComment(service.db, id)
    writeProtected(service.db)
    service.push()
    return true
  },
  setCommentStatus: (id: number, status: CommentStatus, note?: string) => {
    const r = setCommentStatus(service.db, id, status, note)
    writeProtected(service.db)
    service.push()
    return r
  },
  // ---- decisions ----
  decisions: (projectId: string) => listDecisions(service.db, projectId),
  answerDecision: (projectId: string, id: number, a: { choice?: string; note?: string; status?: 'decidida' | 'descartada'; reactions?: Record<number, 'si' | 'no'> }) => {
    const p = service.project(projectId)
    if (!p) throw new Error(t('Proyecto desconocido'))
    const r = answerDecision(service.db, p, id, a)
    // EV160: its Claude had closed after its one task: it comes back to do what was answered.
    try { followAnswer(id) } catch (e) { service.log(`respuesta ${id}: ${(e as Error).message}`) }
    service.push()
    return r
  },
  /** EV160: the same, by hand (or for an answer given before the app knew to do it). */
  followAnswer: (id: number) => ({ opened: followAnswer(id) }),
  reopenDecision: (id: number) => {
    const r = reopenDecision(service.db, id)
    service.push()
    return r
  },
  /** The user asks himself something to decide later (or a decision about a picture from the gallery). */
  addDecision: (d: any) => {
    const r = addDecision(service.db, d)
    service.push()
    return r
  },
  // ---- priorities ----
  setTaskPriority: (projectId: string, id: number, priority: number) => {
    const task = service.db.prepare('SELECT key, ext_id, title, priority FROM tasks WHERE id = ? AND project_id = ?').get(id, projectId) as any
    if (!task) throw new Error(t('La tarea no existe'))
    const prio = Math.max(0, Math.min(3, Math.round(priority)))
    service.db.prepare('UPDATE tasks SET priority = ? WHERE id = ?').run(prio, id)
    const label = ['urgente', 'alta', 'normal', 'baja'][prio]
    addEvent(service.db, { projectId, at: Date.now(), kind: 'prioridad', title: `Prioridad ${label}: ${task.ext_id ? task.ext_id + ' · ' : ''}${task.title}`, source: 'Mission Control', ref: task.key })
    // Raised: the first Claude at work hears it (and takes it if nobody has it); every new session sees the list.
    if (prio <= 1 && prio < task.priority) {
      const name = task.ext_id ?? task.title.slice(0, 50)
      addIns(service.db, { projectId, kind: 'prioridad', body: t('{name} · {title} pasa a prioridad {label}. Si nadie la tiene reservada, resérvala (pmc claim {v0}) y hazla antes que lo tuyo en cuanto cierres el paso en el que estás; si ya la tiene otra cuenta, sigue con lo tuyo.', { name: name, title: task.title, label: label, v0: name }) })
    }
    service.tasks.set(projectId, listTasks(service.db, projectId))
    service.push()
    return service.tasks.get(projectId)
  },
  // ---- accounts ----
  // EV146: a folder with no credentials file may still be signed in (Console, a key, a cloud): Claude Code is asked.
  detectAccounts: async () => {
    const out = []
    for (const f of detectAccounts(service.accounts, undefined, { withoutLogin: true })) {
      if (f.signedIn !== false) { out.push(f); continue }
      const s = await authStatus(f)
      if (s?.loggedIn) out.push({ ...f, signedIn: true })
    }
    return out
  },
  addAccount: (a: { id?: string; alias: string; configDir?: string; emailExpected?: string; color?: string }) => service.addAccount(a),
  updateAccount: (id: AccountId, patch: any) => service.updateAccount(id, patch),
  removeAccount: (id: AccountId, takeOutHooks: boolean) => {
    const acc = service.accounts.find((a) => a.id === id)
    if (acc && takeOutHooks) {
      try { uninstallHooks(acc) } catch { /* not installed */ }
      try { uninstallStatusLine(acc) } catch { /* not installed */ }
    }
    service.removeAccount(id)
    return true
  },
  chooseFolder: async (title: string) => {
    const r = await dialog.showOpenDialog(win!, { title, properties: ['openDirectory', 'createDirectory'] })
    return r.canceled ? undefined : r.filePaths[0]
  },
  /**
   * Closing a Claude: «pedir» asks it (the next time it uses a tool it reads that it must wrap up, leave the relevo and
   * stop); «ya» ends its process now, without touching what it started (a Unity it launched goes on and ends alone).
   */
  stopClaude: (account: AccountId, mode: 'pedir' | 'ya', sessionId?: string) => {
    const roots = service.projects.flatMap((p) => [p.root, ...p.copies.map((c) => c.path)])
    if (mode === 'pedir') {
      addNotice(account, 'Mission Control: el usuario te pide que cierres esta sesión. Termina el paso en curso sin dejar nada roto (no cortes una compilación ni una captura a medias), deja docs/RELEVO.md al día, libera tus reservas con pmc release y para. No empieces nada nuevo.', roots)
      addEvent(service.db, { at: Date.now(), account, kind: 'sesion', title: t('Has pedido a Claude {v0} que cierre', { v0: account.slice(6) }), source: 'Mission Control' })
      return { asked: true }
    }
    const a = service.agents.find((x) => x.id === account)
    const pids = (a?.sessions ?? []).filter((s) => s.pid && (!sessionId || s.sessionId === sessionId)).map((s) => s.pid!)
    for (const pid of pids) {
      closeClaudeWindow(pid)
    }
    addEvent(service.db, { at: Date.now(), account, kind: 'sesion', title: t('Has cerrado {v0} de Claude {v1}', { v0: pids.length === 1 ? 'la sesión' : `${pids.length} sesiones`, v1: account.slice(6) }), source: 'Mission Control' })
    setTimeout(() => void service.refreshAgents(), 2500)
    return { closed: pids.length }
  },
  /**
   * A quick note from the dock: kept as a note for the team to file where it belongs (never as a stop-everything), and
   * (EV154) taken straight to a Claude: see routeNote.
   */
  /**
   * EV171 «Mejorar mi proyecto»: the request to go over the whole project and improve it, as a note taken straight to a
   * Claude (routeNote: typed into a free window, or a free account is opened for it; with nobody, the first one that works
   * there reads it). Also asked by itself when a project that already had work is added (see addProject).
   */
  improveProject: async (projectId: string) => {
    const p = service.project(projectId)
    if (!p) throw new Error(t('Proyecto desconocido'))
    const r = addIns(service.db, { projectId, kind: 'general', body: improveText(p.name) })
    service.setSettings({ improveAsked: { ...(service.settings.improveAsked ?? {}), [projectId]: Date.now() } })
    addEvent(service.db, { projectId, at: Date.now(), kind: 'proyecto', title: t('Mejorar {name}: encargado a los Claude', { name: p.name }), source: 'Mission Control', ref: `ins:${r.id}` })
    const route = await routeNote(r.id, true).catch(() => undefined)
    service.push()
    return { ...r, route }
  },
  quickNote: async (projectId: string, body: string, target?: AccountId) => {
    const r = addIns(service.db, { projectId, kind: 'general', body: body.trim(), target })
    const route = await routeNote(r.id, true).catch(() => undefined)
    service.push()
    return { ...r, route }
  },
  /** EV154: what the user sent lately in this project, each with where it is now («Enviados» in the dock). */
  myNotes: (projectId: string) => {
    const notes = sentNotes(service.db, projectId, Date.now() - 2 * 86400_000, 5)
    const waiting = notes.some((n) => n.status === 'guardada')
    const route = (target?: AccountId) => pickNoteRoute({ agents: service.agents, projectId, target, excluded: service.settings.accountStatus ?? {}, chains: service.settings.relayChains ?? {} })
    const shared = waiting ? route() : undefined
    return notes.map((n) => ({ ...n, state: noteStatus(n, n.status === 'guardada' ? (n.target ? route(n.target) : shared) : undefined) }))
  },
  /** EV154: a sent note nobody has read yet can be taken back. */
  cancelNote: (id: number) => {
    const r = service.db.prepare("UPDATE instructions SET status = 'anulada', updated_at = ? WHERE id = ? AND status IN ('guardada', 'pendiente-entrega')").run(Date.now(), id)
    if (!Number(r.changes)) throw new Error(t('Ya le ha llegado a un Claude: no se puede anular'))
    service.push()
    return true
  },
  toggleFloating: () => toggleFloating(),
  /**
   * Próximo › Programar arranque (the user, 4-11): a task in Windows' Task Scheduler opens this account at that time in
   * the copy where the project is being worked on, already told «sigue»; if the PC was off then, as soon as it is on.
   */
  scheduleStart: async (projectId: string, account: AccountId, at: number, opts?: { fable?: boolean; prompt?: string }) => {
    const p = service.project(projectId)
    const acc = service.accounts.find((a) => a.id === account)
    if (!p || !acc) throw new Error(t('Cuenta o proyecto desconocido'))
    const cwd = workCopy(p)?.path ?? p.root
    const dir = join(paths.root(), 'scheduled')
    mkdirSync(dir, { recursive: true })
    if (!isWin) {
      const say = (opts?.prompt ?? '').replace(/[\r\n]/g, ' ').trim() || 'sigue'
      const node = service.nodeExe && existsSync(service.nodeExe) ? service.nodeExe : 'node'
      const gate = `${shQuote(node)} ${shQuote(join(paths.binDir(), 'pmc.mjs'))} puede-arrancar ${account} ${projectId} || exit 0`
      await scheduleLaunchd(account, at, { title: `${account} · ${p.name} (arranque programado)`, cwd, configDir: acc.configDir, before: [gate], argv: [findClaude(), '--permission-mode', 'auto', ...(opts?.fable ? ['--model', 'fable'] : []), say] })
      const schedules = { ...(service.settings.schedules ?? {}), [account]: { at, projectId } }
      service.setSettings({ schedules })
      addEvent(service.db, { projectId, at: Date.now(), account, kind: 'sesion', title: t('Arranque programado de Claude {v0}: {v1}', { v0: account.slice(6), v1: new Date(at).toLocaleString('es-ES') }), source: 'Mission Control' })
      return { at, cwd }
    }
    const cmd = join(dir, `${account}.cmd`)
    const launcher = launcherFor(account)
    // A waiting hand-off opened its account with a bare «sigue» and its usual model (claude5, 12-11): it carries both now.
    const say = (opts?.prompt ?? '').replace(/["%\r\n]/g, ' ').trim()
    const tail = `--permission-mode auto${opts?.fable ? ' --model fable' : ''} ${say ? `"${say}"` : 'sigue'}`
    const run = launcher ? `call "${launcher}" ${tail}` : `"${findClaude()}" ${tail}`
    // Hours may pass before it fires: whether it still has to open is decided then, not now (core/dispatch.ts).
    // `call`: on a PC without Node.js the runner is bin\node.cmd (EV126), and a batch file run without it never returns.
    const runner = nodeRunner()
    const gate = `${runner === 'node' ? 'node' : `call "${runner}"`} "${join(paths.binDir(), 'pmc.mjs')}" puede-arrancar ${account} ${projectId} || exit /b 0`
    writeFileSync(cmd, ['@echo off', 'chcp 65001 >nul', fontLine(), acc.configDir ? `set "CLAUDE_CONFIG_DIR=${acc.configDir}"` : 'set CLAUDE_CONFIG_DIR=', `cd /d "${cwd}"`, `title ${account} · ${p.name} (arranque programado)`, gate, run, ''].join('\r\n'))
    const d = new Date(at)
    const pad = (n: number) => String(n).padStart(2, '0')
    const when = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:00`
    const ps = `$a = New-ScheduledTaskAction -Execute 'cmd.exe' -Argument '/c ""${cmd}""'; $t = New-ScheduledTaskTrigger -Once -At ([datetime]'${when}'); $s = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Days 3); Register-ScheduledTask -TaskPath '${TASK_FOLDER}' -TaskName 'Arrancar ${account}' -Action $a -Trigger $t -Settings $s -Force | Out-Null`
    await new Promise<void>((resolve, reject) => execFile('powershell.exe', ['-NoProfile', '-Command', ps], { windowsHide: true, timeout: 30000 }, (err, _o, e) => (err ? reject(new Error(String(e || err.message).split('\n')[0])) : resolve())))
    const schedules = { ...(service.settings.schedules ?? {}), [account]: { at, projectId } }
    service.setSettings({ schedules })
    addEvent(service.db, { projectId, at: Date.now(), account, kind: 'sesion', title: t('Arranque programado de Claude {v0}: {v1}', { v0: account.slice(6), v1: d.toLocaleString('es-ES') }), source: 'Mission Control' })
    return { at, cwd }
  },
  unscheduleStart: async (account: AccountId) => {
    await cancelSchedule(account)
    return true
  },
  instructions: (projectId: string) => listInstructions(service.db, projectId),
  guessKind: (text: string) => guessKind(text),
  addInstruction: (i: { projectId: string; kind: InstructionKind; body: string; target?: AccountId }) => {
    const r = addInstruction(service.db, i)
    if (i.kind === 'idea' || i.kind === 'tarea') {
      const title = i.body.split(/(?<=[.!?])\s/)[0].slice(0, 140)
      addAppTask(service.db, i.projectId, { title, detail: i.body, status: i.kind === 'idea' ? 'idea' : 'pendiente', owner: i.target })
      service.tasks.set(i.projectId, listTasks(service.db, i.projectId))
    }
    service.push()
    return r
  },
  deliverInstruction: (projectId: string, id: number) => {
    const p = service.project(projectId)
    if (!p) throw new Error(t('Proyecto desconocido'))
    const r = deliverToBuzon(service.db, p, id)
    service.push()
    return r
  },
  copyInstruction: (projectId: string, id: number) => {
    const r = listInstructions(service.db, projectId).find((x) => x.id === id)
    if (!r) throw new Error(t('No existe'))
    clipboard.writeText(buzonLine(r).replace(/^- /, ''))
    return true
  },
  setInstructionStatus: (id: number, status: any) => setInstructionStatus(service.db, id, status),
  timeline: (projectId: string, from: number, to: number) => service.timeline(projectId, from, to),
  integration: async (projectId: string) => {
    const p = service.project(projectId)
    if (!p) return []
    return integration(p.root, service.copies.get(projectId) ?? [])
  },
  sessions: (projectId: string) => service.sessionsFor(projectId),
  setActiveProject: (id: string) => service.setSettings({ activeProjectId: id }),
  /**
   * What the user sent to an account and it has not read for a quarter of an hour (answers to its questions, messages), by
   * account and project (12-11: claude6 had 18 since the 7th; its window was opened before its hooks, so it never got them).
   */
  unread: () => {
    expireStaleRelays(service.db)
    const rows = service.db.prepare(`SELECT target AS account, project_id AS projectId, count(*) AS n, min(created_at) AS since FROM instructions
      WHERE target IS NOT NULL AND kind NOT IN ('nota', 'idea') AND status IN ('guardada', 'pendiente-entrega', 'entregada') AND created_at < ?
      GROUP BY target, project_id ORDER BY since`).all(Date.now() - 15 * 60_000) as { account: AccountId; projectId: string; n: number; since: number }[]
    const out = service.settings.accountStatus ?? {}
    return rows.filter((r) => !out[r.account]).map((r) => {
      const a = service.agents.find((x) => x.id === r.account)
      return { ...r, project: service.project(r.projectId)?.name ?? r.projectId, window: Boolean(a?.sessions.some((s) => s.pid && s.kind !== 'background')) }
    })
  },
  /** Tells an account in its open window to read what it has pending (pmc respuestas works without its hooks). */
  nudgeUnread: async (account: AccountId, projectId: string) => {
    const a = service.agents.find((x) => x.id === account)
    const wins = (a?.sessions ?? []).filter((s) => s.pid && s.kind !== 'background')
    const w = wins.find((s) => s.projectId === projectId) ?? wins[0]
    const p = service.project(projectId)
    if (!w?.pid) return { typed: false }
    await typeText(w.pid, `Mission Control: el usuario te ha contestado o te ha escrito en ${p?.name ?? projectId} y no lo has recibido. Ejecuta pmc respuestas, léelo y hazlo antes de seguir con lo tuyo.`)
    addEvent(service.db, { projectId, at: Date.now(), account, kind: 'relevo-app', title: t('Se le ha escrito a Claude {v0} que lea lo que tiene pendiente del usuario', { v0: account.slice(6) }), source: 'Mission Control' })
    return { typed: true }
  },
  /** The assistant (EV85): an answer from the app's data; «Enviar» for a request; «Pregúntale a Claude» (spends usage). */
  ask: (text: string, projectId?: string) => assistant.ask(String(text ?? '').slice(0, 2000), projectId ?? service.activeProjectId),
  assistantSend: (plan: any) => assistant.send(plan),
  /** EV66: what the Claudes did since the user was last seen. */
  away: async (from: number) => {
    // A minute of memory: Inicio asks again each time it opens while the user is away (88 calls of ~150 ms on 13-11).
    const f = Math.max(Number(from) || 0, Date.now() - 3 * 86400_000)
    if (awayMemo && awayMemo.from === f && Date.now() - awayMemo.at < 60_000) return awayMemo.v
    // The window asks as soon as it opens, before the accounts are read (13-11, right after an install: «Ningún Claude
    // ha hecho nada en este tiempo» after eleven hours of work, kept until «Visto»).
    if (!service.agents.length) await service.refreshAgents()
    const v = assistant.away(f)
    if (service.agents.length) awayMemo = { from: f, at: Date.now(), v }
    return v
  },
  askClaude: (text: string, projectId?: string) => assistant.askClaude(String(text ?? '').slice(0, 2000), projectId ?? service.activeProjectId),
  /** «Nueva instrucción» (EV46): the project its words point to, if one stands out. */
  routeRequest: (text: string) => {
    const projects = service.projects.map((p) => ({
      id: p.id, name: p.name,
      vocabulary: (service.db.prepare("SELECT title, substr(COALESCE(detail, ''), 1, 300) AS d FROM tasks WHERE project_id = ? AND gone = 0 ORDER BY source_line DESC LIMIT 400").all(p.id) as { title: string; d: string }[]).map((r) => `${r.title} ${r.d}`)
    }))
    return guessProject(text, projects)
  },
  /** Who will do a request in a project (EV46): the one working there, an idle window there, or the freest account. */
  whoWillDo: (projectId: string) => {
    const now = Date.now()
    const accounts: RouteAccount[] = service.agents.map((a) => {
      const w = a.usage.snapshot?.sevenDay
      return {
        id: a.id, out: Boolean(service.settings.accountStatus?.[a.id]), limited: a.state === 'sin-uso',
        weekFree: w && w.resetsAt > now ? Math.max(0, 100 - Math.round(w.usedPct)) : undefined,
        windows: a.sessions.filter((x) => x.pid || isSessionWorking(x)).map((x) => ({ projectId: x.projectId, working: isSessionWorking(x) }))
      }
    })
    return pickAccount(projectId, accounts)
  },
  /**
   * «Guardar y que empiece» (EV46): through the dispatcher, like every window the app opens. The request itself reaches the
   * account through the hooks (it was saved for it); here it is only told to look, or opened with «sigue».
   */
  startOn: async (projectId: string, account: AccountId) => {
    const p = service.project(projectId)
    if (!p) throw new Error(t('Proyecto desconocido'))
    const copy = workCopy(p)
    const d = await autoOpen({
      account, project: p, reason: 'reparto', cwd: copy?.path ?? p.root, args: ['--permission-mode', 'auto', 'sigue'],
      title: t('{account} · {name} · encargo del usuario', { account: account, name: p.name }),
      message: t('Mission Control: el usuario te ha dejado un encargo en {name}; te llega con tu próximo paso. Hazlo antes que lo tuyo.', { name: p.name })
    })
    return { action: d.action, why: d.why }
  },
  /** Routines of a project (EV44): what applies now, the defaults, and the last runs. */
  routines: (projectId: string) => {
    const p = routineProjects().find((x) => x.id === projectId)
    if (!p) throw new Error(t('Proyecto desconocido'))
    const defaults = routineDefaults(p)
    const chosen = service.settings.routines?.[projectId] ?? {}
    const last = service.db.prepare("SELECT at, kind, title FROM events WHERE project_id = ? AND source = 'Rutina' ORDER BY at DESC LIMIT 3").all(projectId) as { at: number; kind: string; title: string }[]
    return { now: { ...defaults, ...chosen }, defaults, light: p.light, all: p.all, heavy: p.heavy, running: routineRunning === projectId, last }
  },
  /** EV44: where this project's backup goes and how the last one went. */
  backupInfo: (projectId: string) => backup?.info(projectId),
  /** EV44: «Copiar ahora»: false when another copy is running (one at a time). */
  backupNowProject: (projectId: string) => { const ok = backup?.now(projectId) ?? false; if (ok) service.push(); return ok },
  /** EV44: on or off for one project; the folder and the hour are the same for all. */
  setBackup: (patch: { projectId?: string; on?: boolean; dir?: string; hora?: string }) => {
    const s = { ...(service.settings.backup ?? {}) }
    if (patch.projectId && patch.on !== undefined) {
      const off = new Set(s.off ?? [])
      if (patch.on) off.delete(patch.projectId); else off.add(patch.projectId)
      s.off = [...off]
      if (patch.on) s.on = true
    } else if (patch.on !== undefined) s.on = patch.on
    if (patch.dir) s.dir = patch.dir
    if (patch.hora) s.hora = patch.hora
    service.setSettings({ backup: s })
    return patch.projectId ? backup?.info(patch.projectId) : s
  },
  setRoutine: (projectId: string, patch: { trasCommit?: boolean; noche?: boolean; hora?: string }) => {
    const all = { ...(service.settings.routines ?? {}) }
    all[projectId] = { ...(all[projectId] ?? {}), ...patch }
    service.setSettings({ routines: all })
    return all[projectId]
  },
  /**
   * A project whose folder was moved or renamed (EV50): the user shows where it is now. Same id, name, colour, notes and
   * history; its copies and gallery folders are read again from the new place.
   */
  relocateProject: async (id: string) => {
    const p = service.project(id)
    if (!p) throw new Error(t('Proyecto desconocido'))
    const r = await dialog.showOpenDialog(win!, { title: t('¿Dónde está ahora {name}?', { name: p.name }), properties: ['openDirectory'] })
    if (r.canceled || !r.filePaths[0]) return undefined
    const root = r.filePaths[0]
    const same = basename(root).toLowerCase() === basename(p.root).toLowerCase() || existsSync(join(root, 'docs', 'TASKS.md')) || existsSync(join(root, 'pmc.json'))
    if (!same) {
      const ok = await dialog.showMessageBox(win!, { type: 'question', buttons: ['Sí, es esta', 'Cancelar'], defaultId: 1, cancelId: 1, noLink: true, message: t('Esa carpeta no se llama como antes ni tiene docs/TASKS.md. ¿Seguro que es {name}?', { name: p.name }) })
      if (ok.response !== 0) return undefined
    }
    const fresh = await detectProject(root, p.name)
    const old = p.root.toLowerCase()
    const mediaDirs = [...new Set([...p.mediaDirs.map((d) => (d.toLowerCase().startsWith(old) ? root + d.slice(p.root.length) : d)), ...fresh.mediaDirs])]
    const next = service.updateProject(id, { root: fresh.root, copies: fresh.copies, mediaDirs })
    addEvent(service.db, { projectId: id, at: Date.now(), kind: 'proyecto', title: t('{name} está ahora en {root} (antes en {v0})', { name: p.name, root: fresh.root, v0: p.root }), source: 'Mission Control' })
    service.syncDocs(true)
    void service.refreshGit()
    return next
  },
  /** «Tus proyectos» in Inicio (EV47): every project's health in one line, from what the app already reads. */
  projectsHealth: () => {
    const now = Date.now()
    return service.projects.map((p) => {
      // EV50: a folder that is not there any more is said first, with the way to fix it.
      if (!existsSync(p.root)) return { id: p.id, name: p.name, color: p.color, active: p.id === service.activeProjectId, missing: true, level: 'mal' as const, parts: [`no encuentro su carpeta (${p.root}): si la has movido o renombrado, pulsa aquí y dime dónde está`] }
      const rows = service.db.prepare('SELECT ext_id, title, detail, COALESCE(override, status) AS st FROM tasks WHERE project_id = ? AND gone = 0').all(p.id) as { ext_id?: string; title: string; detail?: string; st: string }[]
      const open = new Set(rows.filter((r) => r.ext_id && r.st !== 'terminada').map((r) => r.ext_id!))
      const counts = { pendiente: 0, enCurso: 0, revision: 0, esperan: 0 }
      for (const r of rows) {
        if (r.st === 'terminada') continue
        if (taskTags(`${r.title} ${r.detail ?? ''}`).after.some((id) => id !== r.ext_id && open.has(id))) counts.esperan++
        else if (r.st === 'en-desarrollo') counts.enCurso++
        else if (r.st === 'revision') counts.revision++
        else counts.pendiente++
      }
      let declared = false
      try { declared = Boolean(checksOf(workCopy(p)?.path ?? p.root)?.length) } catch { /* an unreadable pmc.json counts as none */ }
      const check = lastCheckOf(service.db, p.id)
      const working = service.agents.filter((a) => a.sessions.some((x) => x.projectId === p.id && isSessionWorking(x))).map((a) => a.id)
      const media = (service.db.prepare('SELECT COALESCE(SUM(size), 0) AS b FROM assets WHERE project_id = ? AND gone = 0').get(p.id) as { b: number }).b
      let claudeMdLines: number | undefined
      let claudeMdClashes: [string, string][] | undefined
    try { const md = readFileSync(join(p.root, 'CLAUDE.md'), 'utf8').split('\n'); claudeMdLines = md.length; claudeMdClashes = strictClashes(md) } catch { /* none */ }
      // EV94: the files each Claude wrote since the last commit that are still unsaved, once nobody works there.
      const copies = service.copies.get(p.id) ?? []
      const since = Math.min(...copies.map((c) => c.headAt ?? now - 3 * 86400_000), now - 3600_000)
      const writes = working.length ? [] : (service.db.prepare("SELECT account, detail AS file, at FROM events WHERE project_id = ? AND kind = 'archivo' AND at > ? AND account IS NOT NULL AND detail IS NOT NULL ORDER BY at DESC LIMIT 2000").all(p.id, since) as { account: string; file: string; at: number }[])
      const unsaved = leftUnsaved({ copies, writes, working, now })
      const h = projectHealth({ unsaved, claudeMdLines, claudeMdClashes, copies, check: check ? { outcome: check.outcome, at: check.at, summary: check.summary } : undefined, checksDeclared: declared, counts, working, now, mediaBytes: media })
      return { id: p.id, name: p.name, color: p.color, active: p.id === service.activeProjectId, ...h }
    })
  },
  /**
   * EV95: a skill set aside (out of `skills`, into `skills-apartadas`) or brought back. Only inside an account's folder or
   * a project's `.claude`: nothing else on the disk is moved.
   */
  /** EV145: an account skill taken to the one project that uses it (every work copy), or back to the accounts. */
  skillToProject: (name: string, projectId: string) => {
    const p = service.project(projectId)
    if (!p) throw new Error(t('Proyecto desconocido'))
    const dirs = [...new Set(service.accounts.map((a) => join(envFor(a).CLAUDE_CONFIG_DIR ?? (a.configDir || join(homedir(), '.claude')), 'skills')))]
    const m = takeSkillToProject({ name, projectId, accountSkillDirs: dirs, copies: [p.root, ...p.copies.map((c) => c.path)], gitExclude: gitExcludeOf(p.root) })
    service.log(`skills: ${name} llevada a ${p.name} (${m.placed.length} copias)`)
    addEvent(service.db, { projectId, at: Date.now(), kind: 'proyecto', title: t('Skill {name} llevada a {v0}: ya no pesa en las sesiones de los demás proyectos', { name: name, v0: p.name }), source: 'Mission Control' })
    return m
  },
  skillReturn: (name: string) => {
    const m = returnSkill(name)
    service.log(`skills: ${name} devuelta a las cuentas`)
    return m
  },
  skillAside: (dir: string, back = false) => {
    const norm = (p: string) => p.replace(/[\\/]+$/, '').toLowerCase().replace(/\//g, '\\')
    const bases = [
      ...service.accounts.map((a) => envFor(a).CLAUDE_CONFIG_DIR ?? (a.configDir || join(homedir(), '.claude'))),
      ...service.projects.flatMap((p) => [p.root, ...p.copies.map((c) => c.path)].map((r) => join(r, '.claude')))
    ].map(norm)
    if (!bases.includes(norm(dirname(dirname(dir))))) throw new Error(t('Esa carpeta no es de ninguna cuenta ni proyecto'))
    const to = back ? bringBack(dir) : setAside(dir)
    service.log(`skills: ${back ? 'devuelta' : 'apartada'} ${dir} → ${to}`)
    return to
  },
  /** EV43: what each task of the project cost lately (claim → done, week points) and the average per model (Próximo). */
  taskCosts: (projectId: string, days = 7) => {
    const since = Date.now() - days * 86400_000
    const claims = service.db.prepare("SELECT at, account, title FROM events WHERE project_id = ? AND kind = 'reserva' AND at > ? AND account IS NOT NULL").all(projectId, since - 3 * 86400_000) as { at: number; account: string; title: string }[]
    const dones = service.db.prepare("SELECT at, title FROM events WHERE project_id = ? AND kind = 'tarea-hecha' AND at > ?").all(projectId, since) as { at: number; title: string }[]
    const history: Record<string, ReturnType<typeof readUsageHistory>> = {}
    for (const a of new Set(claims.map((c) => c.account))) history[a] = readUsageHistory(a as AccountId, since - 3 * 86400_000)
    const models: Record<string, string | undefined> = {}
    for (const t of service.db.prepare("SELECT ext_id, title, COALESCE(detail, '') AS d FROM tasks WHERE project_id = ? AND ext_id IS NOT NULL").all(projectId) as { ext_id: string; title: string; d: string }[]) models[t.ext_id] = taskTags(`${t.title} ${t.d}`).model
    const costs = taskCosts(claims, dones, history, models)
    const byModel = costByModel(costs)
    // The ones at work now that already spent more than three times the usual: «avisar de las que se comen la semana».
    const doneIds = new Set((service.db.prepare("SELECT ext_id FROM tasks WHERE project_id = ? AND ext_id IS NOT NULL AND COALESCE(override, status) = 'terminada'").all(projectId) as { ext_id: string }[]).map((r) => r.ext_id))
    const lastDone: Record<string, number> = {}
    for (const c of costs) if (c.doneAt && c.doneAt > (lastDone[c.account] ?? 0)) lastDone[c.account] = c.doneAt
    const heavy = heavyNow(claims.filter((c) => c.at > Date.now() - 2 * 86400_000), doneIds, history, models, byModel, Date.now(), 3, 6, lastDone)
    return { days, costs: [...costs].sort((a, b) => b.points - a.points).slice(0, 8), byModel, total: costs.length, heavy }
  },
  /** EV20: per project, what the automatic distribution would do now and why (Próximo), whether it is on or not. */
  staffPlans: () => {
    const now = Date.now()
    const busyNow = busyNow_() ?? NOTHING_BUSY
    const held = heldResources(service.db).map((h) => h.name)
    const taken = new Set<string>()
    const projects = service.projects.map((p) => {
      const r = staffPlanFor(p, { now, busyNow, held, taken })
      for (const f of r.plan?.fronts ?? []) taken.add(f.account)
      return { projectId: p.id, name: p.name, color: p.color, why: r.why, fronts: r.plan?.fronts ?? [] }
    })
    return { on: Boolean(service.settings.autoPlan), max: Math.max(1, Number(service.settings.maxFronts) || 1), projects }
  },
  /** IV1: each backup rule with whether it would open its account now, and why (Cuentas shows it). */
  reserveState: () => (service.settings.reserves ?? []).map((r) => ({ ...r, ...reserveDue(r, service.agents, service.settings.accountStatus ?? {}, Date.now(), reserveWork(r)) })),
  setSettings: (patch: any) => {
    // EV140: the hand-over between accounts is turned on only after reading Anthropic's rules (the window shows them first).
    if (!service.settings.relayRulesAt && !patch?.relayRulesAt && turnsOnRelay(patch, service.settings)) throw new Error(RELAY_RULES.refused)
    // EV128: a way of working picked in the window is the user's from then on: the app no longer fits it to the team.
    if (patch && !('workModeBy' in patch) && ['autonomous', 'autoRelay', 'relayMode', 'heavyTurns'].some((k) => k in patch)) patch = { ...patch, workModeBy: 'usuario' }
    const s = service.setSettings(patch)
    applyTheme()
    // EV161: the main process speaks the same language (statuses it sends, notices).
    setLang(pickLang(s.lang, app.getLocale()))
    return s
  },
  /** The size the app is shown at now (the chosen one, or the default for this screen). */
  uiScale: () => uiScale(),
  /** EV96: each account's reset and what the app will do with it; «Usarla ya» and «Mirar su ventana». */
  recharges: () => recharge.view(),
  useRecharge: (account: AccountId) => recharge.apply(account, recharge.inputFor(account).limit?.kind === 'semanal' ? 'weekly' : '5-hour'),
  lookRecharge: (account: AccountId) => recharge.look(account),
  /** EV96: which resets it holds, without using any (types /limit-reset in an idle window, reads, Esc). */
  probeRecharge: (account: AccountId) => recharge.probe(account),
  /** EV98: accounts whose sign-in ends soon or ended (only those). */
  logins: () => Object.fromEntries(service.accounts.filter((a) => !service.settings.accountStatus?.[a.id]).map((a) => [a.id, loginWarning(logins[a.id])]).filter(([, w]) => w)),
  recheckLogins: () => checkLogins(),
  /** EV100: measure a project's space (in the background) and what is known of it. Nothing is moved or deleted. */
  cleanupStart: (projectId: string) => cleanup.start(projectId),
  cleanupView: (projectId: string) => cleanup.view(projectId),
  /** EV100: «sobra seguro» to the recycle bin; «dudoso» set aside (moved, with its card); back to its place. */
  cleanupTrash: (projectId: string, path: string) => cleanup.trash(projectId, path),
  cleanupAside: (projectId: string, path: string) => cleanup.aside(projectId, path),
  cleanupRestore: (projectId: string, from: string) => cleanup.restore(projectId, from),
  /** EV102: what was retired from the project (git branches or tags retirado/*) and when its course was last reviewed. */
  retired: async (projectId: string) => {
    const p = service.project(projectId)
    if (!p) return { items: [], lastReview: 0 }
    const out = await new Promise<string>((resolve) => execFile('git', ['for-each-ref', '--sort=-creatordate', '--format=%(refname:short)|%(creatordate:unix)|%(subject)', 'refs/heads/retirado', 'refs/tags/retirado'], { cwd: p.root, windowsHide: true, timeout: 15_000 }, (_e, so) => resolve(String(so ?? ''))))
    const items = out.split(/\r?\n/).filter(Boolean).map((l) => { const [ref, at, ...s] = l.split('|'); return { ref, at: Number(at) * 1000, subject: s.join('|') } })
    let lastReview = 0
    try { lastReview = Number(readFileSync(join(paths.root(), `rumbo-${projectId}.txt`), 'utf8')) || 0 } catch { /* never */ }
    return { items, lastReview }
  },
  /** EV100: free space on the drive of each project (one line per drive), to warn below 15 %. */
  /** EV112: the last reading of the machine's load (at most two minutes old), in words and as data. */
  machineLoad: () => {
    if (!lastLoad || Date.now() - lastLoad.at > 120_000) readLoad()
    if (!lastLoad) return undefined
    const l = lastLoad.load
    return { at: lastLoad.at, loaded: isLoaded(l), text: loadText(l), cpuPct: l.cpuPct, freeMb: l.freeMb, totalMb: l.totalMb, top: l.procs.slice(0, 5).map((p) => ({ name: p.name.replace(/\.exe$/i, ''), account: p.account, doing: doingOf(p), cpuPct: p.cpuPct, ramMb: p.ramMb })) }
  },
  diskFree: async () => {
    const out: { drive: string; free: number; total: number; projects: string[] }[] = []
    for (const p of service.projects) {
      const drive = p.root.slice(0, 3).toUpperCase()
      let row = out.find((x) => x.drive === drive)
      if (!row) { try { const s = await statfs(drive); row = { drive, free: s.bavail * s.bsize, total: s.blocks * s.bsize, projects: [] }; out.push(row) } catch { continue } }
      row.projects.push(p.id)
    }
    return out
  },
  addProject: async () => {
    const r = await dialog.showOpenDialog(win!, { title: t('Carpeta del proyecto'), properties: ['openDirectory'] })
    if (r.canceled || !r.filePaths[0]) return undefined
    const p = await service.addProject(r.filePaths[0])
    try { const made = prepareProject(detectProfile(workCopy(p)?.path ?? p.root)); if (made.length) addEvent(service.db, { projectId: p.id, at: Date.now(), kind: 'proyecto', title: t('Proyecto preparado al añadirlo: {v0}', { v0: made.join(', ') }), source: 'Mission Control' }) } catch { /* the project is added anyway */ }
    service.setSettings({ activeProjectId: p.id })
    void improveAdded(p.id)
    setTimeout(() => void autoSkillSearch(p.id), 60_000).unref()
    return p
  },
  updateProject: (id: string, patch: any) => service.updateProject(id, patch),
  /**
   * EV56: folders where some Claude already worked (each account's history.jsonl), that look like a project and are not
   * one yet, most used first: «Primeros pasos» offers them with one click instead of «Elegir la carpeta».
   */
  projectCandidates: () => {
    const known = service.projects.flatMap((p) => [p.root, ...p.copies.map((c) => c.path)]).map((r) => r.toLowerCase().replace(/[\\/]+$/, ''))
    const seen = new Map<string, { root: string; n: number; last: number }>()
    for (const acc of service.accounts) for (const h of readHistory(acc)) {
      if (!h.project) continue
      const root = h.project.replace(/[\\/]+$/, '')
      const k = root.toLowerCase()
      if (known.some((r) => k === r || k.startsWith(r + '\\') || k.startsWith(r + '/'))) continue
      const s = seen.get(k) ?? { root, n: 0, last: 0 }
      s.n++; s.last = Math.max(s.last, h.at)
      seen.set(k, s)
    }
    // Never a whole drive («B:», seen on 13-11) nor the user's folder.
    const home = homedir().toLowerCase().replace(/[\\/]+$/, '')
    return [...seen.values()].filter((s) => s.n >= 3 && !/^[a-z]:$/i.test(s.root) && s.root.toLowerCase() !== home && existsSync(s.root) && looksLikeProject(s.root))
      .sort((a, b) => b.last - a.last).slice(0, 4).map((s) => ({ root: s.root, name: s.root.split(/[\\/]/).filter(Boolean).pop() ?? s.root, prompts: s.n }))
  },
  /** A folder a Claude works in that is no project yet (Próximo › Quién está dónde): added and prepared in one go. */
  addProjectAt: async (root: string) => {
    const p = await service.addProject(root)
    try { prepareProject(detectProfile(workCopy(p)?.path ?? p.root)) } catch { /* added anyway */ }
    service.push()
    void improveAdded(p.id)
    return p
  },
  /** What the app understands of a project (core/profile.ts): kind, gallery, checks, coordination, skills, subagents. */
  projectProfile: (id: string) => {
    const p = service.project(id)
    if (!p) throw new Error(t('Proyecto desconocido'))
    const copy = workCopy(p)?.path ?? p.root
    const prof = detectProfile(copy)
    // EV32: how often each one was really called in the last week, by any account in any copy. Counted in the background
    // (it can be gigabytes of conversations) and shown from the last count; never in the way of the screen.
    const known = subagentCounts.get(id)
    if (!known || Date.now() - known.at > 10 * 60_000) refreshSubagentCounts(p)
    // EV26: the skills really loaded in this project in the last week, most used first.
    const skillUses = known ? Object.entries(known.uses).filter(([k]) => k.startsWith('skill:')).map(([k, n]) => ({ name: k.slice(6), n })).sort((x, y) => y.n - x.n) : undefined
    // EV26: the MCP servers set up for this project (by name) and the ones really called in the last week.
    const used = known ? Object.fromEntries(Object.entries(known.uses).filter(([k]) => k.startsWith('mcp:')).map(([k, n]) => [k.slice(4), n])) : undefined
    const setUp = mcpServers(copy, service.accounts.map((a) => ({ id: a.id, configDir: envFor(a).CLAUDE_CONFIG_DIR ?? a.configDir ?? '' })).filter((a) => a.configDir))
    const mcp = [...setUp.map((s) => ({ name: s.name, label: mcpLabel(s.name), where: s.where, accounts: s.accounts, uses: used ? used[s.name] ?? 0 : undefined })),
      ...Object.entries(used ?? {}).filter(([n]) => !setUp.some((s) => s.name === n)).map(([n, uses]) => ({ name: n, label: mcpLabel(n), where: 'conector' as const, accounts: [] as string[], uses }))]
      .sort((x, y) => (y.uses ?? 0) - (x.uses ?? 0) || x.label.localeCompare(y.label))
    // EV117: big files read whole in the last week (each time, all of it goes into the conversation).
    // Text only: an image or a PDF costs by what it shows, not by its size, and looking at captures is wanted.
    const bigReads = known ? Object.entries(known.uses).filter(([k]) => k.startsWith('leido:') && !/\.(png|jpe?g|gif|webp|bmp|pdf|mp4|mov|wav|mp3)$/i.test(k)).map(([k, n]) => {
      const file = k.slice(6)
      let kb = 0
      try { kb = Math.round(statSync(file).size / 1024) } catch { /* gone */ }
      return { file, name: file.split(/[\\/]/).pop() ?? file, kb, n }
    }).filter((x) => x.kb >= 50).sort((a, b) => b.kb * b.n - a.kb * a.n).slice(0, 6) : undefined
    // EV52: whether Mission Control's hooks are in the project itself (any account working here is seen).
    let projectHooks = false
    try { const f = join(copy, '.claude', 'settings.local.json'); projectHooks = existsSync(f) && /pmc[^"]*"?\s+hook\b/.test(readFileSync(f, 'utf8')) } catch { /* none */ }
    return { ...prof, kindLabels: prof.kinds.map((k) => KIND_LABEL[k]), counted: Boolean(known), skillUses, mcp, bigReads, projectHooks, agents: prof.agents.map((a) => ({ name: a.name, model: a.model, description: a.description, present: prof.docs.agents.includes(a.name), uses: known ? known.uses[a.name] ?? 0 : undefined })) }
  },
  /** Creates what the project lacks to be worked on by several accounts (never overwrites), in the copy being worked on. */
  prepareProject: async (id: string) => {
    const p = service.project(id)
    if (!p) throw new Error(t('Proyecto desconocido'))
    const copy = workCopy(p)?.path ?? p.root
    const made = prepareProject(detectProfile(copy), { refreshAgents: true })
    if (made.length) addEvent(service.db, { projectId: id, at: Date.now(), kind: 'proyecto', title: t('Proyecto preparado: {v0}', { v0: made.join(', ') }), source: 'Mission Control' })
    service.syncDocs(true)
    service.push()
    return made
  },
  /**
   * «Crear proyecto»: a new folder (or an empty one), git, the coordination files and the subagents, registered here, and
   * a Claude opened in it with what the user wants as its first instruction.
   */
  createProject: async (o: { name: string; description: string; account?: AccountId; template?: string }) => {
    const name = o.name.trim()
    if (!name || /[<>:"/\\|?*]/.test(name)) throw new Error(t('Pon un nombre sin caracteres raros'))
    const r = await dialog.showOpenDialog(win!, { title: t('¿Dónde lo creo? (se hará una carpeta con su nombre)'), properties: ['openDirectory', 'createDirectory'] })
    if (r.canceled || !r.filePaths[0]) return undefined
    const root = join(r.filePaths[0], name)
    if (existsSync(root) && readdirSync(root).length) throw new Error(t('Ya existe {root} y no está vacía: añádela con «Añadir proyecto»', { root: root }))
    mkdirSync(root, { recursive: true })
    await new Promise<void>((resolve) => execFile('git', ['init', '-q'], { cwd: root, windowsHide: true }, () => resolve()))
    // EV45: the kind the user chose frames the project from the start: rules, first tasks and the helpers that fit.
    const tpl = templateOf(o.template)
    writeFileSync(join(root, 'CLAUDE.md'), templateClaudeMd(tpl, name, o.description))
    mkdirSync(join(root, 'docs'), { recursive: true })
    writeFileSync(join(root, 'docs', 'TASKS.md'), templateTasks(tpl, name))
    prepareProject(profileAs(root, tpl.kinds, tpl.heavy))
    const p = await service.addProject(root, name)
    service.setSettings({ activeProjectId: p.id })
    const who = o.account ?? service.agents.filter((a) => !service.settings.accountStatus?.[a.id] && a.state !== 'sin-uso' && a.state !== 'desconectado').sort((a, b) => (b.usage.snapshot?.sevenDay ? 100 - b.usage.snapshot.sevenDay.usedPct : 50) - (a.usage.snapshot?.sevenDay ? 100 - a.usage.snapshot.sevenDay.usedPct : 50))[0]?.id
    if (who) {
      const first = `Proyecto nuevo (${tpl.label.toLowerCase()}), creado desde Mission Control. Lo que quiere el usuario: ${o.description.replace(/\s+/g, ' ').trim()} ${tpl.first} Ya tienes CLAUDE.md con cómo es el proyecto, las primeras tareas en docs/TASKS.md y los ayudantes en .claude/agents. Empieza por P1 (pmc claim P1): el plan, que le enseñas al usuario con pmc decide antes de construir; mientras contesta, sigue con lo que no dependa de su respuesta. Completa pmc.json con cómo se comprueba en cuanto haya código.`
      openTerminal(who, root, ['--permission-mode', 'auto', first], `${who} · ${name} (proyecto nuevo)`)
    }
    addEvent(service.db, { projectId: p.id, at: Date.now(), account: who, kind: 'proyecto', title: t('Proyecto creado: {name}{v0}', { name: name, v0: who ? ` · empieza Claude ${who.slice(6)}` : '' }), detail: o.description, source: 'Mission Control' })
    service.push()
    return { project: p, account: who }
  },
  statusLineInstall: (account: AccountId) => {
    const acc = service.accounts.find((a) => a.id === account)
    if (!acc) throw new Error(t('Cuenta desconocida'))
    if (!service.nodeExe) throw new Error(t('No se encuentra Node.js en este equipo'))
    if (!existsSync(service.pmcPath)) throw new Error(t('Falta el programa pmc.mjs'))
    const r = installStatusLine(acc, service.nodeExe, service.pmcPath)
    service.log(`statusLine instalada en ${account} (copia: ${r.backup ?? 'sin archivo previo'})`)
    service.push()
    return { ...r, state: statusLineState(acc) }
  },
  statusLineUninstall: (account: AccountId) => {
    const acc = service.accounts.find((a) => a.id === account)
    if (!acc) throw new Error(t('Cuenta desconocida'))
    const r = uninstallStatusLine(acc)
    service.push()
    return { ...r, state: statusLineState(acc) }
  },
  claims: (projectId: string) => listClaims(service.db, projectId),
  claimHistory: (projectId: string, key: string) => claimHistory(service.db, projectId, key),
  /**
   * «Que haga antes las de…»: written down until those tasks are done (see coord.ts › assignments). The first time, the
   * receiving account also gets a message with everything it needs to continue; pressing again changes nothing.
   */
  handoff: (projectId: string, from: AccountId, to: AccountId) => {
    const p = service.project(projectId)
    if (!p) throw new Error(t('Proyecto desconocido'))
    const { assignment, created } = addAssignment(service.db, projectId, from, to)
    const tasks = assignedTasks(service.db, projectId, assignment)
    if (!created) return { assignment, created, tasks: tasks.length }
    const src = service.agents.find((a) => a.id === from)
    const hb = (service.heartbeats.get(projectId) ?? []).find((h) => h.account === from)
    const reason = src?.usage.activeLimit ? `se ha quedado sin uso ${src.usage.activeLimit.kind === 'semanal' ? 'semanal' : 'de 5 horas'}` : 'no puede seguir ahora'
    const body = handoffText({
      project: p, from, to, reason, heartbeat: hb ? { at: hb.at, text: hb.text } : undefined,
      tasks: tasks.map((t) => ({ key: t.key, extId: t.extId, title: t.title, status: t.status })),
      copies: (service.copies.get(projectId) ?? []).map((c) => ({ label: c.label, branch: c.branch, dirty: c.dirty, path: c.path }))
    })
    addInstruction(service.db, { projectId, kind: 'mensaje', body, target: to })
    // What the other had reserved is free now: nobody else takes it, because it is assigned.
    for (const t of tasks) service.db.prepare('DELETE FROM claims WHERE project_id = ? AND task_key = ? AND account = ?').run(projectId, t.key, from)
    // The one whose tasks were passed on hears it at its next step (if it is at work): it finishes what it has half done
    // and leaves the rest to the other (the user, 4-11).
    const names = tasks.map((t) => t.extId ?? t.title.slice(0, 40)).slice(0, 12).join(', ')
    addNotice(from, `Mission Control: el usuario ha pasado tus tareas a ${to}${names ? ` (${names})` : ''}. Termina bien lo que tengas a medias ahora mismo, deja docs/RELEVO.md al día y no empieces ninguna de esas tareas: son de ${to}.`, [p.root, ...p.copies.map((c) => c.path)])
    addEvent(service.db, { projectId, at: Date.now(), account: to, kind: 'relevo-app', title: t('Encargo: Claude {v0} hará primero las {length} tareas de Claude {v1}', { v0: to.slice(6), length: tasks.length, v1: from.slice(6) }), detail: body, source: 'Mission Control' })
    service.rebuildAgents()
    return { assignment, created, tasks: tasks.length }
  },
  assignments: (projectId: string) => {
    pruneAssignments(service.db, projectId)
    return listAssignments(service.db, projectId).map((a) => ({ ...a, tasks: assignedTasks(service.db, projectId, a) }))
  },
  removeAssignment: (id: number) => { removeAssignment(service.db, id); service.rebuildAgents(); return true },
  moveAssignment: (projectId: string, id: number, dir: number) => { moveAssignment(service.db, projectId, id, dir); return true },
  setAssignmentOrder: (id: number, order: string[]) => { setAssignmentOrder(service.db, id, order); return true },
  /**
   * EV52: Mission Control's hooks in the project itself (.claude/settings.local.json of each copy, added to the ones it
   * has, with a copy first), so any account opened there is seen, even a new one with no hooks of its own. The user's
   * button; pmc hook does not count an event twice when the account has them too.
   */
  projectHooksInstall: (projectId: string) => {
    const p = service.project(projectId)
    if (!p) throw new Error(t('Proyecto desconocido'))
    if (!service.nodeExe) throw new Error(t('No se encuentra Node.js en este equipo'))
    const done = [p.root, ...p.copies.map((c) => c.path)].filter((d) => existsSync(d)).map((d) => installProjectHooks(d, service.nodeExe!, service.pmcPath))
    addEvent(service.db, { projectId, at: Date.now(), kind: 'proyecto', title: t('Ganchos de Mission Control puestos en el proyecto ({length} {v0}): cualquier cuenta que trabaje aquí se ve', { length: done.length, v0: done.length === 1 ? 'copia' : 'copias' }), detail: done.map((d) => d.file + (d.backup ? ` (copia previa: ${d.backup})` : '')).join('\n'), source: 'Mission Control' })
    return done.length
  },
  /** EV126: whether this PC has Claude Code (Primeros pasos offers to install it when not). */
  claudeSetup: () => ({ installed: Boolean(claudeInstalled()) }),
  /** 14-11 (the user: «debería instalarse solo… o que dé la opción ahí en comprobación de instalar con un click»). */
  installTool: async (tool: 'claude' | 'git' | 'node') => { await installTool(tool); healthCache = undefined; return true },
  /** A newer version on GitHub, if there is one (core/updates.ts); `check` asks GitHub again now. */
  updateInfo: async (check?: boolean) => { if (check) await checkUpdate(); return { current: app.getVersion(), update } },
  /** Opens the installer of the new version for this system (or its page) in the browser. */
  openUpdate: async () => { if (update) await shell.openExternal(update.download ?? update.page); return Boolean(update) },
  /**
   * EV126: Claude Code's own installer, in a window the user sees (the command its web page gives for Windows). The app
   * sees the program when it finishes (claudeInstalled looks again each time).
   */
  claudeInstall: () => {
    if (!isWin) {
      openTerminalWindow({ title: 'Instalar Claude Code', cwd: homedir(), argv: ['/bin/zsh', '-c', "curl -fsSL https://claude.ai/install.sh | bash; echo; echo 'Listo: ya puedes cerrar esta ventana y volver a Mission Control.'"] })
      return true
    }
    const child = spawn('cmd.exe', ['/d', '/s', '/c', 'start "Instalar Claude Code" powershell.exe -NoExit -NoProfile -ExecutionPolicy Bypass -Command "irm https://claude.ai/install.ps1 | iex; Write-Host; Write-Host \'Listo: ya puedes cerrar esta ventana y volver a Mission Control.\'"'], { detached: true, windowsHide: false, windowsVerbatimArguments: true, stdio: 'ignore' })
    child.unref()
    return true
  },
  /**
   * EV141 (Decidir #148 «A»: «Ver», and «poder hablarle directamente a cada ventana»): a background session opened in a
   * window of its own with `claude attach <id>`, where the user sees it and writes to it as in any other.
   */
  attachBackground: (account: AccountId, shortId: string) => {
    const acc = service.accounts.find((a) => a.id === account)
    if (!acc) throw new Error(t('Cuenta desconocida'))
    if (!/^[0-9a-f]{6,12}$/i.test(shortId)) throw new Error(t('Id de sesión raro'))
    const exe = claudeInstalled()
    if (!exe) throw new Error(t('Primero hay que instalar Claude Code'))
    if (!isWin) { openTerminalWindow({ title: `Claude ${account.slice(6)} · sesión de fondo ${shortId}`, cwd: homedir(), configDir: acc.configDir, argv: [exe, 'attach', shortId] }); return true }
    const child = spawn('cmd.exe', ['/d', '/s', '/c', `start "Claude ${account.slice(6)} · sesión de fondo ${shortId}" conhost.exe cmd.exe /k ${fontPrefix()}"${exe}" attach ${shortId}`], { cwd: homedir(), env: envFor(acc), detached: true, windowsHide: false, windowsVerbatimArguments: true, stdio: 'ignore' })
    child.unref()
    return true
  },
  /** EV126: the login of an account in a window of its own (`claude auth login`, with the account's folder). */
  claudeLogin: (account: AccountId) => {
    const acc = service.accounts.find((a) => a.id === account)
    if (!acc) throw new Error(t('Cuenta desconocida'))
    const exe = claudeInstalled()
    if (!exe) throw new Error(t('Primero hay que instalar Claude Code'))
    if (!isWin) openTerminalWindow({ title: `Iniciar sesión · Claude ${account.slice(6)}`, cwd: homedir(), configDir: acc.configDir, argv: [exe, 'auth', 'login'] })
    else spawn('cmd.exe', ['/d', '/s', '/c', `start "Iniciar sesión · Claude ${account.slice(6)}" cmd.exe /k ""${exe}" auth login"`], { cwd: homedir(), env: envFor(acc), detached: true, windowsHide: false, windowsVerbatimArguments: true, stdio: 'ignore' }).unref()
    // EV146: a sign-in that leaves no credentials file (Console, a key) is only known by asking; every 30 s for 5 minutes.
    let tries = 0
    const timer = setInterval(() => {
      if (++tries > 10) { clearInterval(timer); return }
      void authStatus(acc).then((s) => {
        if (!s?.loggedIn) return
        clearInterval(timer)
        logins[acc.id] = s
        try { writeFileSync(paths.logins(), JSON.stringify(logins, null, 1)) } catch { /* next round */ }
        service.rebuildAgents()
      })
    }, 30_000)
    timer.unref()
    return true
  },
  hooksInstall: (account: AccountId) => {
    const acc = service.accounts.find((a) => a.id === account)
    if (!acc) throw new Error(t('Cuenta desconocida'))
    if (!service.nodeExe) throw new Error(t('No se encuentra Node.js en este equipo'))
    const r = installHooks(acc, service.nodeExe, service.pmcPath)
    service.log(`hooks instalados en ${account} (copia: ${r.backup ?? 'sin archivo previo'})`)
    service.setSettings({ hooksAt: { ...(service.settings.hooksAt ?? {}), [account]: Date.now() } })
    service.push()
    return r
  },
  /**
   * Windows opened before their account's hooks were last written (12-11: autonomous mode only works with the new Stop
   * hook, and Claude Code reads hooks when a session starts). The ones not at work can be reopened on the same
   * conversation with «sigue».
   */
  staleWindows: () => {
    const out: { account: AccountId; sessionId: string; projectId?: string; working: boolean }[] = []
    for (const a of service.agents) {
      const acc = service.accounts.find((x) => x.id === a.id)
      if (!acc || service.settings.accountStatus?.[a.id]) continue
      const st = hooksState(acc)
      if (!st.installed || st.outdated) continue
      let at = service.settings.hooksAt?.[a.id]
      if (!at) { try { at = statSync(st.file).mtimeMs } catch { continue } }
      for (const s of a.sessions) {
        if (!s.pid || s.kind === 'background' || !s.startedAt || s.startedAt >= at) continue
        // In a project taken out of autonomous mode, stopping after each answer is what the user wants (EV28).
        if (s.projectId && service.settings.autonomyOff?.includes(s.projectId)) continue
        out.push({ account: a.id, sessionId: s.sessionId, projectId: s.projectId, working: isSessionWorking(s) })
      }
    }
    return out
  },
  /** EV64: the user's requests of the last days (every account), and whether something written down covers them. */
  requests: (projectId: string, days = 3) => recentRequests(days).filter((r) => r.projectId === projectId),
  requestNote: (projectId: string, hash: string) => {
    const r = allRequests(7).find((x) => x.hash === hash)
    if (!r) throw new Error(t('Esa petición ya no está'))
    requestsMemo = undefined
    const when = new Date(r.at).toLocaleString('es-ES', { day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' })
    const task = addAppTask(service.db, projectId, { title: r.text.replace(/\s+/g, ' ').slice(0, 110), detail: t('Lo pidió el usuario ({when}, en la ventana de {account}) y no estaba apuntado: «{text}»', { when: when, account: r.account, text: r.text }), status: 'pendiente' })
    service.tasks.set(projectId, listTasks(service.db, projectId))
    service.push()
    return task
  },
  requestClose: (hash: string) => { service.setSettings({ requestsClosed: [...new Set([...(service.settings.requestsClosed ?? []), hash])].slice(-500) }); return true },
  /** The project's memory (EV63): what every session reads first, and the user's changes to it. */
  memories: (projectId: string) => {
    const p = service.project(projectId)
    const list = listMemories(service.db, projectId)
    const decisions = recentDecisions(service.db, projectId)
    return { list, decisions, kinds: MEMORY_KINDS, preview: p ? memoryText(p.name, list, decisions) : '' }
  },
  /** EV92: the memories of the project a new text would contradict (same thing, opposite sense). */
  memoryConflicts: (projectId: string, text: string) => conflictsOf(text, listMemories(service.db, projectId)),
  memoryAdd: (projectId: string, kind: any, text: string) => { const m = addMemory(service.db, { projectId, kind, text, source: 'usuario' }); service.push(); return m },
  memoryEdit: (id: number, patch: any) => { editMemory(service.db, id, patch); service.push(); return true },
  memoryForget: (id: number) => { forgetMemory(service.db, id); service.push(); return true },
  /** Skills (EV62): what is installed, for each account and project, how much it is used here, and what would fit. */
  skills: (projectId: string) => {
    const p = service.project(projectId)
    const input = skillScan()
    const accounts = input.accounts
    // EV144: the saved reading while nothing changed in the skill folders (opening Skills read every SKILL.md: 158 ms).
    const installed = installedSkills(input)
    if (p && (!subagentCounts.has(p.id) || Date.now() - subagentCounts.get(p.id)!.at > 10 * 60_000)) refreshSubagentCounts(p)
    const uses = Object.fromEntries(Object.entries(p ? subagentCounts.get(p.id)?.uses ?? {} : {}).filter(([k]) => k.startsWith('skill:')).map(([k, v]) => [k.slice(6), v]))
    // EV95: the uses of each skill in every project (an account's skills serve all of them): what a «set aside» button
    // must look at. Projects not counted yet are counted in the background and come in on the next call.
    const usesEverywhere: Record<string, number> = {}
    for (const q of service.projects) {
      const c = subagentCounts.get(q.id)
      if (!c || Date.now() - c.at > 10 * 60_000) refreshSubagentCounts(q)
      for (const [k, v] of Object.entries(c?.uses ?? {})) if (k.startsWith('skill:')) usesEverywhere[k.slice(6)] = (usesEverywhere[k.slice(6)] ?? 0) + v
    }
    const countedEverywhere = service.projects.every((q) => subagentCounts.has(q.id))
    // The skills set aside (EV95), to bring them back from the same screen.
    // EV145: the ones taken to a project are not «apartadas»: they are listed apart, with «Devolver».
    const moved = readMoved()
    const movedAside = new Set(Object.values(moved).flatMap((m) => m.aside.map((x) => x.toLowerCase())))
    const aside = [...accounts.map((a) => a.configDir), ...(p ? [join(p.root, '.claude')] : [])].flatMap(asideIn).filter((d) => !movedAside.has(d.toLowerCase()))
    // EV145: an account skill only one project used (in the counted days) is offered to be taken there.
    const usedBy: Record<string, string[]> = {}
    for (const q of service.projects) for (const [k, n] of Object.entries(subagentCounts.get(q.id)?.uses ?? {})) if (k.startsWith('skill:') && n > 0) (usedBy[k.slice(6)] ??= []).push(q.id)
    const onlyIn = countedEverywhere ? Object.fromEntries(installed.filter((s) => s.scope === 'cuenta' && usedBy[s.name]?.length === 1).map((s) => [s.name, usedBy[s.name][0]])) : {}
    const prof = p ? profileOf(p.root) : undefined
    const cache = skillCache()[projectId]
    const suggestions = cache ? pickSuggestions(cache.found.filter((f) => termsFor(prof?.kinds ?? []).includes(f.term)), installed.map((s) => s.name), 18, 5, prof?.kinds ?? []) : []
    // EV133: what this screen has just counted is also the board's figure (installing or removing one comes through here).
    if (p && saveSkillsTally(p.id, skillsTally(installed, p.id, cache ? suggestions.length : undefined))) service.push()
    return { es: skillsEs(), installed, uses, usesEverywhere, countedEverywhere, aside, onlyIn, moved: Object.values(moved).map((m) => ({ name: m.name, projectId: m.projectId, at: m.at })), usesAt: p ? subagentCounts.get(p.id)?.at : undefined, kinds: prof?.kinds ?? [], summary: prof?.summary, terms: termsFor(prof?.kinds ?? []), suggestions, searchedAt: cache?.at }
  },
  /** Looks on skills.sh for what fits the project (one search per term; a minute or two). */
  skillsSearch: async (projectId: string) => {
    const p = service.project(projectId)
    if (!p) throw new Error(t('Proyecto desconocido'))
    await searchSkillsFor(p)
    return api.skills(projectId)
  },
  /** Installs a skill: in the project (every account sees it) or for every account in use. */
  skillInstall: async (projectId: string, id: string, scope: 'proyecto' | 'todas') => {
    if (!/^[\w.-]+\/[\w.-]+@[\w.:-]+$/.test(id)) throw new Error(t('Nombre de skill no válido'))
    const p = service.project(projectId)
    if (!p) throw new Error(t('Proyecto desconocido'))
    const skill = id.split('@')[1]
    if (scope === 'proyecto') {
      const cwd = workCopy(p)?.path ?? p.root
      const out = await runNpx(`npx -y skills add ${id} -a claude-code -y --copy`, cwd, 240_000)
      if (!existsSync(join(cwd, '.claude', 'skills', skill, 'SKILL.md'))) throw new Error(t('No se ha instalado: {v0}', { v0: out.slice(-300) }))
      addEvent(service.db, { projectId, at: Date.now(), kind: 'skill', title: t('Skill instalada en {name}: {skill}', { name: p.name, skill: skill }), detail: id, source: 'Mission Control' })
    } else {
      const out = await runNpx(`npx -y skills add ${id} -g -a claude-code -y --copy`, tmpdir(), 240_000)
      const src = join(homedir(), '.claude', 'skills', skill)
      if (!existsSync(join(src, 'SKILL.md'))) throw new Error(t('No se ha instalado: {v0}', { v0: out.slice(-300) }))
      // The CLI writes to ~/.claude (claude1); the other accounts get the same folder in theirs.
      for (const a of service.accounts.filter((x) => !service.settings.accountStatus?.[x.id])) {
        const dir = envFor(a).CLAUDE_CONFIG_DIR
        if (!dir) continue
        const dest = join(dir, 'skills', skill)
        if (!existsSync(dest)) { mkdirSync(join(dir, 'skills'), { recursive: true }); cpSync(src, dest, { recursive: true }) }
      }
      addEvent(service.db, { projectId, at: Date.now(), kind: 'skill', title: t('Skill instalada para todas las cuentas: {skill}', { skill: skill }), detail: id, source: 'Mission Control' })
    }
    service.push()
    return api.skills(projectId)
  },
  /** Removes a skill folder from the project's copies, or from every account; plugin skills are left to /plugin. */
  skillRemove: (projectId: string, name: string, scope: 'proyecto' | 'cuenta') => {
    if (!/^[\w.-]+$/.test(name) || name === 'mission-control') throw new Error(t('Esa skill no se quita desde aquí'))
    const p = service.project(projectId)
    const dirs = scope === 'proyecto'
      ? (p ? [p.root, ...p.copies.map((c) => c.path)] : []).map((r) => join(r, '.claude', 'skills', name))
      : service.accounts.map((a) => join(envFor(a).CLAUDE_CONFIG_DIR ?? (a.configDir || join(homedir(), '.claude')), 'skills', name))
    let n = 0
    for (const d of [...new Set(dirs)]) if (existsSync(join(d, 'SKILL.md'))) { rmSync(d, { recursive: true, force: true }); n++ }
    addEvent(service.db, { projectId, at: Date.now(), kind: 'skill', title: `Skill quitada (${scope === 'proyecto' ? 'del proyecto' : 'de las cuentas'}): ${name}`, detail: `${n} carpetas`, source: 'Mission Control' })
    service.push()
    return api.skills(projectId)
  },
  /** The relay wheel of a project (Relevos), and the user's changes to it. */
  chain: (projectId: string) => wheel.view(projectId),
  chains: () => wheel.viewAll(),
  relayHistory: (projectId: string) => service.db.prepare("SELECT at, account, title, detail FROM events WHERE project_id = ? AND kind = 'relevo-app' AND at > ? ORDER BY at DESC LIMIT 12").all(projectId, Date.now() - 7 * 86400_000),
  chainSet: (projectId: string, patch: any) => {
    if (!service.settings.relayRulesAt && chainTurnsOnRelay(patch, service.settings.relayChains?.[projectId])) throw new Error(RELAY_RULES.refused)
    return wheel.set(projectId, patch)
  },
  chainGive: (projectId: string, account: AccountId) => wheel.give(projectId, account),
  /** The name the user gives an account (Claude 1 · cuenta-principal), shown next to its number everywhere. */
  renameAccount: (id: AccountId, alias: string) => service.updateAccount(id, { alias: alias.replace(/\s+/g, ' ').trim().slice(0, 40) || id }),
  /** EV99: the user's own name for a Claude, only shown in the app (empty: «Claude N» again). */
  nameAccount: (id: AccountId, name: string) => {
    const r = service.updateAccount(id, { name: String(name ?? '').replace(/\s+/g, ' ').trim().slice(0, 30) || undefined })
    service.push()
    return r
  },
  /** Reopens a window on its same conversation, with the account's current hooks («sigue»). Never one at work. */
  reopenWindow: async (account: AccountId, sessionId: string, prompt?: string) => {
    const a = service.agents.find((x) => x.id === account)
    const s = a?.sessions.find((x) => x.sessionId === sessionId)
    if (!s?.pid) throw new Error(t('Esa ventana ya no está abierta'))
    if (isSessionWorking(s)) throw new Error(t('Claude {v0} está trabajando en ella: espera a que acabe su paso', { v0: account.slice(6) }))
    closeClaudeWindow(s.pid)
    await new Promise((r) => setTimeout(r, 1500))
    const p = s.projectId ? service.project(s.projectId) : undefined
    openTerminal(account, s.cwd, ['--resume', sessionId, '--permission-mode', 'auto', (prompt ?? 'sigue').replace(/\s*\r?\n\s*/g, ' ')], `${account} · ${p?.name ?? 'retomada'} (coordinación nueva)`)
    addEvent(service.db, { projectId: s.projectId, at: Date.now(), account, kind: 'sesion', title: t('Reabierta la ventana de Claude {v0} con la coordinación nueva (misma conversación)', { v0: account.slice(6) }), source: 'Mission Control' })
    setTimeout(() => void service.refreshAgents(), 2500)
    return true
  },
  hooksUninstall: (account: AccountId) => {
    const acc = service.accounts.find((a) => a.id === account)
    if (!acc) throw new Error(t('Cuenta desconocida'))
    const r = uninstallHooks(acc)
    service.push()
    return r
  },
  openPath: (p: string) => shell.openPath(p),
  showItem: (p: string) => shell.showItemInFolder(p),
  openAsset: (id: number) => {
    const p = assetPath(id)
    return p ? shell.openPath(p) : 'no'
  },
  showAsset: (id: number) => {
    const p = assetPath(id)
    if (p) shell.showItemInFolder(p)
    return true
  },
  /**
   * The hand-offs of a project, to look at (EV19): who would go on if each account working there stopped now (the very
   * decision the automatic hand-off takes), and the ones that already happened.
   */
  relays: (projectId: string) => {
    const now = Date.now()
    const s = service.settings
    const agents = service.agents.map((a) => {
      const w = a.usage.snapshot?.sevenDay
      const f = a.usage.snapshot?.fiveHour
      return { id: a.id, state: a.state, sessions: a.sessions, weekFree: w && w.resetsAt > now ? Math.max(0, 100 - Math.round(w.usedPct)) : undefined, fiveFree: f && f.resetsAt > now ? Math.max(0, 100 - Math.round(f.usedPct)) : undefined }
    })
    // Working there: a session at work in the project, or tasks of it reserved from a window opened in another folder.
    const holders = new Set(listClaims(service.db, projectId).filter((c) => !c.abandoned).map((c) => c.account as string))
    const here = service.agents.filter((a) => !s.accountStatus?.[a.id] && (a.sessions.some((x) => x.projectId === projectId && isSessionWorking(x)) || (holders.has(a.id) && a.state === 'trabajando')))
    const next = here.map((a) => {
      const wantsFable = /fable/i.test(a.usage.snapshot?.model ?? '')
      // Asked as if that account were the only one there: who takes over from it.
      const others = agents.filter((x) => x.id === a.id || !here.some((h) => h.id === x.id))
      const c = pickSuccessor({ from: a.id, projectId, agents: others, order: s.nextOrderBy?.[projectId] ?? s.nextOrder ?? [], status: s.accountStatus ?? {}, wantsFable, noFable: s.noFable ?? [] })
      const f = a.usage.snapshot?.fiveHour
      return { from: a.id, to: c.to, fable: Boolean(c.to && c.fable), why: c.why, usedPct: f && f.resetsAt > now ? Math.round(f.usedPct) : undefined, minutesLeft: a.usage.minutesLeft, backAt: f && f.resetsAt > now ? f.resetsAt : undefined }
    })
    const past = (service.db.prepare("SELECT at, account, kind, title FROM events WHERE project_id = ? AND at > ? AND (kind = 'relevo-app' OR (kind = 'sesion' AND source = 'Mission Control' AND (title LIKE 'Reparto automático%' OR title LIKE 'Arranque programado%'))) ORDER BY at DESC LIMIT 8").all(projectId, now - 7 * 86400_000) as { at: number; account?: string; kind: string; title: string }[])
    const mode = relayModeOf(s)
    const shown = mode === 'proyecto' ? next.map((r) => ({ ...r, to: undefined, fable: false, why: t('cada una en su proyecto: nadie toma su trabajo; lo retoma ella en su misma ventana al volver') })) : next
    const waiting = Object.entries(waitingTurn).filter(([, w]) => w && w.projectId === projectId).map(([account, w]) => ({ account, holder: w!.holder, since: w!.since }))
    return { next: shown, past, auto: Boolean(s.autoRelay), autonomous: Boolean(s.autonomous), mode, heavyTurns: Boolean(s.heavyTurns), waiting }
  },
  /** Each account's rank on the battlefield, from its plan (EV84); stale ones are asked again in the background. */
  ranks: () => ranks(service.accounts.filter((a) => !service.settings.accountStatus?.[a.id])),
  /** What this machine needs and whether each account's readings arrive (EV12). The programs are looked for every ten minutes. */
  health: (fresh = false) => {
    const now = Date.now()
    const st = service.state()
    const input = {
      claudePath: findClaude(),
      nodeFallback: service.nodeExe && service.nodeExe === nodeShimPath() ? service.nodeExe : undefined,
      projectRoots: service.projects.map((p) => p.root),
      accounts: service.accounts.filter((a) => !service.settings.accountStatus?.[a.id]).map((a) => ({ id: a.id, configDir: envFor(a).CLAUDE_CONFIG_DIR ?? (a.configDir || join(homedir(), '.claude')), statusLine: Boolean(st.statusLine[a.id]?.ours), hooks: Boolean(st.hooks[a.id]), usageAt: service.agents.find((x) => x.id === a.id)?.usage.snapshot?.capturedAt }))
    }
    if (fresh || !healthCache || now - healthCache.at > 10 * 60_000) healthCache = { at: now, tools: checkTools(input) }
    return { tools: healthCache.tools, readings: checkReadings(input) }
  },
  /** The last seven days of a project in figures, and the seven before, to compare (EV22). */
  metrics: (projectId: string) => {
    const now = Date.now()
    const W = 7 * 86400_000
    const usage = service.accounts.map((a) => readUsageHistory(a.id, now - 2 * W))
    return { now: metrics(service.db, projectId, now - W, now, usage), before: metrics(service.db, projectId, now - 2 * W, now - W, usage) }
  },
  /** What cannot be shared right now (EV5): the programs seen running and the turns the accounts hold. Read at most every 15 s. */
  resources: () => {
    const now = Date.now()
    void now
    return { busy: busyNow_() ?? NOTHING_BUSY, held: heldResources(service.db) }
  },
  freeResource: (name: string, account: AccountId) => {
    const ok = freeResource(service.db, name, account)
    if (ok) addEvent(service.db, { at: Date.now(), account, kind: 'reserva', title: t('Has soltado «{name}», que tenía Claude {v0}', { name: name, v0: account.slice(6) }), source: 'Mission Control' })
    service.push()
    return ok
  },
  openUsagePage: () => shell.openExternal('https://claude.ai/settings/usage'),
  /**
   * EV120: «Ya está recargada» checks it instead of taking it on trust: Claude Code says whether the account has usage
   * (and it is counted back at once) or when it comes back. Without an answer, the user's word is taken as before.
   */
  probeNow: async (account: AccountId): Promise<{ ok: boolean; checked: boolean; words: string; backAt?: number }> => {
    const r = await probe.now(account).catch(() => undefined)
    if (!r) {
      service.setSettings({ recharged: { ...(service.settings.recharged ?? {}), [account]: Date.now() } })
      return { ok: true, checked: false, words: '' }
    }
    return { ok: hasUsage(r), checked: true, words: probeWords(r), backAt: hasUsage(r) ? undefined : r.resetsAt }
  },
  /** Only web pages (a skill's page on skills.sh): nothing else is opened from here. */
  openExternal: (url: string) => (/^https:[/][/]/.test(url) ? shell.openExternal(url) : undefined),
  openSession: (account: AccountId, cwd: string) => openTerminal(account, cwd, [], `${account} · nueva sesión`),
  /**
   * «Lanzar ahora»: opens the account in the copy where the project is being worked on (the newest RELEVO.md), already told
   * «sigue». Refused when it would only spend credits for nothing; a scheduled start that would have repeated this work goes.
   */
  /**
   * EV159 «Solo esta tarea»: opens this account in the project for that one task. It works even on an account set to
   * «No usar» (sending it there by hand is the permission), never on one gone («de baja») or out of usage; its Stop hook
   * lets it stop when done (onlytask.ts) and onlyTaskTick closes its window then.
   */
  onlyTask: async (projectId: string, taskKey: string, account: AccountId) => {
    const p = service.project(projectId)
    if (!p) throw new Error(t('Proyecto desconocido'))
    const agent = service.agents.find((a) => a.id === account)
    if (!agent) throw new Error(t('Cuenta desconocida'))
    if (service.settings.accountStatus?.[account] === 'baja') throw new Error(t('Claude {v0} está de baja', { v0: account.slice(6) }))
    if (agent.state === 'sin-uso') throw new Error(t('Claude {v0} no tiene uso ahora', { v0: account.slice(6) }))
    if (agent.sessions.some((s) => s.projectId === projectId && isSessionWorking(s))) throw new Error(t('Claude {v0} ya está trabajando en {name}: espera a que acabe o ciérrala antes', { v0: account.slice(6), name: p.name }))
    const task = (service.tasks.get(projectId) ?? listTasks(service.db, projectId)).find((x) => x.key === taskKey || x.extId === taskKey)
    if (!task) throw new Error(t('Esa tarea ya no está'))
    const label = task.extId ?? task.key
    const copy = workCopy(p)
    const cwd = copy?.path ?? p.root
    const model = modelArgs(task.model, (service.settings.noFable ?? []).includes(account))
    setOnlyTask(account, { projectId, taskKey: task.key, label, at: Date.now() })
    // Reserved for it now, so no other account takes it meanwhile.
    try { claimTask(service.db, projectId, task.key, account, { note: 'solo esta tarea' }) } catch { /* it reserves it itself */ }
    openTerminal(account, cwd, ['--permission-mode', 'auto', ...model, onlyTaskPrompt({ label, title: task.title, projectName: p.name })], `${account} · ${p.name} · solo ${label}`)
    addEvent(service.db, { projectId, at: Date.now(), account, kind: 'sesion', title: t('Has abierto a Claude {v0} solo para {label}: al terminarla se cerrará', { v0: account.slice(6), label: label }), source: 'Mission Control' })
    service.push()
    setTimeout(() => void service.refreshAgents(), 4000)
    return { label, cwd }
  },
  putToWork: async (projectId: string, account: AccountId, anyway = false) => {
    const p = service.project(projectId)
    if (!p) throw new Error(t('Proyecto desconocido'))
    const agent = service.agents.find((a) => a.id === account)
    const status = service.settings.accountStatus?.[account]
    if (status) throw new Error(t('Claude {v0} está {v1}. Cámbialo en Ajustes › Cuentas si quieres usarla', { v0: account.slice(6), v1: STATUS_LABEL[status] }))
    const refusal = agent && launchRefusal(agent, projectId, anyway)
    if (refusal) throw new Error(refusal)
    const copy = workCopy(p)
    const cwd = copy?.path ?? p.root
    // EV39: with the model its next task asks for («[sonnet]» does not need Opus or Fable).
    const next = nextTasks(service.db, projectId, account, 1)[0]
    const model = modelArgs(next?.model, (service.settings.noFable ?? []).includes(account))
    // EV101: and the effort (medium for mechanical work, the account's own for the rest).
    const effort = effortArgs(next?.model)
    openTerminal(account, cwd, ['--permission-mode', 'auto', ...model, ...effort, 'sigue'], `${account} · ${p.name} · ${copy?.label ?? 'principal'}${model.length ? ` · ${model[1]}` : ''}`)
    const sched = service.settings.schedules?.[account]
    const schedule = scheduleAfterLaunch(sched, projectId)
    let otherProject: string | undefined
    // The account is already launched: not being able to take the start out must not read as a failed launch.
    let scheduleError: string | undefined
    if (schedule === 'repetido' || schedule === 'caducado') {
      try { await cancelSchedule(account) } catch (e) { scheduleError = (e as Error).message }
    }
    if (schedule === 'otro') otherProject = service.project(sched!.projectId)?.name
    addEvent(service.db, { projectId, at: Date.now(), account, kind: 'sesion', title: `Has lanzado a Claude ${account.slice(6)}${schedule === 'repetido' ? ' (y quitado su arranque programado, que iba a hacer lo mismo)' : ''}`, source: 'Mission Control' })
    service.push()
    setTimeout(() => void service.refreshAgents(), 4000)
    return { cwd, copy: copy?.label, schedule, scheduledAt: sched?.at, otherProject, scheduleError }
  },
  resumeSession: (account: AccountId, cwd: string, sessionId: string) => {
    if (!/^[0-9a-f-]{8,36}$/i.test(sessionId)) throw new Error(t('Sesión no válida'))
    openTerminal(account, cwd, ['--resume', sessionId], `${account} · retomar ${sessionId.slice(0, 8)}`)
  },
  attachSession: (account: AccountId, cwd: string, shortId: string) => {
    if (!/^[0-9a-f]{8}$/i.test(shortId)) throw new Error(t('Sesión no válida'))
    const acc = service.accounts.find((a) => a.id === account)!
    if (!isWin) { openTerminalWindow({ title: `${account} · ${shortId}`, cwd, configDir: acc.configDir, argv: [findClaude(), 'attach', shortId] }); return }
    const child = spawn('cmd.exe', ['/d', '/s', '/c', `start "${account} · ${shortId}" conhost.exe cmd.exe /k ${fontPrefix()}"${findClaude()}" attach ${shortId}`], {
      cwd, env: envFor(acc), detached: true, windowsVerbatimArguments: true, stdio: 'ignore'
    })
    child.unref()
  },
  frameUrl: (path: string) => {
    // Frames live in Mission Control's own folder; only those are served back.
    if (!path.startsWith(join(paths.root(), 'frames'))) throw new Error(t('Ruta no permitida'))
    return nativeImage.createFromPath(path).toDataURL()
  },
  asset: (id: number) => service.db.prepare('SELECT * FROM assets WHERE id = ?').get(id),
  /** A task for people: what it is, what to look at, and everything that shows it. */
  taskInfo: (projectId: string, taskId: number) => {
    const task = service.db.prepare('SELECT ext_id, title, detail, owner FROM tasks WHERE id = ?').get(taskId) as { ext_id?: string; title: string; detail: string; owner?: string } | undefined
    if (!task) return undefined
    const card = task.ext_id ? getTaskCard(service.db, projectId, task.ext_id) : undefined
    return { simple: card?.simple ?? simpleText(task.title, task.detail), ask: card?.ask, written: Boolean(card?.simple), responsible: responsibleFor(service.db, projectId, task.owner ?? undefined), media: taskMedia(service.db, projectId, { extId: task.ext_id ?? undefined, title: task.title, detail: task.detail }) }
  },
  taskCovers: (projectId: string) => taskCovers(service.db, projectId),
  /** EV138: the code a task changed, commit by commit (read from git only when the user opens it). */
  taskDiff: async (projectId: string, taskId: number) => {
    const task = service.db.prepare('SELECT ext_id FROM tasks WHERE id = ? AND project_id = ?').get(taskId, projectId) as { ext_id?: string } | undefined
    const p = service.project(projectId)
    if (!task?.ext_id || !p) return []
    return taskDiff(p.root, task.ext_id)
  },
  /** The user's answer to a review: into the account's queue, or, with `now`, for it to do right away. */
  askTaskChange: async (projectId: string, taskId: number, a: { note: string; target?: AccountId; now?: boolean }) => {
    refuseNow(a)
    const task = service.db.prepare('SELECT key FROM tasks WHERE id = ? AND project_id = ?').get(taskId, projectId) as { key: string } | undefined
    if (!task) throw new Error(t('La tarea no existe'))
    const change = askChange(service.db, { projectId, taskKey: task.key, note: a.note, target: a.target, urgent: a.now })
    return { change, ...(await afterChange(projectId, a)) }
  },
  updateTaskChange: async (projectId: string, id: number, a: { note?: string; target?: AccountId | null; now?: boolean }) => {
    refuseNow(a)
    const change = updateChange(service.db, id, { note: a.note, target: a.target, urgent: a.now ? true : undefined })
    return { change, ...(await afterChange(projectId, { target: change.target, now: a.now })) }
  },
  removeTaskChange: (projectId: string, id: number) => {
    removeChange(service.db, id)
    service.tasks.set(projectId, listTasks(service.db, projectId))
    service.push()
    return true
  },
  jobs: (projectId?: string) => listJobs(projectId),
  dismissJob: (id: string) => { removeJob(id); return true },
  /** .blend → GLB with Blender in the background (no window), into Mission Control's own folder; the original is untouched. */
  convertModel: async (id: number) => {
    const row = service.db.prepare('SELECT path, mtime FROM assets WHERE id = ?').get(id) as { path: string; mtime: number } | undefined
    if (!row) throw new Error(t('El archivo no existe'))
    const dir = join(paths.root(), 'converted')
    mkdirSync(dir, { recursive: true })
    const out = join(dir, `${id}-${row.mtime}.glb`)
    if (existsSync(out)) return true
    const blender = ['C:\\Program Files\\Blender Foundation\\Blender 5.2\\blender.exe', 'C:\\Program Files\\Blender Foundation\\Blender 5.1\\blender.exe', 'C:\\Program Files\\Blender Foundation\\Blender 5.0\\blender.exe', 'C:\\Program Files\\Blender Foundation\\Blender 4.5\\blender.exe']
      .find((p) => existsSync(p))
    if (!blender) throw new Error(t('No se encuentra Blender en este equipo'))
    const script = join(dir, 'export_glb.py')
    writeFileSync(script, "import bpy, sys\nout = sys.argv[sys.argv.index('--') + 1]\nbpy.ops.export_scene.gltf(filepath=out, export_format='GLB', export_apply=True)\n")
    await new Promise<void>((resolve, reject) => {
      const child = execFile(blender, ['-b', row.path, '--python', script, '--', out], { timeout: 240_000, windowsHide: true, maxBuffer: 16 << 20 }, (err) => (err && !existsSync(out) ? reject(new Error(t('Blender no pudo exportarlo'))) : resolve()))
      if (child.pid) try { setPriority(child.pid, osConstants.priority.PRIORITY_BELOW_NORMAL) } catch { /* it still works, just less politely */ }
    })
    if (!existsSync(out)) throw new Error(t('Blender no pudo exportarlo'))
    return true
  },
  /** A gallery tile of a model has no picture: queue one, unless it failed before or it would take running Blender. */
  queueModelThumb: (id: number) => {
    const row = service.db.prepare('SELECT name, mtime FROM assets WHERE id = ?').get(id) as { name: string; mtime: number } | undefined
    if (!row) return false
    const dir = paths.thumbsDir()
    const failMark = join(dir, `${id}-${row.mtime}-model2.fail`)
    if (existsSync(failMark) || existsSync(join(dir, `${id}-${row.mtime}-model2.jpg`))) return false
    if (row.name.toLowerCase().endsWith('.blend') && !existsSync(join(paths.root(), 'converted', `${id}-${row.mtime}.glb`))) return false
    mkdirSync(dir, { recursive: true })
    return modelThumbs.add({ id, name: row.name, failMark })
  },
  modelThumbDone: (ok: boolean) => { modelThumbs.done(ok); return true },
  /** Every conversation: first those open now, with what each is doing, then the latest closed ones. */
  /** EV71: every conversation in one place; `limit` saved ones of the project on screen (15 unless «Ver todas»). */
  chats: (limit?: number) => {
    const s = service.state()
    const out: Record<string, unknown>[] = []
    const seen = new Set<string>()
    for (const a of service.agents) {
      for (const live of a.sessions) {
        if (seen.has(live.sessionId)) continue
        const tail = readChat(chatFile(live.cwd, live.sessionId), 1, 300 << 10)
        // A background session with no process, idle for hours, is a record Claude Code keeps, not an open chat (12-11:
        // three from 31-10 to 4-11 showed as «Abierto, sin trabajar»). It goes with the closed ones.
        if (live.kind === 'background' && !live.pid && live.status !== 'busy' && Date.now() - (tail?.mtime ?? live.startedAt ?? 0) > 6 * 3600_000) continue
        seen.add(live.sessionId)
        const focus = s.activity[a.id]?.focus
        const fresh = Date.now() - (tail?.mtime ?? 0) < 45_000
        // A window waiting at its prompt is just open; it asks only when a step is left hanging, as a permission or a question does.
        // Its last reply is the limit message, still, and its account has no usage: it is not working, it waits for its
        // usage (13-11: Claude 5's windows said «Trabajando» next to «Se quedó sin uso… vuelve a las 19:50»).
        const outOfUsage = a.state === 'sin-uso' && live.rateLimited && !fresh
        const status = (live.status === 'waiting' && tail?.midTurn && Date.now() - tail.mtime < ASKING_FOR_MS) ? 'waiting' : outOfUsage ? 'limit' : live.status === 'busy' || (tail?.midTurn && fresh && live.status !== 'waiting') ? 'working' : 'idle'
        out.push({ sessionId: live.sessionId, account: a.id, alias: a.alias, cwd: live.cwd, title: live.name || basename(live.cwd), status, live: true, background: live.kind === 'background' ? live.shortId : undefined, waitingFor: live.waitingFor,
          doing: status === 'working' && focus && (!focus.sessionId || focus.sessionId === live.sessionId) ? focus.text : undefined, last: tail?.messages.at(-1)?.text.slice(0, 140), lastAt: tail?.mtime ?? live.startedAt ?? 0 })
      }
    }
    const project = s.activeProjectId
    const closed = project ? service.sessionsFor(project).filter((c) => !seen.has(c.sessionId)).slice(0, Math.max(1, Math.min(150, Number(limit) || 15))) : []
    for (const c of closed) {
      const a = service.accounts.find((x) => x.id === c.account)
      out.push({ sessionId: c.sessionId, account: c.account ?? service.accounts[0]?.id, alias: a?.alias ?? c.account ?? 'Claude', cwd: c.cwd, title: c.title || (project && service.project(project)?.name) || basename(c.cwd), status: 'closed', live: false, last: closedLast(chatFile(c.cwd, c.sessionId), c.mtime), lastAt: c.mtime })
    }
    return out
  },
  /** Asked every second while a chat is open: the file is only read again when it has changed. */
  chatRead: (sessionId: string, cwd: string) => {
    const file = chatFile(cwd, sessionId)
    if (!existsSync(file)) return null
    const mtime = statSync(file).mtimeMs
    if (chatCache?.file === file && chatCache.mtime === mtime) return chatCache.tail
    const tail = readChat(file, 80, 16 << 20) ?? null
    chatCache = { file, mtime, tail }
    return tail
  },
  /** A message from the user: into the window if it is open, as if typed there; a closed conversation is reopened with it. */
  chatSend: async (sessionId: string, cwd: string, account: AccountId, text: string) => {
    const live = liveSession(sessionId)
    if (live) {
      if (live.pid && live.kind !== 'background') {
        await typeText(live.pid, text)
        return 'typed'
      }
      // In the background it has no window to type into. Its states are working, done and blocked (EV135, 13-11).
      // EV141 (#148: «poder hablarle directamente… como hablarle al claude»): at work, the message reaches it at its next
      // step through its hook (a notice, as the wheel's), without stopping it; stopped, it goes on in the background with
      // the message (stop + --bg --resume, same conversation), not in a window that pops up.
      const acc = service.accounts.find((x) => x.id === account)
      if (live.state === 'working' || live.state === 'running' || live.status === 'busy') {
        addNotice(account, `Mensaje del usuario desde Mission Control (Chats): «${text.replace(/\s*\r?\n\s*/g, ' ')}». Atiéndelo antes de seguir con lo tuyo.`, [live.cwd])
        return 'queued'
      }
      if (acc) {
        await new Promise<void>((resolve) => execFile(findClaude(), ['stop', sessionId], { env: envFor(acc), windowsHide: true, timeout: 20_000 }, () => resolve()))
        const ok = await new Promise<boolean>((resolve) => execFile(findClaude(), bgResumeArgs(live.sessionId, text.replace(/\s*\r?\n\s*/g, ' ')), { cwd: live.cwd, env: envFor(acc), windowsHide: true, timeout: 60_000 }, (err) => resolve(!err)))
        if (ok) { setTimeout(() => void service.refreshAgents(), 3000); return 'resumed' }
      }
    }
    openTerminal(account, cwd, ['--resume', sessionId, text.replace(/\s*\r?\n\s*/g, ' ')], `${account} · desde el móvil`)
    return 'opened'
  },
  /** A capture from the phone, kept in Downloads where the user can find it too. */
  chatUpload: (name: string, dataUrl: string) => {
    if (!/^data:image\/[a-z+]+;base64,/.test(dataUrl)) throw new Error(t('Eso no es una imagen'))
    const day = new Date().toISOString().slice(0, 10)
    const dir = join(app.getPath('downloads'), 'Capturas del móvil', day)
    mkdirSync(dir, { recursive: true })
    const safe = basename(name).replace(/[^\w.-]+/g, '_').replace(/\.[^.]*$/, '')
    const file = join(dir, `${Date.now()}_${safe}.jpg`)
    writeFileSync(file, Buffer.from(dataUrl.split(',')[1], 'base64'))
    return file
  },
  /** EV151: «Traer delante» the window of an open session (one with a window; a background one opens with «Ver»). */
  frontSession: async (sessionId: string) => {
    const live = liveSession(sessionId)
    if (!live?.pid || live.kind === 'background') throw new Error(t('Esta sesión no tiene ventana abierta'))
    await bringToFront(live.pid)
    return true
  },
  chatKey: async (sessionId: string, key: string) => {
    if (!/^(esc|enter|[1-9])$/.test(key)) throw new Error(t('Tecla no válida'))
    const live = liveSession(sessionId)
    if (!live?.pid) throw new Error(t('Este chat ya no está abierto'))
    await typeKey(live.pid, key)
    return true
  },
  chatNew: (account: AccountId, projectId: string, text: string) => {
    const p = service.project(projectId)
    if (!p) throw new Error(t('Proyecto desconocido'))
    openTerminal(account, p.root, [text.replace(/\s*\r?\n\s*/g, ' ')], `${account} · desde el móvil`)
    return true
  },
  remoteStatus: () => remote.status(),
  remoteLogin: () => remote.login(),
  pushKey: () => remote.pushKey(),
  pushAdd: (sub: any) => remote.pushAdd(sub),
  /** A picture of a model as the viewer shows it, used as its gallery thumbnail. */
  saveModelThumb: (id: number, dataUrl: string) => {
    const row = service.db.prepare('SELECT mtime FROM assets WHERE id = ?').get(id) as { mtime: number } | undefined
    if (!row || !dataUrl.startsWith('data:image/')) return false
    mkdirSync(paths.thumbsDir(), { recursive: true })
    writeFileSync(join(paths.thumbsDir(), `${id}-${row.mtime}-model2.jpg`), Buffer.from(dataUrl.split(',')[1], 'base64'))
    return true
  },
  /**
   * What every session of a project reads before doing anything (EV24): the CLAUDE.md files of its folder and the ones
   * above it (Claude Code loads them all), the account's own CLAUDE.md, the memory index and Mission Control's start notice.
   * Sizes only, in rough tokens (characters / 4): what makes every start cost more.
   */
  startLoad: (projectId: string) => {
    const p = service.project(projectId)
    if (!p) return { items: [] }
    const cwd = workCopy(p)?.path ?? p.root
    const items: { what: string; file?: string; chars: number; note?: string }[] = []
    const seen = new Map<string, string>()
    const add = (what: string, file: string, note?: (text: string) => string | undefined): boolean => {
      try {
        const text = readFileSync(file, 'utf8')
        // The same text read twice (12-11: The game project's work copy sits inside the main one, and both CLAUDE.md are read).
        const twin = seen.get(text.trim())
        items.push({ what, file, chars: text.length, note: twin ? `el mismo texto que «${twin}»: se lee dos veces` : note?.(text) })
        if (!twin) seen.set(text.trim(), what)
        return true
      } catch { return false }
    }
    // From the folder up to the drive: every CLAUDE.md on the way is read, except the ones the copy excludes.
    let excluded: string[] = []
    try { excluded = (JSON.parse(readFileSync(join(cwd, '.claude', 'settings.local.json'), 'utf8').replace(/^\uFEFF/, '')).claudeMdExcludes ?? []).map((x: string) => x.split('\\').join('/').toLowerCase()) } catch { /* none */ }
    let dir = cwd
    for (let i = 0; i < 12; i++) {
      const f = join(dir, 'CLAUDE.md')
      if (!excluded.includes(f.split('\\').join('/').toLowerCase())) add(dir === cwd ? 'CLAUDE.md del proyecto' : `CLAUDE.md de ${basename(dir) || dir}`, f)
      const up = dirname(dir)
      if (up === dir) break
      dir = up
    }
    const acc = service.accounts.find((a) => !service.settings.accountStatus?.[a.id])
    const conf = acc ? envFor(acc).CLAUDE_CONFIG_DIR || acc.configDir || join(homedir(), '.claude') : undefined
    if (conf) add(`CLAUDE.md de la cuenta (${acc!.id}; cada cuenta tiene el suyo)`, join(conf, 'CLAUDE.md'))
    const lines = (text: string) => { const n = text.split(/\r?\n/).length; return n > 150 ? t('{n} líneas: Claude Code solo lee las 200 primeras', { n: n }) : t('{n} líneas', { n: n }) }
    // The memory of a work copy inside the project is the project's.
    // The account's own folder first (EV124: Claude 5 keeps its own), then the shared one.
    const memBases = [...new Set([...(conf ? [join(conf, 'projects')] : []), projectsDir()])]
    memBases.flatMap((b) => [join(b, encodeCwd(cwd), 'memory', 'MEMORY.md'), join(b, encodeCwd(p.root), 'memory', 'MEMORY.md')]).some((f) => add('Índice de memoria (MEMORY.md)', f, lines))
    items.push({ what: 'Aviso de inicio de Mission Control (aprox.)', chars: protocolText('pmc').length + 900 })
    const total = items.reduce((s, x) => s + x.chars, 0)
    return { items: items.map((x) => ({ ...x, tokens: Math.round(x.chars / 4) })), tokens: Math.round(total / 4), cwd }
  },
  /** «No leerlo dos veces» (EV24): a CLAUDE.md above the work copy with the same text as its own is left out for it. */
  excludeTwin: (projectId: string, file: string) => {
    const p = service.project(projectId)
    if (!p) throw new Error(t('Proyecto desconocido'))
    const cwd = workCopy(p)?.path ?? p.root
    const own = readFileSync(join(cwd, 'CLAUDE.md'), 'utf8').trim()
    if (!file.toLowerCase().startsWith(dirname(cwd).toLowerCase()) || readFileSync(file, 'utf8').trim() !== own) throw new Error(t('Ese CLAUDE.md no es una repetición del del proyecto'))
    const r = excludeClaudeMd(cwd, file)
    addEvent(service.db, { projectId, at: Date.now(), kind: 'proyecto', title: t('Las sesiones de {name} ya no leen dos veces el CLAUDE.md ({file})', { name: p.name, file: file }), detail: r.backup, source: 'Mission Control' })
    return r
  },
  memory: (projectId: string) => {
    const p = service.project(projectId)
    if (!p) return { files: [], docs: [] }
    // From every account's folder, each real folder once (EV124): The video project's account keeps its own, linked to its video
    // memory, and only Claude 1's was shown (13-11).
    const files: { name: string; description: string; file: string; mtime: number }[] = []
    const seenDirs = new Set<string>()
    for (const base of projectsDirs()) {
      const dir = join(base, encodeCwd(p.root), 'memory')
      try {
        const real = realpathSync(dir).toLowerCase()
        if (seenDirs.has(real)) continue
        seenDirs.add(real)
        for (const f of readdirSync(dir)) {
          if (!f.endsWith('.md') || f === 'MEMORY.md') continue
          const file = join(dir, f)
          const text = readFileSync(file, 'utf8').slice(0, 2000)
          const name = text.match(/^name:\s*(.+)$/m)?.[1]?.trim() ?? f.replace(/\.md$/, '')
          const description = text.match(/^description:\s*(.+)$/m)?.[1]?.trim() ?? ''
          files.push({ name, description, file, mtime: statSync(file).mtimeMs })
        }
      } catch { /* no memory in this account's folder */ }
    }
    const docs: { name: string; file: string; mtime: number; size: number }[] = []
    try {
      const d = join(p.root, 'docs')
      for (const f of readdirSync(d)) {
        if (!/\.(md|canvas)$/i.test(f)) continue
        const st = statSync(join(d, f))
        docs.push({ name: f, file: join(d, f), mtime: st.mtimeMs, size: st.size })
      }
    } catch { /* no docs */ }
    // The folder to open: the one with the newest memory (its account is the one working there).
    const newest = files.sort((a, b) => b.mtime - a.mtime)[0]
    return { files, dir: newest ? dirname(newest.file) : undefined, docs: docs.sort((a, b) => b.mtime - a.mtime) }
  },
  backupNow: () => service.backupNow(),
  /** The daily copies of the database, newest first (EV13). */
  backups: () => listBackups().map((b) => ({ name: b.name, at: b.at, bytes: b.bytes })),
  /**
   * Puts a copy back (EV13). Asked first; a copy of how things are now is made, so it can be undone; then the app
   * restarts and puts the chosen copy in place before opening the database.
   */
  restoreBackup: async (name: string) => {
    const b = listBackups().find((x) => x.name === name)
    if (!b) throw new Error(t('No encuentro esa copia'))
    const when = new Date(b.at).toLocaleString('es-ES', { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })
    const r = await dialog.showMessageBox(win!, {
      type: 'warning', buttons: ['Restaurar y reiniciar', 'Cancelar'], defaultId: 1, cancelId: 1, noLink: true,
      title: t('Restaurar una copia'), message: t('¿Volver a cómo estaba Mission Control el {when}?', { when: when }),
      detail: t('Se pierde lo que la app apuntó desde entonces (decisiones, notas, reservas, historial). Antes se guarda una copia de cómo está ahora, que podrás restaurar igual si te arrepientes. Tus proyectos y sus archivos no se tocan.')
    })
    if (r.response !== 0) return { restored: false }
    service.backupNow()
    requestRestore(b.file, paths.root())
    app.relaunch()
    setTimeout(() => app.exit(0), 300)
    return { restored: true }
  },
  openDataDir: () => shell.openPath(paths.root()),
  copyText: (t: string) => clipboard.writeText(t)
}

function toggleFloating(): boolean {
  if (floating && !floating.isDestroyed()) {
    floating.close()
    floating = undefined
    return false
  }
  const dark = nativeTheme.shouldUseDarkColors
  const area = screen.getPrimaryDisplay().workArea
  floating = new BrowserWindow({
    width: 380, height: 560, x: area.x + area.width - 400, y: area.y + area.height - 590,
    minWidth: 300, minHeight: 220, alwaysOnTop: true, frame: false, resizable: true, skipTaskbar: false,
    title: t('Claudes · Mission Control'), backgroundColor: dark ? '#141418' : '#f5f5f7',
    icon: join(here, '../../build/icon.png'),
    webPreferences: { preload: join(here, '../preload/index.cjs'), sandbox: false, contextIsolation: true, nodeIntegration: false, zoomFactor: uiScale() }
  })
  floating.setAlwaysOnTop(true, 'floating')
  floating.on('closed', () => { floating = undefined; win?.webContents.send('pmc:state') })
  if (process.env.ELECTRON_RENDERER_URL) void floating.loadURL(process.env.ELECTRON_RENDERER_URL + '#/flotante')
  else void floating.loadFile(join(here, '../renderer/index.html'), { hash: '/flotante' })
  return true
}

/**
 * The size of the whole app (13-11, the user on a 3440×1440 screen at 100 %: «la interfaz es muy pequeña y difícil de
 * leer»): a zoom of every window, so the layout makes room as if the window were smaller. Ajustes › Apariencia and
 * Ctrl + / Ctrl − / Ctrl 0 change it.
 */
const UI_SCALES = [0.9, 1, 1.1, 1.25, 1.4, 1.6]
function uiScale(): number {
  const chosen = service?.settings.uiScale
  if (typeof chosen === 'number' && chosen >= 0.8 && chosen <= 2) return chosen
  let wide = false
  try { wide = screen.getPrimaryDisplay().workAreaSize.width >= 2560 } catch { /* before ready */ }
  return wide ? 1.25 : 1.1
}

function applyTheme(): void {
  const t = service.settings.theme
  nativeTheme.themeSource = t === 'system' ? 'system' : t
  const z = uiScale()
  for (const w of [win, floating]) if (w && !w.isDestroyed()) { try { w.webContents.setZoomFactor(z) } catch { /* loading */ } }
  if (win && isMac) { try { win.setWindowButtonPosition(trafficLights(z)) } catch { /* older Electron */ } }
  if (win && process.platform === 'win32') {
    const dark = nativeTheme.shouldUseDarkColors
    try {
      // The title bar grows with the zoom, and the window's own buttons with it.
      win.setTitleBarOverlay({ color: '#00000000', symbolColor: dark ? '#f5f5f7' : '#1d1d1f', height: Math.round(46 * z) })
    } catch { /* not supported */ }
  }
}

// While one of these is running the user is playing: no sound, no window on top of the game, only the taskbar lights up.
import { games } from '../core/resources'

function isPlaying(): Promise<boolean> {
  return new Promise((resolve) => {
    execFile(PROCESS_LIST[0], PROCESS_LIST[1], { windowsHide: true, maxBuffer: 8 << 20 }, (err, out) => {
      if (err) return resolve(false)
      const running = asTasklist(String(out)).toLowerCase()
      resolve(games().some((g) => running.includes(`"${g.toLowerCase()}"`)))
    })
  })
}

/** Something new to look at: the taskbar lights up and, unless a game has the screen, a sound, a notice and the app in front. */
async function callUser(): Promise<void> {
  if (!win || win.isDestroyed() || process.env.PMC_SHOT_DIR) return
  const s = service.state()
  // Every project, each named (12-11: a question in another project than the one on screen went unseen).
  const byProject = Object.entries(s.pending).map(([pid, x]) => {
    const name = service.project(pid)?.name ?? pid
    const what = [[x.decisions, 'en Decidir'], [x.review, 'para revisar'], [x.comments, 'en Revisar']].filter(([n]) => (n as number) > 0).map(([n, w]) => `${n} ${w}`)
    return what.length ? `${name}: ${what.join(', ')}` : ''
  }).filter(Boolean)
  const body = [...justFinished.splice(0).map((who) => `${who} ha terminado`), ...(asking ? [`${asking} en Chats, te preguntan algo`] : []), ...byProject].join(' · ')
  const anyDecision = Object.values(s.pending).some((x) => x.decisions > 0)
  // Only if the user asks for it: from midnight to nine it only shows on the marks and the taskbar.
  const hour = new Date().getHours()
  if (hour < 9 && service.settings.quietNights) { win.flashFrame(true); return }
  if (win.isFocused()) { win.webContents.send('pmc:ding'); return }
  void remote.push('Tienes cosas que mirar', body, anyDecision ? 'decisiones' : asking || finished ? 'chats' : (s.summary?.tasks.review ?? 0) ? 'tareas' : 'revisiones').catch(() => undefined)
  win.flashFrame(true)
  win.once('focus', () => win?.flashFrame(false))
  if (await isPlaying()) return
  win.webContents.send('pmc:ding')
  const notice = new Notification({ title: t('Tienes cosas que mirar'), body, silent: true })
  notice.on('click', () => { if (win) { if (win.isMinimized()) win.restore(); win.show(); win.focus() } })
  notice.show()
  // In front, without taking the keyboard from whatever the user is typing in.
  if (win.isMinimized()) win.restore()
  win.showInactive()
  win.moveTop()
}

function chatFile(cwd: string, sessionId: string): string {
  // In whichever account's folder it is: Claude 5 keeps its own (13-11, its windows in Chats had no text).
  return findTranscript(sessionId, cwd) ?? join(projectsDir(), encodeCwd(cwd), `${sessionId}.jsonl`)
}

/**
 * EV115: a closed conversation's last line, read again only when its file changed (13-11: «chats 479 ms»: the list is
 * asked every 4 s while Chats is on screen, and each time it parsed the last 300 KB of up to 15 closed conversations).
 */
const closedLastCache = new Map<string, { mtime: number; last?: string }>()
function closedLast(file: string, mtime: number): string | undefined {
  const hit = closedLastCache.get(file)
  if (hit && hit.mtime === mtime) return hit.last
  const last = readChat(file, 1, 300 << 10)?.messages.at(-1)?.text.slice(0, 140)
  if (closedLastCache.size > 400) closedLastCache.clear()
  closedLastCache.set(file, { mtime, last })
  return last
}

function liveSession(sessionId: string) {
  for (const a of service.agents) for (const s of a.sessions) if (s.sessionId === sessionId) return s
  return undefined
}

const remote = createRemote({
  rootDir: join(here, '../renderer'),
  call: async (method, args) => {
    const fn = api[method]
    if (!fn) throw new Error(t('Método desconocido: {method}', { method: method }))
    return await fn(...args)
  },
  media: servePmc
})

// Chats that need the user: one waiting for an answer (the same that shows as «Te espera»), or one that was working and has been quiet for a minute.
let chatCache: { file: string; mtime: number; tail: ReturnType<typeof readChat> | null } | undefined
const ASKING_FOR_MS = 6 * 3600_000
let asking = 0
const waits = new WaitCounter()
let finished = 0
const justFinished: string[] = []
const busySince = new Map<string, { at: number; who: string }>()

function watchChats(): void {
  const now = Date.now()
  const waitingIds: string[] = []
  for (const a of service.agents) {
    for (const live of a.sessions) {
      if (live.status === 'busy') { busySince.set(live.sessionId, { at: now, who: a.alias }); continue }
      if (live.status === 'waiting') { waitingIds.push(live.sessionId); continue }
      const was = busySince.get(live.sessionId)
      if (was && now - was.at > 60_000) {
        busySince.delete(live.sessionId)
        finished++
        justFinished.push(was.who)
      }
    }
  }
  asking = waitingIds.length
  waits.update(waitingIds)
  ringIfMore()
}

/**
 * Waking a Claude costs credits: once per burst of answers, a minute after the user's last one (not while they are
 * still at it), and only if no Claude is working on the project (MC2: it used to wait for nothing at all to be left to
 * answer, which with something always in «Para revisar» never came).
 */
const answers = new AnswerWatch({ quietMs: 60_000, tell: () => void tellClaude() })
function watchAnswers(waiting: number): void {
  answers.update(waiting)
}

/** One working on the project hears of the answers at its next step anyway; only when all are stopped does one need calling. */
async function tellClaude(): Promise<void> {
  const s = service.state()
  const project = s.activeProjectId ? service.project(s.activeProjectId) : undefined
  if (!project) return
  const roots = [project.root, ...project.copies.map((c) => c.path)].map((r) => r.replace(/\//g, '\\').toLowerCase())
  // Inside the folder, not just starting like it («D:\Video App» is not in «D:\Video»).
  const here = service.agents.flatMap((a) => a.sessions).filter((x) => roots.some((r) => isInside(x.cwd, r)))
  // A Claude only waiting for background work reads as busy, but nothing will reach it until something calls it:
  // busy means its conversation moved in the last minute.
  const moving = (x: (typeof here)[number]) => { const t = readChat(chatFile(x.cwd, x.sessionId), 1, 100 << 10); return t && t.midTurn && Date.now() - t.mtime < 60_000 }
  if (here.some(moving)) return
  const windows = here.filter((x) => x.pid && x.kind !== 'background')
  const newest = windows.sort((a, b) => (readChat(chatFile(b.cwd, b.sessionId), 1, 100 << 10)?.mtime ?? 0) - (readChat(chatFile(a.cwd, a.sessionId), 1, 100 << 10)?.mtime ?? 0))[0]
  if (!newest?.pid) return
  await typeText(newest.pid, 'Mission Control: el usuario ha respondido en Decidir, en Para revisar o con notas en Tareas. Míralo y sigue.').catch(() => undefined)
}

function ringIfMore(): void {
  const s = service.state()
  const all = Object.values(s.pending).reduce((n, x) => n + x.decisions + x.review + x.comments, 0)
  watchAnswers(all)
  attention.update(all + waits.total + finished)
}

const attention = new AttentionBell({ gatherMs: 5000, quietMs: 60_000, ring: () => void callUser() })

const modelThumbs = createModelThumbs({
  preload: join(here, '../preload/index.cjs'),
  open: (w, hash) => {
    if (process.env.ELECTRON_RENDERER_URL) void w.loadURL(`${process.env.ELECTRON_RENDERER_URL}#${hash}`)
    else void w.loadFile(join(here, '../renderer/index.html'), { hash })
  },
  // Only while the user is looking at the app: never behind a game. PMC_THUMBS_UNATTENDED is for testing.
  allowed: () => process.env.PMC_THUMBS_UNATTENDED === '1' || Boolean(win?.isFocused()),
  onReady: (id) => { win?.webContents.send('pmc:model-thumb', id); remote.emit('model-thumb', id) }
})

let quitting = false
let toldTray = false
app.on('before-quit', () => { quitting = true })

/** macOS: the three window buttons, centred in the app's 52 px bar at the chosen size. */
const trafficLights = (z: number) => ({ x: 16, y: Math.max(8, Math.round((52 * z - 16) / 2)) })

function createWindow(): void {
  const dark = nativeTheme.shouldUseDarkColors
  win = new BrowserWindow({
    width: 1480,
    height: 920,
    minWidth: 760,
    minHeight: 560,
    show: false,
    // Decidir #141: inside, «Mission Control»; the installer and the shortcut keep «Pakitron Mission Control».
    title: 'Mission Control',
    backgroundColor: dark ? '#0e0e11' : '#f5f5f7',
    titleBarStyle: 'hidden',
    ...(isMac
      ? { trafficLightPosition: trafficLights(uiScale()) }
      : { titleBarOverlay: { color: '#00000000', symbolColor: dark ? '#f5f5f7' : '#1d1d1f', height: Math.round(46 * uiScale()) } }),
    icon: join(here, '../../build/icon.png'),
    webPreferences: {
      preload: join(here, '../preload/index.cjs'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
      autoplayPolicy: 'no-user-gesture-required',
      zoomFactor: uiScale()
    }
  })
  // The size chosen in Ajustes, again after every load (a reload would go back to 100 %).
  win.webContents.on('did-finish-load', () => { try { win?.webContents.setZoomFactor(uiScale()) } catch { /* closing */ } })
  // Ctrl + / Ctrl − / Ctrl 0: the size of the whole app, kept (not Chromium's own zoom, which would be lost on restart).
  win.webContents.on('before-input-event', (e, input) => {
    if (input.type !== 'keyDown' || !(input.control || input.meta) || input.alt) return
    const up = input.key === '+' || input.key === '=' || input.code === 'NumpadAdd'
    const down = input.key === '-' || input.code === 'NumpadSubtract'
    const reset = input.key === '0' || input.code === 'Numpad0'
    if (!up && !down && !reset) return
    e.preventDefault()
    const cur = uiScale()
    const next = reset ? undefined : down ? ([...UI_SCALES].reverse().find((s) => s < cur - 0.001) ?? UI_SCALES[0]) : (UI_SCALES.find((s) => s > cur + 0.001) ?? UI_SCALES[UI_SCALES.length - 1])
    service.setSettings({ uiScale: next })
    applyTheme()
    service.push()
  })
  win.once('ready-to-show', () => {
    if (process.env.PMC_SHOT_DIR || !win) return
    // Reopened by an install or a capture (closing.txt, written just before closing it): as it was, never jumping in front
    // of what the user is doing (13-11: some 40 installs a day, each one stealing the focus from Premiere or a game).
    let byInstall = false
    try { byInstall = Date.now() - statSync(join(paths.root(), 'closing.txt')).mtimeMs < 3 * 60_000 } catch { /* no mark */ }
    let before: { focused?: boolean; minimized?: boolean; visible?: boolean } = {}
    try { before = JSON.parse(readFileSync(join(paths.root(), 'window.json'), 'utf8')) } catch { /* first time */ }
    if (!byInstall || before.focused) win.show()
    else if (before.visible === false) { /* it was in the tray: it stays there */ }
    else { win.showInactive(); if (before.minimized) win.minimize() }
  })
  // What the window was like, for the next start after an install (above).
  const keepState = () => { try { if (win && !win.isDestroyed()) writeFileSync(join(paths.root(), 'window.json'), JSON.stringify({ focused: win.isFocused(), minimized: win.isMinimized(), visible: win.isVisible(), at: Date.now() })) } catch { /* next time */ } }
  for (const ev of ['focus', 'blur', 'minimize', 'restore', 'show', 'hide'] as const) win.on(ev as 'focus', keepState)
  // With a relay wheel on, closing the window leaves the app in the tray: it is what hands the turn over (12-11). «Salir»
  // in the tray menu quits for real.
  win.on('close', (e) => {
    if (quitting || !tray || !Object.values(service?.settings.relayChains ?? {}).some((c) => c?.on)) return
    e.preventDefault()
    win?.hide()
    if (!toldTray && Notification.isSupported()) new Notification({ title: t('Mission Control sigue en la bandeja'), body: t('Hay una rueda de relevos encendida: la app sigue pasando el turno. Para cerrarla del todo, «Salir» en el icono de la bandeja.') }).show()
    toldTray = true
  })
  win.on('closed', () => { modelThumbs.stop(); attention.stop() })
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  // A screen that breaks leaves its error in mission.log (12-11: Ajustes came out black and nothing said why).
  win.webContents.on('console-message', (e: any, lvl?: any, msg?: any) => {
    const level = e?.level ?? lvl
    const message = e?.message ?? msg
    if (level === 3 || level === 'error') service.log(`pantalla: ${String(message).slice(0, 600)}`)
  })
  win.webContents.on('render-process-gone', (_e, d) => {
    // `npm run actualizar` and `npm run capturas` close the app by force and leave closing.txt first: that is not a crash.
    let closing = false
    try { closing = Date.now() - statSync(join(paths.root(), 'closing.txt')).mtimeMs < 60_000 } catch { /* no mark */ }
    service.log(closing ? `pantalla cerrada para actualizar o capturar (${d.reason})` : `pantalla caída: ${d.reason}`)
  })
  if (process.env.ELECTRON_RENDERER_URL) void win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else void win.loadFile(join(here, '../renderer/index.html'))
}

/** Visual review: PMC_SHOT_DIR=dir renders every screen at several window sizes and saves PNGs, then quits. */
async function screenshots(dir: string): Promise<void> {
  mkdirSync(dir, { recursive: true })
  const routes = (process.env.PMC_SHOT_ROUTES ?? 'inicio,chats,decisiones,proximo,agentes,tareas,galeria,revisiones,cronologia,integracion,memoria,ajustes').split(',')
  const sizes = (process.env.PMC_SHOT_SIZES ?? '1480x920,3440x1440,900x700').split(',').map((s) => s.split('x').map(Number))
  const themes = (process.env.PMC_SHOT_THEMES ?? 'dark').split(',')
  win!.setPosition(0, 0)
  win!.showInactive()
  await new Promise((r) => setTimeout(r, 2500))
  // The capture profile keeps its own assistant conversation between runs: one question typed by an earlier run through
  // PowerShell came out as «Â¿por quÃ© va lento el PC?» in every later Asistente capture (13-11). Each run starts it empty.
  await win!.webContents.executeJavaScript("try { localStorage.removeItem('pmc.assistant') } catch {} location.reload()").catch(() => undefined)
  await new Promise((r) => setTimeout(r, 2500))
  const original = service.settings.theme
  const originalLook = service.settings.look
  const looks = (process.env.PMC_SHOT_LOOKS ?? '').split(',').filter(Boolean)
  // EV131: PMC_SHOT_LAYOUTS=lateral,columna… captures each shape of the app (pictures named «…-Llateral»).
  const originalLayout = service.settings.layout
  const layouts = (process.env.PMC_SHOT_LAYOUTS ?? '').split(',').filter(Boolean)
  for (const layout of layouts.length ? layouts : [undefined]) {
  if (layout) { service.setSettings({ layout: layout as any }); service.push(); await new Promise((r) => setTimeout(r, 1800)) }
  const tag = layout ? `-L${layout}` : ''
  for (const look of looks.length ? looks : [undefined]) {
  if (look) { service.setSettings({ look: look as any }); service.push(); await new Promise((r) => setTimeout(r, 1500)) }
  for (const theme of themes) {
    service.setSettings({ theme: theme as any })
    applyTheme()
    for (const [w, h] of sizes) {
      win!.setContentSize(w, h)
      for (const route of routes) {
        await win!.webContents.executeJavaScript(`window.location.hash = '#/${route}'`)
        await new Promise((r) => setTimeout(r, Number(process.env.PMC_SHOT_WAIT ?? 1600)))
        const img = await win!.webContents.capturePage()
        writeFileSync(join(dir, `${route}-${w}x${h}-${theme}${look ? '-' + look : ''}${tag}.png`), img.toPNG())
        // Layout check: anything that sticks out of the window horizontally (outside scroll containers made for it).
        const report = await win!.webContents.executeJavaScript(`(() => {
          const W = window.innerWidth, out = []
          for (const el of document.querySelectorAll('main *')) {
            const r = el.getBoundingClientRect()
            if (r.width === 0 || r.right <= W + 1) continue
            let p = el.parentElement, scrolled = false
            while (p && p.tagName !== 'MAIN') { const o = getComputedStyle(p).overflowX; if (o === 'auto' || o === 'scroll' || o === 'hidden') { scrolled = true; break } p = p.parentElement }
            if (!scrolled) out.push((el.className && el.className.baseVal === undefined ? el.className : el.tagName).toString().slice(0, 80) + ' w=' + Math.round(r.width) + ' right=' + Math.round(r.right))
          }
          return { W, overflow: out.slice(0, 12) }
        })()`)
        writeFileSync(join(dir, `${route}-${w}x${h}-${theme}${look ? '-' + look : ''}${tag}.json`), JSON.stringify(report, null, 1))
      }
    }
  }
  }
  }
  if (looks.length) service.setSettings({ look: originalLook })
  if (layouts.length) service.setSettings({ layout: originalLayout })
  const steps: { name: string; route: string; js: string; wait?: number }[] = process.env.PMC_SHOT_STEPS ? JSON.parse(process.env.PMC_SHOT_STEPS) : []
  for (const st of steps) {
    await win!.webContents.executeJavaScript(`window.location.hash = '#/${st.route}'`)
    await new Promise((r) => setTimeout(r, 1200))
    await win!.webContents.executeJavaScript(st.js)
    await new Promise((r) => setTimeout(r, st.wait ?? 2200))
    const img = await win!.webContents.capturePage()
    writeFileSync(join(dir, `step-${st.name}.png`), img.toPNG())
    await win!.webContents.executeJavaScript('window.__pmc && window.__pmc.reset()')
    await new Promise((r) => setTimeout(r, 500))
  }
  service.setSettings({ theme: original })
  app.quit()
}

// ---- the tray (EV54): every Claude at a glance and the way of working at one click, without opening the window --------
// Only while the app is open: closing the window still quits it, as before (keeping it running would change how the user
// works with it).
let tray: Tray | undefined
let traySig = ''
const TRAY_STATE: Record<string, string> = { trabajando: 'trabajando', esperando: 'te espera', 'sin-uso': 'sin uso', bloqueado: 'bloqueada', disponible: 'libre', desconectado: 'sin abrir' }

function updateTray(): void {
  if (!tray || !service) return
  const mode = modeOf(service.settings)
  const lines = service.agents.filter((a) => a.state !== 'baja' && a.state !== 'apartada').map((a) => {
    const s = a.sessions.find((x) => isSessionWorking(x)) ?? a.sessions.find((x) => x.pid)
    const where = s?.projectId ? service.project(s.projectId)?.name : undefined
    return `${a.state === 'trabajando' ? '●' : '○'} Claude ${a.id.slice(6)}${a.alias ? ` (${a.alias})` : ''} · ${TRAY_STATE[a.state] ?? a.state}${where ? ` · ${where}` : ''}`
  })
  // The relay wheels that are on: whose turn it is, at a glance from the tray (13-11).
  const wheels = Object.entries(service.settings.relayChains ?? {}).filter(([, c]) => c?.on).map(([pid, c]) =>
    `↻ ${service.project(pid)?.name ?? pid}: ${c!.phase === 'espera' ? 'esperando a que alguien recupere su uso' : c!.holder ? `turno de Claude ${c!.holder.slice(6)}` : 'empezando'} (${c!.order.map((id) => id.slice(6)).join('→')})`)
  const working = service.agents.filter((a) => a.state === 'trabajando')
  const sig = JSON.stringify([lines, mode, wheels])
  if (sig === traySig) return
  traySig = sig
  tray.setToolTip(`Mission Control · ${working.length ? `${working.length} trabajando` : 'nadie trabajando'}`)
  const show = () => { if (!win) return; if (win.isMinimized()) win.restore(); win.show(); win.focus() }
  const setMode = (m: WorkMode) => { service.setSettings({ ...settingsFor(m), workModeBy: 'usuario' }); service.push(); traySig = ''; updateTray() }
  tray.setContextMenu(Menu.buildFromTemplate([
    ...lines.map((label) => ({ label, enabled: false })),
    ...(wheels.length ? [{ type: 'separator' as const }, ...wheels.map((label) => ({ label, click: () => { show(); void win?.webContents.executeJavaScript("window.location.hash = '#/relevos'") } }))] : []),
    { type: 'separator' },
    ...WORK_MODES.map((m) => ({ label: m.label, type: 'radio' as const, checked: mode === m.id, click: () => setMode(m.id) })),
    { type: 'separator' },
    {
      label: t('Pedir a todos que paren'), enabled: working.length > 0,
      click: () => { for (const a of working) void api.stopClaude(a.id, 'pedir') }
    },
    { label: t('Abrir Mission Control'), click: show },
    { label: t('Salir'), click: () => app.quit() }
  ]))
}

// ---- installing what this machine lacks (14-11) --------------------------------------------------------------------------
/**
 * Git and Node with one click, with each system's own installer: on a Mac Apple's command line tools (Git comes with
 * them; macOS shows its own dialog) and Homebrew or nodejs.org for Node; on Windows winget, in a window the user sees
 * (Windows asks for permission itself).
 */
async function installTool(tool: 'claude' | 'git' | 'node'): Promise<void> {
  if (tool === 'claude') { api.claudeInstall(); return }
  if (isMac) {
    if (tool === 'git') { execFile('xcode-select', ['--install'], () => undefined); return }
    const brew = ['/opt/homebrew/bin/brew', '/usr/local/bin/brew'].find((b) => existsSync(b))
    if (brew) openTerminalWindow({ title: t('Instalar Node'), cwd: homedir(), argv: [brew, 'install', 'node'] })
    else await shell.openExternal('https://nodejs.org/en/download')
    return
  }
  if (isWin) {
    const id = tool === 'git' ? 'Git.Git' : 'OpenJS.NodeJS.LTS'
    spawn('cmd.exe', ['/d', '/s', '/c', `start "${tool === 'git' ? 'Instalar Git' : 'Instalar Node'}" cmd.exe /k winget install --id ${id} -e --accept-package-agreements --accept-source-agreements`], { detached: true, windowsHide: false, windowsVerbatimArguments: true, stdio: 'ignore' }).unref()
    return
  }
  await shell.openExternal(tool === 'git' ? 'https://git-scm.com/downloads' : 'https://nodejs.org/en/download')
}

/** Once per version of the app (a new install or an update), Git's installer opens by itself when this machine lacks it. */
function offerMissingTools(): void {
  if (process.env.PMC_SHOT_DIR || service.settings.toolsOfferedFor === app.getVersion()) return
  service.setSettings({ toolsOfferedFor: app.getVersion() })
  execFile('git', ['--version'], { windowsHide: true, timeout: 8000 }, (err) => {
    if (!err) return
    service.log('git no está: se abre su instalador')
    void installTool('git').catch(() => undefined)
  })
}

// ---- a new version on GitHub (core/updates.ts) ------------------------------------------------------------------------
let update: UpdateInfo | undefined
let updateToldFor = ''
async function checkUpdate(): Promise<void> {
  if (process.env.PMC_SHOT_DIR) return
  try {
    const r = await fetch(LATEST_URL, { headers: { accept: 'application/vnd.github+json', 'user-agent': 'mission-control-app' }, signal: AbortSignal.timeout(15_000) })
    if (!r.ok) return
    update = updateFrom(await r.json(), app.getVersion(), process.platform, process.arch)
    if (update && updateToldFor !== update.version && Notification.isSupported()) {
      updateToldFor = update.version
      const n = new Notification({ title: t('Hay una versión nueva de Mission Control: {v0}', { v0: update.version }), body: t('Pulsa para descargarla. Se instala encima y no pierdes nada.') })
      n.on('click', () => { void api.openUpdate() })
      n.show()
    }
  } catch { /* offline: next time */ }
}
function startUpdateChecks(): void {
  setTimeout(() => void checkUpdate(), 20_000).unref()
  setInterval(() => void checkUpdate(), 6 * 3600_000).unref()
}

async function setupTray(): Promise<void> {
  if (process.env.PMC_SHOT_DIR || tray) return
  try {
    const img = isMac ? nativeImage.createFromPath(join(here, '../../build/icon.png')).resize({ width: 18, height: 18 }) : await app.getFileIcon(process.execPath, { size: 'small' })
    tray = new Tray(img)
    tray.on('click', () => { if (win) { if (win.isMinimized()) win.restore(); win.show(); win.focus() } })
    updateTray()
    setInterval(updateTray, 10_000).unref()
  } catch { /* no tray on this system */ }
}

// ---- routines (EV44, core/routines.ts): the project's own checks, run by the app, no Claude ------------------------------
const ROUTINE_FILE = () => join(paths.root(), 'routines.json')
let routineMem: RoutineMemory | undefined
let routineRunning: string | undefined

function routineProjects(): RoutineProject[] {
  return service.projects.map((p) => {
    let checks: ProjectCheck[] = []
    try { checks = checksOf(workCopy(p)?.path ?? p.root) ?? [] } catch { /* unreadable pmc.json: none */ }
    return {
      id: p.id,
      // The copy being worked on first: the night routine runs there (the game project: rachas, not the main copy).
      copies: (service.copies.get(p.id) ?? []).filter((c) => !c.error).map((c) => ({ path: c.path, head: c.head, dirty: c.dirty }))
        .sort((a, b) => Number(b.path.toLowerCase() === (workCopy(p)?.path ?? '').toLowerCase()) - Number(a.path.toLowerCase() === (workCopy(p)?.path ?? '').toLowerCase())),
      light: checks.filter((c) => !c.recurso && !c.pesada).length,
      all: checks.length,
      heavy: checks.some((c) => c.recurso || c.pesada),
      working: service.agents.some((a) => a.sessions.some((x) => x.projectId === p.id && isSessionWorking(x)))
    }
  })
}

function routineTick(): void {
  if (routineRunning || process.env.PMC_SHOT_DIR || !service.nodeExe || !existsSync(service.pmcPath)) return
  if (!routineMem) {
    try { routineMem = JSON.parse(readFileSync(ROUTINE_FILE(), 'utf8')) } catch { /* first time */ }
    routineMem = { heads: {}, nights: {}, nightTry: {}, ...(routineMem ?? {}) }
  }
  const mem = routineMem
  const now = Date.now()
  const due = dueRoutines(routineProjects(), service.settings.routines ?? {}, mem, now)
  const save = () => { try { writeFileSync(ROUTINE_FILE(), JSON.stringify(mem)) } catch { /* next tick */ } }
  save() // commits seen for the first time
  const r = due[0]
  const p = r && service.project(r.projectId)
  if (!r || !p) return
  routineRunning = r.projectId
  const label = r.kind === 'noche' ? 'de la noche' : 'tras el último commit'
  const run = nodeArgs(service.nodeExe, [service.pmcPath, 'verifica', ...(r.kind === 'tras-commit' ? ['--ligeras'] : []), '--cuenta', 'rutina'])
  const child = spawn(run.file, run.args, { cwd: r.copy, env: run.env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
  let out = ''
  child.stdout?.on('data', (b) => { out += String(b) })
  child.stderr?.on('data', (b) => { out += String(b) })
  // Cut only after every check had its own time (the game project: up to 45 min to build and 120 to test), plus a margin.
  let budget = 50
  try { const cs = (checksOf(r.copy) ?? []).filter((c) => r.kind === 'noche' || (!c.recurso && !c.pesada)); budget = cs.reduce((s, c) => s + (c.minutos ?? 30), 0) + 10 } catch { /* default */ }
  const kill = setTimeout(() => { try { child.kill() } catch { /* gone */ } }, Math.max(15, budget) * 60_000)
  child.on('close', (code) => {
    clearTimeout(kill)
    routineRunning = undefined
    const last = service.db.prepare('SELECT outcome, summary, at FROM verifications WHERE project_id = ? ORDER BY id DESC LIMIT 1').get(p.id) as { outcome: string; summary: string; at: number } | undefined
    const fresh = last && last.at >= now
    const outcome = code === 2 || !fresh ? 'nada' : (last!.outcome as 'bien' | 'falla' | 'aplazada')
    remember(mem, r, outcome, Date.now())
    save()
    if (outcome === 'nada') return
    const title = outcome === 'falla' ? `Rutina ${label}: fallan las comprobaciones de ${p.name} — ${last!.summary.slice(0, 160)}`
      : outcome === 'aplazada' ? `Rutina ${label} de ${p.name}, aplazada: ${last!.summary.slice(0, 160)}`
      : `Rutina ${label}: ${p.name} pasa sus comprobaciones (${last!.summary.slice(0, 120)})`
    addEvent(service.db, { projectId: p.id, at: Date.now(), kind: outcome === 'falla' ? 'aviso' : 'rutina', title, detail: out.slice(-2000), source: 'Rutina' })
    if (outcome === 'falla' && Notification.isSupported()) new Notification({ title: t('{name}: fallan las comprobaciones', { name: p.name }), body: last!.summary.slice(0, 200) }).show()
    // And on the phone (EV53): the phone view already gets notices by web push.
    if (outcome === 'falla') void remote.push(`${p.name}: fallan las comprobaciones`, last!.summary.slice(0, 160), 'inicio').catch(() => undefined)
    service.push()
  })
}

app.whenReady().then(async () => {
  if (isWin) app.setAppUserModelId('es.pakitron.missioncontrol')
  service = new Service()
  setLang(pickLang(service.settings.lang, app.getLocale()))
  service.on('stop-failure', autoRelay)
  service.on('stop', autoRelay)
  service.on('stop-failure', autoWake)
  wheel = createWheel({
    service, openTerminal, typeText, workCopy, lastOpened,
    reserveBusy,
    staleWindows: () => (api.staleWindows() as { sessionId: string }[]) ?? [],
    reopenWindow: (account, sessionId, prompt) => api.reopenWindow(account, sessionId, prompt) as Promise<unknown>,
    // EV141: a turn as a background session, with the account's folder (envFor clears the marks of a child session). One
    // already there is stopped first: `--resume` on a live one makes a copy (tried 13-11).
    openBackground: async (account, cwd, args) => {
      const acc = service.accounts.find((a) => a.id === account)
      if (!acc) throw new Error(t('Cuenta desconocida'))
      const run = (a: string[]) => new Promise<string>((resolve, reject) => execFile(findClaude(), a, { cwd, env: envFor(acc), windowsHide: true, timeout: 60_000 }, (err, out) => (err ? reject(new Error(String(err.message).split('\n')[0])) : resolve(String(out)))))
      if (args[1] === '--resume') await run(['stop', args[2]]).catch(() => undefined)
      const out = await run(args)
      service.log(`rueda sin ventanas: ${account} · ${out.match(/backgrounded · \S+/)?.[0] ?? out.trim().slice(0, 80)}`)
    },
    stopBackground: (account, shortId) => {
      const acc = service.accounts.find((a) => a.id === account)
      if (!acc || !/^[0-9a-f]{6,12}$/i.test(shortId)) return Promise.reject(new Error(t('Sesión no válida')))
      return new Promise<void>((resolve, reject) => execFile(findClaude(), ['stop', shortId], { env: envFor(acc), windowsHide: true, timeout: 60_000 }, (err) => (err ? reject(new Error(String(err.message).split('\n')[0])) : resolve())))
    },
    closeIdleWindow
  })
  assistant = createAssistant({ service, wheel: () => wheel, call: (method, ...args) => api[method](...args) })
  cleanup = createCleanup({ service })
  // EV100: what is set aside is looked at again every 6 hours (back if named again; to the bin when the user allows it).
  setInterval(() => { void cleanup.watchAside().catch((e) => service.log(`limpieza: ${(e as Error).message}`)) }, 6 * 3600_000).unref()
  recharge = createRecharge({
    service, wheel: () => wheel, readScreen, typeText, typeKey,
    notify: (title, body) => {
      try { if (Notification.isSupported()) new Notification({ title, body }).show() } catch { /* no notifications */ }
      void remote.push(title, body, 'inicio').catch(() => undefined)
    }
  })
  // At a usage limit, its window is read for a reset offer; then whether this is the moment to use it.
  service.on('stop-failure', (e: { account: AccountId; error?: string; sessionId?: string; message?: string }) => {
    if (!/rate_limit/i.test(e.error ?? '') && !/Fable limit/i.test(e.message ?? '')) return
    // EV101: out of Fable is not out of usage: its Fable reset, or the same conversation goes on with Opus.
    const fable = /Fable limit/i.test(e.message ?? '')
    setTimeout(() => { void recharge.look(e.account, e.sessionId).then(async () => { if (fable) await recharge.fableOut(e.account, e.sessionId); else await recharge.tick() }).catch((err) => service.log(`recarga: ${(err as Error).message}`)) }, 8000)
  })
  setInterval(() => { void recharge.tick().catch((err) => service.log(`recarga: ${(err as Error).message}`)) }, 120_000).unref()
  // EV98: when each account's sign-in ends, from `claude auth status` (free); once a minute after starting, then every 6 h.
  // EV64: the user's requests nobody wrote down, per project, for the startup package of whoever works there (cheap to read).
  const writeRequests = () => { try { const list = recentRequests(3).filter((r) => r.projectId && r.status === 'sin-apuntar'); const projects: Record<string, { text: string; at: number; hash: string }[]> = {}; for (const r of list) (projects[r.projectId!] ??= []).length < 5 && projects[r.projectId!].push({ text: r.text.replace(/\s+/g, ' ').slice(0, 160), at: r.at, hash: r.hash }); writeFileSync(join(paths.root(), 'requests.json'), JSON.stringify({ at: Date.now(), projects })) } catch (e) { service.log(`peticiones: ${(e as Error).message}`) } }
  setTimeout(writeRequests, 90_000).unref()
  every(10 * 60_000, 'peticiones', writeRequests)
  setTimeout(() => void checkLogins(), 60_000).unref()
  // EV112: the machine's load every two minutes, in the background.
  setTimeout(readLoad, 20_000).unref()
  setTimeout(refreshBusy, 3_000).unref()
  every(120_000, 'carga', readLoad)
  setInterval(() => void checkLogins(), 6 * 3600_000).unref()
  every(45_000, 'rueda', () => wheel.tick())
  every(20_000, 'ausencia', () => awayTick())
  // EV133: the board's skills figure, counted in the background (on opening, the board reads nothing).
  setTimeout(() => timed((x) => service.log(x), 'skills', tallyAllSkills), 40_000).unref()
  every(30 * 60_000, 'skills', tallyAllSkills)
  // EV142: a new version brings the subagents it wrote up to date in every project, once, a minute after starting.
  setTimeout(() => timed((x) => service.log(x), 'subagentes', refreshAgentsEverywhere), 60_000).unref()
  every(60_000, 'reparto', autoStaff)
  every(60_000, 'turnos', () => turnTick())
  every(60_000, 'rutinas', routineTick)
  backup = createBackup({
    root: () => paths.root(),
    projects: () => service.projects.map((p) => ({ id: p.id, name: p.name, root: p.root })),
    settings: () => service.settings.backup,
    // Before the first reading of what runs, as if busy: a 40 GB first copy must not start under Premiere or a game.
    busy: () => { const b = busyNow_(); return !b || Boolean(b.playing) || b.userApps.length > 0 },
    event: (projectId, ok, title, detail) => { addEvent(service.db, { projectId, at: Date.now(), kind: ok ? 'rutina' : 'aviso', title, detail, source: 'Rutina' }); service.push() },
    warn: (title, body) => {
      try { if (Notification.isSupported()) new Notification({ title, body }).show() } catch { /* no notifications */ }
      void remote.push(title, body, 'inicio').catch(() => undefined)
    },
    log: (line) => service.log(line)
  })
  every(60_000, 'copias', () => backup.tick())
  // EV120: an account believed out of usage is asked every 10 min, with no window, whether it has usage again (the user
  // recharged claude1 by hand on 13-11 and had to open it himself). Free while it is still out.
  probe = createProbe({
    candidates: () => service.agents.map((a) => {
      const st = service.settings.accountStatus?.[a.id]
      const reserve = (service.settings.reserves ?? []).some((r) => r.on && r.account === a.id)
      // EV146: a key, Console or cloud account pays for each request and gives no usage to read: never probed.
      return { id: a.id, out: a.state === 'sin-uso', backAt: a.usage.activeLimit?.resetsAt, skip: st === 'baja' || (st === 'pausada' && !reserve) || !a.identity.hasLogin || Boolean(a.identity.plan?.paysPerUse), login: logins[a.id]?.loggedIn }
    }),
    env: (id) => { const acc = service.accounts.find((x) => x.id === id); return acc ? envFor(acc) : process.env },
    claude: findClaude,
    back: (id, r) => {
      service.setSettings({ recharged: { ...(service.settings.recharged ?? {}), [id]: Date.now() } })
      addEvent(service.db, { at: Date.now(), account: id, kind: 'recarga', title: t('Claude {v0} vuelve a tener uso (recargada o restablecida; lo ha visto la app sin abrir ventana): {v1}', { v0: id.slice(6), v1: probeWords(r) }), source: 'Mission Control' })
      void service.refreshAgents()
      service.push()
    },
    // Still out but back sooner than the app believed: the later limits it knew (older than the reading) are dropped,
    // the reading's own window at 100 % stays, so Inicio, Relevos and the wheel's «first back» use the real time.
    sooner: (id, r, at) => {
      service.setSettings({ recharged: { ...(service.settings.recharged ?? {}), [id]: at - 1 } })
      const when = r.resetsAt ? new Date(r.resetsAt).toLocaleString('es-ES', { weekday: 'short', hour: '2-digit', minute: '2-digit' }) : '?'
      addEvent(service.db, { at: Date.now(), account: id, kind: 'recarga', title: t('Claude {v0} vuelve antes de lo que se creía: el {when} (lo ha dicho Claude Code; {v1})', { v0: id.slice(6), when: when, v1: probeWords(r) }), source: 'Mission Control' })
      void service.refreshAgents()
      service.push()
    },
    log: (line) => service.log(line)
  })
  every(60_000, 'sonda', () => probe.tick())
  // EV103: every project folder trusted in every account, so no window stops at «Is this a project you trust?».
  setTimeout(trustSweep, 5_000).unref()
  every(600_000, 'confianza', trustSweep)
  // EV52: hooks put by the app itself where an account in use lacks them.
  setTimeout(hooksSweep, 30_000).unref()
  every(600_000, 'ganchos', hooksSweep)
  // EV79: a question nobody answered in time takes its default option, so the Claude that asked is never left waiting.
  setInterval(() => { try { if (expireDecisions(service.db, service.projects).length) service.push() } catch (e) { service.log(`decisiones vencidas: ${(e as Error).message}`) } }, 60_000).unref()
  void setupTray()
  startUpdateChecks()
  setTimeout(offerMissingTools, 30_000).unref()
  setTimeout(() => void autoSkillSearch(), 5 * 60_000).unref()
  setInterval(() => void autoSkillSearch(), 3600_000).unref()
  registerProtocol()
  ipcMain.handle('pmc', async (_e, method: string, ...args: any[]) => {
    const fn = api[method]
    if (!fn) throw new Error(t('Método desconocido: {method}', { method: method }))
    // The slow reads that change slowly are kept a while (13-11 log: requests ~150 ms, health ~140, away ~130 on every
    // Inicio open, almost half a second with the app stalled); a call that changes what they show clears them at once.
    for (const [m, r] of Object.entries(SLOW_READS)) if (m !== method && r.clearedBy.test(method)) for (const k of readCache.keys()) if (k.startsWith(m + ':')) readCache.delete(k)
    const slow = SLOW_READS[method]
    const ck = slow ? `${method}:${JSON.stringify(args)}` : ''
    if (slow) { const c = readCache.get(ck); if (c && Date.now() - c.at < slow.ms) return c.value }
    // What the screen asks that holds the whole app (13-11, the user: «cada vez que entro a inicio pete un poco»): the
    // synchronous part of a call blocks every window, so the slow ones are written down to be fixed.
    const t0 = performance.now()
    const out = fn(...args)
    const ms = performance.now() - t0
    if (ms > 80) service.log(`lento: ${method} ${Math.round(ms)} ms`)
    const value = await out
    // Not kept while the accounts are still being read at start: what it says then (no usage, nobody working) is wrong.
    if (slow && service.agents.length) readCache.set(ck, { at: Date.now(), value })
    return value
  })
  service.on('state', () => {
    for (const w of BrowserWindow.getAllWindows()) w.webContents.send('pmc:state')
    remote.emit('state')
    ringIfMore()
  })
  service.on('assets', (projectId: string) => { win?.webContents.send('pmc:assets', projectId); remote.emit('assets', projectId) })
  createWindow()
  applyTheme()
  nativeTheme.on('updated', () => applyTheme())
  const cli = app.isPackaged ? join(process.resourcesPath, 'pmc', 'pmc.mjs') : join(here, '../cli/pmc.mjs')
  await service.start(cli)
  if (process.env.PMC_SHOT_DIR) void screenshots(process.env.PMC_SHOT_DIR)
  else {
    remote.start()
    void remote.status()
    every(10_000, 'chats', watchChats)
  }
})

app.on('second-instance', () => {
  if (win) {
    if (win.isMinimized()) win.restore()
    win.focus()
  }
})

app.on('browser-window-focus', () => void service?.refreshAgents())

app.on('window-all-closed', () => {
  service?.stop()
  app.quit()
})
