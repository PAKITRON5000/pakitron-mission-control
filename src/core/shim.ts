// `pmc` as a short command in any window (EV35). Every session, subagent and notice used to spell out
// `node "C:/Users/…/PakitronMC/bin/pmc.mjs"`: long, easy to mistype, and repeated in every message. The app now leaves
// two tiny launchers in the user's own command folder (`~/.local/bin`, where Claude Code keeps `claude.exe`, already on
// the PATH): `pmc.cmd` for PowerShell and cmd, `pmc` for bash. The same pattern npm uses for its commands. Nothing else
// is touched: no PATH change, no registry. If that folder is not on the PATH, everything goes on with the long form.
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { paths } from './paths'

export const shimDir = (): string => join(homedir(), '.local', 'bin')

/**
 * EV126: on a PC without Node.js (Claude Code's own installer does not bring it) pmc runs on the app's own program:
 * `bin\node.cmd` sets ELECTRON_RUN_AS_NODE and passes everything on (the input and the exit code too, tried from bash
 * and from cmd on 13-11). The app leaves it only when it finds no Node.js; from then on hooks, status lines and
 * launchers name it instead of `node`.
 */
// macOS and Linux: a shell script `bin/node` instead of `bin\node.cmd`, and only the `pmc` launcher (no `pmc.cmd`).
const posix = process.platform !== 'win32'

export const nodeShimPath = (): string => join(paths.binDir(), posix ? 'node' : 'node.cmd')

export function nodeShimText(appExe: string): string {
  if (posix) return ['#!/bin/sh', `ELECTRON_RUN_AS_NODE=1 exec '${appExe.replace(/'/g, `'\\''`)}' "$@"`, ''].join('\n')
  return ['@echo off', 'setlocal', 'set ELECTRON_RUN_AS_NODE=1', `"${appExe}" %*`, ''].join('\r\n')
}

/** Writes bin\node.cmd for the app's program when missing or different; returns its path. */
export function installNodeShim(appExe: string, file = nodeShimPath()): string {
  const text = nodeShimText(appExe)
  let cur: string | undefined
  try { cur = readFileSync(file, 'utf8') } catch { /* none */ }
  if (cur !== text) {
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, text, { mode: 0o755 })
  }
  if (posix) chmodSync(file, 0o755)
  return file
}

/** What runs pmc.mjs: `node`, or bin\node.cmd once the app left it there (a PC without Node.js). */
export function nodeRunner(): string {
  const shim = nodeShimPath()
  return existsSync(shim) ? shim : 'node'
}

export function shimTexts(pmcMjs: string, runner = nodeRunner()): { cmd: string; sh: string } {
  const fwd = pmcMjs.split('\\').join('/')
  const win = pmcMjs.split('/').join('\\')
  const bare = runner === 'node'
  return {
    cmd: ['@echo off', bare ? `node "${win}" %*` : `"${runner.split('/').join('\\')}" "${win}" %*`, ''].join('\r\n'),
    sh: ['#!/bin/sh', bare ? `exec node "${fwd}" "$@"` : `exec "${runner.split('\\').join('/')}" "${fwd}" "$@"`, ''].join('\n')
  }
}

/** Writes the two launchers when missing or different. Returns what it wrote (empty when already in place). */
export function installShims(pmcMjs: string, dir = shimDir()): string[] {
  const t = shimTexts(pmcMjs)
  const made: string[] = []
  mkdirSync(dir, { recursive: true })
  for (const [name, text] of (posix ? [['pmc', t.sh]] : [['pmc.cmd', t.cmd], ['pmc', t.sh]]) as [string, string][]) {
    const f = join(dir, name)
    let cur: string | undefined
    try { cur = readFileSync(f, 'utf8') } catch { /* none */ }
    if (cur === text) continue
    // Someone else's `pmc` is never replaced: only one that runs this pmc.mjs (an older path, a different form).
    if (cur !== undefined && !cur.includes('pmc.mjs')) continue
    writeFileSync(f, text, { mode: 0o755 })
    if (posix) chmodSync(f, 0o755)
    made.push(name)
  }
  return made
}

const norm = (p: string) => p.replace(/\\/g, '/').replace(/^\/([a-z])\//i, '$1:/').replace(/\/+$/, '').toLowerCase()

/** True when `pmc` works as a bare word here: both launchers run this pmc.mjs and their folder is on the PATH. */
export function shimReady(pmcMjs: string, dir = shimDir(), envPath = process.env.PATH ?? process.env.Path ?? ''): boolean {
  const t = shimTexts(pmcMjs)
  try {
    if ((!posix && readFileSync(join(dir, 'pmc.cmd'), 'utf8') !== t.cmd) || readFileSync(join(dir, 'pmc'), 'utf8') !== t.sh) return false
  } catch { return false }
  // Node always sees a Windows PATH (Git Bash converts it for native programs): folders separated by «;».
  const want = norm(dir)
  return existsSync(dir) && envPath.split(posix ? ':' : ';').some((p) => p.trim() && norm(p.trim()) === want)
}
