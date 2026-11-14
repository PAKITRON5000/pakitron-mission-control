import { describe, expect, it } from 'vitest'
import { parseAuthStatus, loginWarning, planOf, noLimitsText } from '../src/core/logins'

const NOW = new Date(2026, 10, 18, 12, 0).getTime()

describe('sign-in that ends (EV98)', () => {
  it('reads claude auth status', () => {
    const s = parseAuthStatus('Warning: x\n{ "loggedIn": true, "loginExpiresAt": "2026-11-21T20:22:23.573Z", "email": "a@b" }', NOW)
    expect(s?.loggedIn).toBe(true)
    expect(s?.expiresAt).toBe(Date.parse('2026-11-21T20:22:23.573Z'))
    expect(parseAuthStatus('nada', NOW)).toBeUndefined()
  })
  it('warns five days before, and when it is over', () => {
    expect(loginWarning({ loggedIn: true, expiresAt: NOW + 3.4 * 86400_000, checkedAt: NOW }, NOW)).toMatchObject({ level: 'pronto', days: 3 })
    expect(loginWarning({ loggedIn: true, expiresAt: NOW + 9 * 86400_000, checkedAt: NOW }, NOW)).toBeUndefined()
    expect(loginWarning({ loggedIn: false, checkedAt: NOW }, NOW)?.level).toBe('caducada')
    expect(loginWarning({ loggedIn: true, expiresAt: NOW - 1000, checkedAt: NOW }, NOW)?.level).toBe('caducada')
  })
})

// EV146 (the user: «que funcione y puedan conectar sus cuentas sea el plan que sea»): what `claude auth status` printed
// on 14-11 (Claude Code 2.1.325) for each way of signing in, without e-mail or organisation.
const STATUS = {
  pro: '{"loggedIn":true,"authMethod":"claude.ai","apiProvider":"firstParty","loginExpiresAt":"2026-12-04T21:08:22.446Z","subscriptionType":"pro","planTier":"pro"}',
  max5: '{"loggedIn":true,"authMethod":"claude.ai","apiProvider":"firstParty","subscriptionType":"max","planTier":"max_5x"}',
  max20: '{"loggedIn":true,"authMethod":"claude.ai","apiProvider":"firstParty","subscriptionType":"max","planTier":"max_20x"}',
  ultra: '{"loggedIn":true,"authMethod":"claude.ai","apiProvider":"firstParty","subscriptionType":"ultra","planTier":"ultra"}',
  team: '{"loggedIn":true,"authMethod":"claude.ai","apiProvider":"firstParty","subscriptionType":"team","planTier":"team"}',
  enterprise: '{"loggedIn":true,"authMethod":"claude.ai","apiProvider":"firstParty","subscriptionType":"enterprise"}',
  apiKey: '{"loggedIn":true,"authMethod":"api_key","apiProvider":"firstParty","loginExpiresAt":null,"apiKeySource":"ANTHROPIC_API_KEY"}',
  token: '{"loggedIn":true,"authMethod":"oauth_token","apiProvider":"firstParty","loginExpiresAt":null}',
  bedrock: '{"loggedIn":true,"authMethod":"third_party","apiProvider":"bedrock","loginExpiresAt":null}',
  vertex: '{"loggedIn":true,"authMethod":"third_party","apiProvider":"vertex","loginExpiresAt":null}',
  console: '{"loggedIn":true,"authMethod":"console","apiProvider":"firstParty"}',
  none: '{"loggedIn":false,"authMethod":"none","apiProvider":"firstParty","loginExpiresAt":null}'
}

