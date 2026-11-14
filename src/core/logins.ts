import { t } from './i18n'
// When each account's sign-in ends (EV98). Claude Code warns only inside a session («this sign-in ends between 18 and 21
// November… Run claude auth login before then»), and a wheel that runs at night would find the account logged out. The app
// reads `claude auth status` (free, no usage) and says it days before. No node imports: main/index.ts runs the command
// and keeps what it read in logins.json, which core/accounts.ts reads (EV146: a login that leaves no credentials file).

import type { PlanInfo } from './types'

/** `method`, `provider` and `plan` as Claude Code prints them (authMethod, apiProvider, subscriptionType/planTier); never the e-mail or organisation. */
export interface LoginState { loggedIn: boolean; expiresAt?: number; checkedAt: number; method?: string; provider?: string; plan?: string }

/** From `claude auth status` (JSON); undefined when it cannot be read. */
export function parseAuthStatus(text: string, now = Date.now()): LoginState | undefined {
  const i = text.indexOf('{')
  if (i < 0) return undefined
  try {
    const j = JSON.parse(text.slice(i, text.lastIndexOf('}') + 1)) as { loggedIn?: boolean; loginExpiresAt?: string; authMethod?: string; apiProvider?: string; subscriptionType?: string; planTier?: string }
    const at = j.loginExpiresAt ? Date.parse(j.loginExpiresAt) : NaN
    const plan = [...new Set([j.subscriptionType, j.planTier].filter((x): x is string => typeof x === 'string' && Boolean(x)))].join(' ')
    return {
      loggedIn: j.loggedIn === true, expiresAt: Number.isFinite(at) ? at : undefined, checkedAt: now,
      ...(typeof j.authMethod === 'string' ? { method: j.authMethod } : {}), ...(typeof j.apiProvider === 'string' ? { provider: j.apiProvider } : {}), ...(plan ? { plan } : {})
    }
  } catch { return undefined }
}

const CLOUD: Record<string, string> = { bedrock: 'Amazon Bedrock', vertex: 'Google Vertex', foundry: 'Microsoft Foundry' }
const PAY_AS_YOU_GO = 'Paga por lo que usa: no tiene límite de 5 horas ni semanal que leer. Si se acaba el crédito o el presupuesto, Claude Code lo dice y la app la trata como sin uso.'
const HIDDEN_LIMITS = (plan: string) => `Con ${plan} hay límites, pero Claude Code solo dice cuánto queda en Pro, Max y Ultra: Mission Control sabe que se han acabado cuando Claude Code avisa del límite.`

/**
 * EV146: the plan or way of signing in, in the user's words, and whether there is usage to read. What `claude auth status`
 * prints was tried on 14-11 (Claude Code 2.1.325): `claude.ai` with subscriptionType pro…; `api_key` (ANTHROPIC_API_KEY or
 * a Console key); `oauth_token` (CLAUDE_CODE_OAUTH_TOKEN, a subscription's long token); `third_party` with apiProvider
 * bedrock or vertex; `none` when not signed in. The statusLine gives `rate_limits` only to Pro, Max and Ultra (docs).
 */
export function planOf(s: Pick<LoginState, 'loggedIn' | 'method' | 'provider' | 'plan'> | undefined): PlanInfo | undefined {
  if (!s?.loggedIn) return undefined
  const plan = (s.plan ?? '').toLowerCase()
  if (s.method === 'third_party' || (s.provider && s.provider !== 'firstParty')) return { label: CLOUD[s.provider ?? ''] ?? t('Nube propia'), limits: false, note: PAY_AS_YOU_GO, paysPerUse: true }
  if (s.method === 'api_key') return { label: t('Pago por uso (clave)'), limits: false, note: PAY_AS_YOU_GO, paysPerUse: true }
  if (/ultra/.test(plan)) return { label: t('Ultra'), limits: true }
  if (/20\s*x|max_?20/.test(plan)) return { label: t('Max 20x'), limits: true }
  if (/max/.test(plan)) return { label: /5\s*x|max_?5/.test(plan) ? t('Max 5x') : t('Max'), limits: true }
  if (/enterprise/.test(plan)) return { label: t('Enterprise'), limits: false, note: HIDDEN_LIMITS('Enterprise') }
  if (/team/.test(plan)) return { label: t('Team'), limits: false, note: HIDDEN_LIMITS('Team') }
  if (/pro/.test(plan)) return { label: t('Pro'), limits: true }
  if (s.method === 'oauth_token') return { label: t('Suscripción (token)'), limits: true }
  if (s.method === 'claude.ai') return { label: t('Claude.ai'), limits: true }
  return { label: t('Pago por uso (Console)'), limits: false, note: PAY_AS_YOU_GO, paysPerUse: true }
}

/**
 * EV146: what the status line says about usage when Claude Code gives no `rate_limits`: before the first reply of a Pro,
 * Max or Ultra session «aún sin datos»; with Team or Enterprise that it is not given; paying per use, this session's cost.
 */
export function noLimitsText(plan: PlanInfo | undefined, costUsd?: number): string {
  if (plan?.paysPerUse) return typeof costUsd === 'number' ? t('gasto de esta sesión {v0} $', { v0: costUsd.toFixed(2) }) : t('paga por uso')
  if (plan && !plan.limits) return t('uso: {label} no lo da', { label: plan.label })
  return t('uso: aún sin datos')
}

/** Warn this many days before. */
export const LOGIN_WARN_DAYS = 5

/** What to tell the user about an account's sign-in, if anything. */
export function loginWarning(s: LoginState | undefined, now = Date.now()): { level: 'caducada' | 'pronto'; text: string; days?: number } | undefined {
  if (!s) return undefined
  if (!s.loggedIn || (s.expiresAt != null && s.expiresAt <= now)) return { level: 'caducada', text: t('su inicio de sesión ha caducado: no puede trabajar hasta que entres otra vez') }
  if (s.expiresAt == null) return undefined
  const days = (s.expiresAt - now) / 86400_000
  if (days > LOGIN_WARN_DAYS) return undefined
  const d = new Date(s.expiresAt)
  const when = `el ${['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'][d.getDay()]} ${d.getDate()} a las ${d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}`
  return { level: 'pronto', days: Math.max(0, Math.floor(days)), text: t('su inicio de sesión caduca {when}{v0}', { when: when, v0: days < 1 ? ' (hoy)' : ` (quedan ${Math.floor(days)} ${Math.floor(days) === 1 ? 'día' : 'días'})` }) }
}
