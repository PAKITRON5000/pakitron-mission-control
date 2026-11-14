import { t } from './i18n'
// EV141 (Decidir #148 «A», the user, 13-11): the relay wheel with Claude Code's background sessions instead of windows,
// as an option. What was tried (docs/research/otros-orquestadores.md › «Prueba real»): `claude --bg --name …` starts one
// with the account's subscription; `claude agents --json` says how each is; a new instruction is given by stopping it and
// `claude --bg --resume <sessionId> "…"` with no other options (any option starts a copy instead); at the usage limit it
// shows `state: "blocked"`. Pure: the window and the CLI can use it.

export interface BgSession { id: string; sessionId: string; name?: string; cwd: string; pid?: number; status?: string; state?: string; startedAt?: number }

/** The background sessions in `claude agents --json` (the interactive ones are left out). */
export function parseAgents(json: string): BgSession[] {
  let rows: any[] = []
  try { rows = JSON.parse(json) } catch { return [] }
  if (!Array.isArray(rows)) return []
  return rows.filter((r) => r?.kind === 'background' && r.id && r.sessionId).map((r) => ({ id: String(r.id), sessionId: String(r.sessionId), name: r.name ?? undefined, cwd: String(r.cwd ?? ''), pid: typeof r.pid === 'number' ? r.pid : undefined, status: r.status ?? undefined, state: r.state ?? undefined, startedAt: typeof r.startedAt === 'number' ? r.startedAt : undefined }))
}

export type BgState = 'trabajando' | 'terminada' | 'espera' | 'sin-uso' | 'parada'

/**
 * In the app's words: working, done with its turn, waiting for a message, out of usage, or stopped (no process).
 * `blocked` is not only the usage limit (EV141 real test, 14-11: a session with usage that ended its turn asking a
 * question was «blocked» too): it is «sin uso» only when the account is out of usage.
 */
export function bgStateOf(s: BgSession, outOfUsage = false): BgState {
  if (s.state === 'blocked') return outOfUsage ? 'sin-uso' : 'espera'
  if (!s.pid) return 'parada'
  if (s.state === 'working' || s.status === 'busy') return 'trabajando'
  return 'terminada'
}

/**
 * What a background session of the wheel is opened with: before its first edit Claude Code moves a background session to
 * a worktree of its own (`.claude/worktrees/`), unless it already is in one. The wheel already picks the folder (the
 * project's work copy) and the next account carries on in the same files, so it stays where it was opened, as a window.
 */
export const BG_SETTINGS = JSON.stringify({ worktree: { bgIsolation: 'none' } })

/** Arguments to open a turn in the background: its name says project and task, so Chats and `claude agents` tell them apart. */
export function bgStartArgs(o: { name: string; prompt: string; model?: string; extra?: string[]; isolate?: boolean }): string[] {
  return ['--bg', '--name', o.name.slice(0, 80), ...(o.model ? ['--model', o.model] : []), ...(o.isolate ? [] : ['--settings', BG_SETTINGS]), ...(o.extra ?? []), o.prompt]
}

/** Arguments to give a stopped session a new instruction on the same conversation (no other option, or it makes a copy). */
export function bgResumeArgs(sessionId: string, prompt: string): string[] {
  if (!/^[0-9a-f-]{8,}$/i.test(sessionId)) throw new Error(t('Id de sesión raro'))
  return ['--bg', '--resume', sessionId, prompt]
}
