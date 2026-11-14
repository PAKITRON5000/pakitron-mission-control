// Each account's plan as a rank on the battlefield (EV84; the user, 13-11: «habrá gente que tenga más o planes superiores, guerreros mejorados»).
// `claude auth status` says it without touching the credentials ("subscriptionType": "pro", "planTier": "pro"); it is
// slow (a second or two per account), so it is asked once in a while and kept in ranks.json.
import { execFile } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { AccountConfig } from './types'
import { paths } from './paths'
import { envFor, findClaude } from './sessions'

/** The rank on the battlefield: Pro a soldier, Max 5x (and team plans) a knight, Max 20x a champion. */
export type PlanRank = 'pro' | 'max5' | 'max20'

export const RANK_LABEL: Record<PlanRank, string> = { pro: 'Soldado', max5: 'Caballero', max20: 'Campeón' }

/** From what `claude auth status` prints to a rank; undefined when it says nothing about a plan. */
export function rankOf(status: { subscriptionType?: string; planTier?: string } | undefined): PlanRank | undefined {
  const text = `${status?.planTier ?? ''} ${status?.subscriptionType ?? ''}`.toLowerCase()
  if (!text.trim()) return undefined
  // EV146: Ultra is above Max 20x (it was taken for Pro).
  if (/ultra|20\s*x|max_?20|20x/.test(text)) return 'max20'
  if (/max|5\s*x|team|enterprise/.test(text)) return 'max5'
  return 'pro'
}

const KEEP_MS = 12 * 3600_000
const file = () => join(paths.root(), "ranks.json")

function read(): Record<string, { at: number; rank?: PlanRank; plan?: string }> {
  try { return existsSync(file()) ? JSON.parse(readFileSync(file(), 'utf8')) : {} } catch { return {} }
}

function ask(acc: AccountConfig): Promise<{ subscriptionType?: string; planTier?: string } | undefined> {
  return new Promise((resolve) => {
    const child = execFile(findClaude(), ['auth', 'status'], { env: envFor(acc), timeout: 20_000, windowsHide: true }, (err, out) => {
      if (err) return resolve(undefined)
      try {
        const j = JSON.parse(String(out).slice(String(out).indexOf('{')))
        // Only these two fields are kept: the rest (e-mail, organisation) is not the app's business here.
        resolve({ subscriptionType: j.subscriptionType, planTier: j.planTier })
      } catch { resolve(undefined) }
    })
    child.stdin?.end()
  })
}

let asking = false

/** The ranks known now; the stale ones are asked again in the background, one account after another. */
export function ranks(accounts: AccountConfig[], now = Date.now()): Record<string, PlanRank> {
  const known = read()
  const out: Record<string, PlanRank> = {}
  for (const a of accounts) if (known[a.id]?.rank) out[a.id] = known[a.id].rank!
  const stale = accounts.filter((a) => !known[a.id] || now - known[a.id].at > KEEP_MS)
  if (stale.length && !asking) {
    asking = true
    void (async () => {
      for (const a of stale) {
        const s = await ask(a)
        const all = read()
        all[a.id] = { at: Date.now(), rank: rankOf(s) ?? all[a.id]?.rank, plan: s?.planTier ?? s?.subscriptionType }
        try { writeFileSync(file(), JSON.stringify(all, null, 1)) } catch { /* next time */ }
      }
    })().finally(() => { asking = false })
  }
  return out
}
