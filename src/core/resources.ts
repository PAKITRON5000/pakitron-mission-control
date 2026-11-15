import { PROCESS_LIST, asTasklist } from './platform'
import { t, tn, locale, getLang } from './i18n'
// Things only one job can use at a time, whatever the project: the Unity editor of a copy, the graphics card (16 GB,
// shared by every project), a player build (11-11: one was killed for memory). Until now this was a hand-written line in
// RELEVO.md («el usuario tiene Premiere abierto: nada pesado»). Two halves:
//   - what can be seen without asking anyone: the programs running and the card's memory (`detectBusy`);
//   - a turn an agent takes before a heavy job (`pmc recurso gpu "vídeo del menú"`), kept like a task reservation: it
//     expires in two hours and is renewed at every end of turn of that account, so a dead session frees it by itself.
import { execFileSync } from 'node:child_process'
import type { AccountId } from './types'
import type { DB } from './db'
import { claimTask, listClaims, releaseTask, type Claim } from './coord'
import { thisPc } from './thispc'

/** Reservations of resources live with the task ones, under a project that is none: they hold across projects. */
export const SHARED = '*'
const KEY = 'recurso:'

/** Games anyone may be playing (the program's name in the Task Manager). The user's own, in este-pc.json › juegos. */
export const COMMON_GAMES = ['VALORANT-Win64-Shipping.exe', 'FortniteClient-Win64-Shipping.exe', 'cs2.exe', 'League of Legends.exe', 'r5apex.exe', 'Overwatch.exe', 'RocketLeague.exe', 'GTA5.exe', 'eldenring.exe', 'rpcs3.exe']

/** EV129: the common ones and the user's own (a game he makes and plays), read from este-pc.json and not from the code. */
export function games(): string[] {
  return [...COMMON_GAMES, ...(thisPc().juegos ?? []).filter((g) => typeof g === 'string' && g.trim())]
}
/** Programs of the user's that need the machine: while one is open, nothing heavy is started. */
const USER_HEAVY: [string, string][] = [['adobe premiere pro.exe', 'Premiere'], ['afterfx.exe', 'After Effects'], ['resolve.exe', 'DaVinci Resolve']]

export interface Busy {
  playing?: string
  userApps: string[]
  unityEditors: number
  blender: number
  gpu?: { usedMb: number; totalMb: number }
}

export type Run = (cmd: string, args: string[]) => string

const run: Run = (cmd, args) => execFileSync(cmd, args, { encoding: 'utf8', windowsHide: true, timeout: 5000, maxBuffer: 8 << 20, stdio: ['ignore', 'pipe', 'ignore'] })

/** What is running now. Anything that cannot be read is left out: never a guess. */
export function detectBusy(exec: Run = run): Busy {
  const busy: Busy = { userApps: [], unityEditors: 0, blender: 0 }
  try {
    const names = asTasklist(exec(...PROCESS_LIST)).split(/\r?\n/).map((l) => l.match(/^"([^"]+)"/)?.[1]?.toLowerCase()).filter(Boolean) as string[]
    busy.playing = games().find((g) => names.includes(g.toLowerCase()))
    busy.userApps = USER_HEAVY.filter(([exe]) => names.includes(exe)).map(([, label]) => label)
    busy.unityEditors = names.filter((n) => n === 'unity.exe').length
    busy.blender = names.filter((n) => n === 'blender.exe').length
  } catch { /* not Windows, or no tasklist */ }
  try {
    const m = exec('nvidia-smi', ['--query-gpu=memory.used,memory.total', '--format=csv,noheader,nounits']).trim().split(/\r?\n/)[0]?.split(',').map((x) => Number(x.trim()))
    if (m && m.length === 2 && m.every((n) => Number.isFinite(n) && n >= 0) && m[1] > 0) busy.gpu = { usedMb: m[0], totalMb: m[1] }
  } catch { /* no NVIDIA card */ }
  return busy
}

/**
 * EV112 (the user, 13-11 12:40: «mira qué está activo y por qué peta tanto el pc ahora mismo»): the machine's load now
 * and the processes that make it, each with the Claude whose window started it (walking up to its launcher in
 * claude-accesos; «claude» when it is a window the user opened by hand).
 */
export interface Load {
  cpuPct: number
  freeMb: number
  totalMb: number
  cores: number
  procs: { name: string; pid: number; cpuPct: number; ramMb: number; account?: string; cmd: string }[]
}

