// Reads the heartbeats ("Último latido", "Latido anterior", "## Latido: ...") and the "En curso" line from RELEVO.md.
import type { AccountId, Heartbeat } from '../types'
import { stripMd } from './tasks'

const DATE_RE = /(\d{4})-(\d{2})-(\d{2})\s+(\d{1,2}):(\d{2})/

export function localTime(y: number, mo: number, d: number, h: number, mi: number, s = 0): number {
  return new Date(y, mo - 1, d, h, mi, s).getTime()
}

export interface RelevoInfo {
  heartbeats: Heartbeat[]
  enCurso?: string
}

export function parseRelevo(markdown: string, file: string): RelevoInfo {
  const heartbeats: Heartbeat[] = []
  let enCurso: string | undefined
  for (const raw of markdown.split(/\r?\n/)) {
    if (!enCurso) {
      const ec = raw.match(/^\*\*En curso[^*]*\*\*:?\s*(.+)$/i)
      if (ec) enCurso = stripMd(ec[1]).slice(0, 400)
    }
    if (!/latido/i.test(raw)) continue
    const d = raw.match(DATE_RE)
    if (!d) continue
    const at = localTime(+d[1], +d[2], +d[3], +d[4], +d[5])
    const after = raw.slice((d.index ?? 0) + d[0].length)
    const before = raw.slice(0, d.index ?? 0)
    const acc = (after.match(/claude(\d{1,2})/i) ?? before.match(/claude(\d{1,2})/i))
    let text = stripMd(after.replace(/^\s*[·:)]*\s*/, ''))
    text = text.replace(/^\(?claude\d{1,2}[^·:]*[·:)]\s*/i, '').replace(/^[·:\s]+/, '')
    heartbeats.push({ at, account: acc ? (`claude${acc[1]}` as AccountId) : undefined, text: text.slice(0, 600), file })
  }
  // Same moment written twice (summary line and section heading): keep the longer text.
  const byKey = new Map<string, Heartbeat>()
  for (const h of heartbeats) {
    const k = `${h.at}|${h.account ?? ''}`
    const prev = byKey.get(k)
    if (!prev || h.text.length > prev.text.length) byKey.set(k, h)
  }
  return { heartbeats: [...byKey.values()].sort((a, b) => b.at - a.at), enCurso }
}