describe('any plan (EV146)', () => {
  const plan = (k: keyof typeof STATUS) => planOf(parseAuthStatus(STATUS[k], NOW))
  it('keeps method, provider and plan, never e-mail or organisation', () => {
    const s = parseAuthStatus('{"loggedIn":true,"authMethod":"claude.ai","apiProvider":"firstParty","email":"a@b","orgName":"x","subscriptionType":"max","planTier":"max_20x"}', NOW)
    expect(s).toEqual({ loggedIn: true, checkedAt: NOW, method: 'claude.ai', provider: 'firstParty', plan: 'max max_20x' })
  })
  it('Pro, Max and Ultra give usage to read', () => {
    expect(plan('pro')).toEqual({ label: 'Pro', limits: true })
    expect(plan('max5')).toEqual({ label: 'Max 5x', limits: true })
    expect(plan('max20')).toEqual({ label: 'Max 20x', limits: true })
    expect(plan('ultra')).toEqual({ label: 'Ultra', limits: true })
    expect(plan('token')?.limits).toBe(true)
  })
  it('Team and Enterprise have limits the app cannot read; a key, Console or a cloud pay per use and are never probed', () => {
    for (const k of ['team', 'enterprise'] as const) expect(plan(k)).toMatchObject({ limits: false, label: k === 'team' ? 'Team' : 'Enterprise' })
    expect(plan('team')?.paysPerUse).toBeUndefined()
    expect(plan('apiKey')).toMatchObject({ label: 'Pago por uso (clave)', limits: false, paysPerUse: true })
    expect(plan('bedrock')).toMatchObject({ label: 'Amazon Bedrock', limits: false, paysPerUse: true })
    expect(plan('vertex')).toMatchObject({ label: 'Google Vertex', paysPerUse: true })
    expect(plan('console')).toMatchObject({ label: 'Pago por uso (Console)', paysPerUse: true })
    for (const k of Object.keys(STATUS) as (keyof typeof STATUS)[]) if (!plan(k)?.limits && k !== 'none') expect(plan(k)?.note).toBeTruthy()
  })
  it('not signed in: no plan', () => {
    expect(plan('none')).toBeUndefined()
    expect(planOf(undefined)).toBeUndefined()
  })
})

describe('signed in with no credentials file (EV146)', () => {
  it('a Console, key or cloud account counts as signed in once claude auth status said so, with its plan', async () => {
    const { mkdtempSync, writeFileSync } = await import('node:fs')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    const data = mkdtempSync(join(tmpdir(), 'pmc-logins-'))
    const cfg = mkdtempSync(join(tmpdir(), 'pmc-cfg-'))
    const before = process.env.PMC_DATA_DIR
    process.env.PMC_DATA_DIR = data
    try {
      const { readIdentity } = await import('../src/core/accounts')
      const acc = { id: 'claude7', alias: 'x', configDir: cfg, color: '#fff' } as any
      expect(readIdentity(acc).hasLogin).toBe(false)
      writeFileSync(join(data, 'logins.json'), JSON.stringify({ claude7: parseAuthStatus(STATUS.apiKey, NOW) }))
      expect(readIdentity(acc)).toMatchObject({ hasLogin: true, plan: { label: 'Pago por uso (clave)', paysPerUse: true } })
    } finally {
      if (before === undefined) delete process.env.PMC_DATA_DIR
      else process.env.PMC_DATA_DIR = before
    }
  })
})

describe('the status line with no rate_limits (EV146)', () => {
  const plan = (k: keyof typeof STATUS) => planOf(parseAuthStatus(STATUS[k], NOW))
  it('Pro before its first reply, Team, a key with its cost', () => {
    expect(noLimitsText(plan('pro'))).toBe('uso: aún sin datos')
    expect(noLimitsText(undefined)).toBe('uso: aún sin datos')
    expect(noLimitsText(plan('team'))).toBe('uso: Team no lo da')
    expect(noLimitsText(plan('enterprise'), 3.2)).toBe('uso: Enterprise no lo da')
    expect(noLimitsText(plan('apiKey'), 0.4183)).toBe('gasto de esta sesión 0.42 $')
    expect(noLimitsText(plan('bedrock'))).toBe('paga por uso')
  })
})
