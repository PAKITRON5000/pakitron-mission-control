// What belongs to this PC only and has no place in the code (EV129: the public version carries nothing of one user): the
// user's own games, which the app must not slow down, and the folders where a project's own hook leaves its limit
// records. Kept in %LOCALAPPDATA%\PakitronMC\este-pc.json, never in the repository. Folders may say %LOCALAPPDATA% and
// the like: they are expanded here.
import { readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { paths } from './paths'

export interface ThisPc {
  /** Programs that mean «the user is playing», besides the common ones (resources.ts › COMMON_GAMES). */
  juegos?: string[]
  /** Folders where a project's own hook writes credits_<account>.txt and wake.log when an account hits its limit. */
  carpetasDeLimites?: string[]
}

export const thisPcFile = (): string => join(paths.root(), 'este-pc.json')

let cache: { file: string; mtime: number; size: number; v: ThisPc } | undefined

export function thisPc(): ThisPc {
  const file = thisPcFile()
  try {
    const st = statSync(file)
    if (cache && cache.file === file && cache.mtime === st.mtimeMs && cache.size === st.size) return cache.v
    const v = JSON.parse(readFileSync(file, 'utf8').replace(/^﻿/, '')) as ThisPc
    cache = { file, mtime: st.mtimeMs, size: st.size, v }
    return v
  } catch {
    return {}
  }
}

/** «%LOCALAPPDATA%\Avisos» → the real folder. */
export function expandVars(p: string, env: NodeJS.ProcessEnv = process.env): string {
  return p.replace(/%([A-Za-z0-9_]+)%/g, (all, name: string) => env[name] ?? env[name.toUpperCase()] ?? all)
}

export function limitDirs(): string[] {
  return (thisPc().carpetasDeLimites ?? []).filter((d) => typeof d === 'string' && d.trim()).map((d) => expandVars(d.trim()))
}