const LOAD_PS = String.raw`$n=[Environment]::ProcessorCount; $procs=@{}; Get-CimInstance Win32_Process | ForEach-Object { $procs[[int]$_.ProcessId]=$_ }
$os=Get-CimInstance Win32_OperatingSystem; $cpu=(Get-CimInstance Win32_PerfFormattedData_PerfOS_Processor -Filter "Name='_Total'").PercentProcessorTime
$rows=Get-CimInstance Win32_PerfFormattedData_PerfProc_Process | Where-Object { $_.IDProcess -gt 4 -and (($_.PercentProcessorTime/$n) -ge 3 -or $_.WorkingSetPrivate -ge 1GB) } | ForEach-Object {
 $id=[int]$_.IDProcess; $p=$procs[$id]; if (-not $p) { return }; $acc=$null; $cur=$procs[[int]$p.ParentProcessId]; $hops=0
 while ($cur -and $hops -lt 12) { if ([string]$cur.CommandLine -match 'claude-accesos\\(claude\d)\.cmd') { $acc=$matches[1]; break }; if ($cur.Name -eq 'claude.exe' -and -not $acc) { $acc='claude' }; $cur=$procs[[int]$cur.ParentProcessId]; $hops++ }
 $c=[string]$p.CommandLine; [pscustomobject]@{ name=$p.Name; pid=$id; cpuPct=[math]::Round($_.PercentProcessorTime/$n,1); ramMb=[math]::Round($_.WorkingSetPrivate/1MB); account=$acc; cmd=$c.Substring(0,[Math]::Min(160,$c.Length)) } }
@{ cpuPct=[int]$cpu; freeMb=[math]::Round($os.FreePhysicalMemory/1KB); totalMb=[math]::Round($os.TotalVisibleMemorySize/1KB); cores=$n; procs=@($rows) } | ConvertTo-Json -Compress -Depth 3`

const runLong: Run = (cmd, args) => execFileSync(cmd, args, { encoding: 'utf8', windowsHide: true, timeout: 20_000, maxBuffer: 8 << 20, stdio: ['ignore', 'pipe', 'ignore'] })

/** The command that reads the load (the app runs it without waiting; `pmc recursos`, waiting). */
export const LOAD_ARGS = ['-NoProfile', '-NonInteractive', '-Command', LOAD_PS]

export function parseLoad(text: string): Load | undefined {
  try {
    const j = JSON.parse(text.trim()) as Load
    if (!Number.isFinite(j.cpuPct) || !Array.isArray(j.procs)) return undefined
    j.procs = j.procs.filter((p) => p && p.name).sort((a, b) => b.cpuPct - a.cpuPct || b.ramMb - a.ramMb)
    return j
  } catch { return undefined }
}

/** The load now (two to four seconds: it asks Windows for every process), or undefined where it cannot be read. */
export function machineLoad(exec: Run = runLong): Load | undefined {
  try { return parseLoad(exec('powershell.exe', LOAD_ARGS)) } catch { return undefined }
}

/** Loaded enough to say so: the processor busy or little memory left. */
export const isLoaded = (l: Load): boolean => l.cpuPct >= 75 || l.freeMb / l.totalMb < 0.15

/** What a process is doing, in words, from its name and command line. */
export function doingOf(p: { name: string; cmd: string }): string {
  const n = p.name.toLowerCase()
  if (n.startsWith('ffmpeg')) return t('convirtiendo o exportando vídeo')
  if (n.includes('media encoder')) return t('exportando vídeo (Media Encoder)')
  if (n.startsWith('python')) { const s = p.cmd.match(/([\w-]+\.py)/)?.[1]; return s ? t('ejecutando {script}', { script: s }) : t('un programa de Python') }
  if (n.startsWith('node')) return t('un proceso de Node')
  if (n === 'unity.exe') return 'Unity'
  if (n === 'blender.exe') return 'Blender'
  if (n === 'claude.exe') return t('una ventana de Claude')
  return p.name.replace(/\.exe$/i, '')
}

/** One line: how loaded the machine is and who makes it so («Claude 5: ffmpeg, convirtiendo vídeo, 4 de 32 núcleos»). */
export function loadText(l: Load): string {
  const usedGb = (l.totalMb - l.freeMb) / 1024
  const head = t('Procesador al {cpu} %, memoria {used} de {total} GB', { cpu: l.cpuPct, used: dec(usedGb.toFixed(1)), total: (l.totalMb / 1024).toFixed(0) })
  const top = l.procs.slice(0, 5).map((p) => {
    const who = p.account === 'claude' ? t('un Claude') : p.account ? `Claude ${p.account.slice(6)}` : t('el PC')
    const cores = (p.cpuPct / 100) * l.cores
    const c = cores >= 10 ? Math.round(cores) : Math.round(cores * 10) / 10
    const cpu = cores >= 0.5 ? t('{c} de {n} núcleos', { c: c % 1 === 0 ? c : dec(String(c)), n: l.cores }) : ''
    const ram = p.ramMb >= 1024 ? `${dec((p.ramMb / 1024).toFixed(1))} GB` : ''
    const name = p.name.replace(/\.exe$/i, ''), doing = doingOf(p)
    const parts = [doing === name ? '' : doing, cpu, ram].filter(Boolean)
    return `${who}: ${name}${parts.length ? ` (${parts.join(', ')})` : ''}`
  })
  return top.length ? t('{head}. Lo que más gasta: {v0}.', { head: head, v0: top.join('; ') }) : `${head}.`
}

/** A number's decimal sign in the app's language («1,5» / «1.5»). */
const dec = (s: string) => (getLang() === 'en' ? s : s.replace('.', ','))

const clean = (name: string) => name.trim().toLowerCase().replace(/[^a-z0-9ñ._-]+/g, '-').replace(/^-|-$/g, '')

export function holdResource(db: DB, name: string, account: AccountId, note?: string, now = Date.now()): { ok: true; until: number } | { ok: false; holder: Claim } {
  const r = claimTask(db, SHARED, KEY + clean(name), account, { note, now })
  return r.ok ? { ok: true, until: r.claim.expiresAt } : { ok: false, holder: r.holder }
}

export function freeResource(db: DB, name: string, account: AccountId, now = Date.now()): boolean {
  return releaseTask(db, SHARED, KEY + clean(name), account, undefined, now)
}

export function heldResources(db: DB, now = Date.now()): { name: string; account: AccountId; until: number; note?: string }[] {
  return listClaims(db, SHARED, now).filter((c) => !c.abandoned && c.taskKey.startsWith(KEY)).map((c) => ({ name: c.taskKey.slice(KEY.length), account: c.account, until: c.expiresAt, note: c.note }))
}

/**
 * EV180 (claude3, 14-11 21:10, in the game project: `pmc relevo claude1` passed the tasks on but not Unity's turn, held by
 * claude1 until 21:45 while it was out of usage and no Unity was open: the build had to wait for nobody). What the account
 * being taken over holds goes to the one taking over, who carries on its work; it frees them if it does not need them.
 * Returns their names.
 */
export function handOverResources(db: DB, from: AccountId, to: AccountId, now = Date.now()): string[] {
  const out: string[] = []
  for (const r of heldResources(db, now).filter((x) => x.account === from)) {
    freeResource(db, r.name, from, now)
    const h = holdResource(db, r.name, to, r.note ? t('{note} (relevo de {from})', { note: r.note, from }) : t('relevo de {from}', { from }), now)
    if (h.ok) out.push(r.name)
  }
  return out
}

const gb = (mb: number) => dec((mb / 1024).toFixed(1))
const hhmm = (ms: number) => new Date(ms).toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' })

/** Above this the card has no room for a second heavy job (a video model or a player build next to an open editor). */
const GPU_BUSY = 0.6

/**
 * EV149 (the user in Decidir #150, 14-11 01:03: «usar toda la potencia del pc, priorizar the game project»): with «toda la
 * potencia» on (settings `ui.fullPower`), an editor he has open (Premiere…) no longer holds heavy work back. Playing does.
 */
export function fullPowerOn(db: DB): boolean {
  try { return Boolean(JSON.parse((db.prepare("SELECT value FROM settings WHERE key = 'ui'").get() as { value?: string } | undefined)?.value ?? '{}').fullPower) } catch { return false }
}

/** One paragraph for an agent: what it must not start now, and what is held by whom. Empty when everything is free. */
export function resourcesText(db: DB, account: AccountId, busy: Busy, now = Date.now()): string {
  const stop: string[] = []
  const full = fullPowerOn(db)
  if (busy.playing) stop.push(t('el usuario está jugando ({game})', { game: busy.playing }))
  if (busy.userApps.length && !full) stop.push(t('el usuario tiene abierto {apps}', { apps: busy.userApps.join(t(' y ')) }))
  const parts: string[] = []
  if (busy.userApps.length && full) parts.push(t('TODA LA POTENCIA: el usuario lo ha pedido; {apps} abierto no frena lo pesado (mira igualmente pmc recursos y reserva con pmc recurso).', { apps: busy.userApps.join(t(' y ')) }))
  if (stop.length) parts.push(t('NADA PESADO AHORA (ni Unity, ni Blender, ni ejecutable, ni generación con la gráfica): {why}. Trabaja en lo que no lo necesite y apunta en el relevo lo que queda por lanzar.', { why: stop.join('; ') }))
  const seen: string[] = []
  if (busy.unityEditors) seen.push(t('{editors} (las órdenes por línea de órdenes necesitan cerrado el de su copia)', { editors: tn(busy.unityEditors, 'un editor de Unity abierto', '{n} editores de Unity abiertos') }))
  if (busy.blender) seen.push(t('Blender en marcha ({what})', { what: busy.blender }))
  if (busy.gpu) seen.push(t('gráfica: {used} de {total} GB en uso{full}', { used: gb(busy.gpu.usedMb), total: gb(busy.gpu.totalMb), full: busy.gpu.usedMb / busy.gpu.totalMb >= GPU_BUSY ? t(', sin sitio para otro trabajo pesado') : '' }))
  if (seen.length) parts.push(t('Se ve ahora: {list}.', { list: seen.join('; ') }))
  const held = heldResources(db, now)
  if (held.length) parts.push(t('Con turno cogido: {list}.', { list: held.map((h) => t('{name} ({who}{note}, hasta las {time})', { name: h.name, who: h.account === account ? t('tú') : h.account, note: h.note ? `: ${h.note}` : '', time: hhmm(h.until) })).join('; ') }))
  if (!parts.length) return ''
  return parts.join(' ')
}
