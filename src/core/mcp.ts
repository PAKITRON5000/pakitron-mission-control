/**
 * EV26: the MCP servers a project can use, by name only (their settings can carry keys: never read past the name).
 * Three places: the project's `.mcp.json`, each account's own list and the account's list for this folder, both in
 * `<configDir>/.claude.json`. The servers of claude.ai (connectors) are not listed anywhere on disk: they show up
 * only when used, through the conversations (`mcp:<server>` in the counts of core/subagentuse.ts).
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

export interface McpServer { name: string; where: 'proyecto' | 'cuenta' | 'carpeta'; accounts: string[] }

const names = (o: unknown): string[] => (o && typeof o === 'object' ? Object.keys(o as Record<string, unknown>) : [])
const readJson = (file: string): any => { try { return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : undefined } catch { return undefined } }
const same = (a: string, b: string) => a.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase() === b.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()

export function mcpServers(root: string, accounts: { id: string; configDir: string }[]): McpServer[] {
  const out = new Map<string, McpServer>()
  const put = (name: string, where: McpServer['where'], account?: string) => {
    const s = out.get(name) ?? { name, where, accounts: [] }
    if (where === 'proyecto') s.where = 'proyecto'
    if (account && !s.accounts.includes(account)) s.accounts.push(account)
    out.set(name, s)
  }
  for (const n of names(readJson(join(root, '.mcp.json'))?.mcpServers)) put(n, 'proyecto')
  for (const a of accounts) {
    const j = readJson(join(a.configDir, '.claude.json'))
    if (!j) continue
    for (const n of names(j.mcpServers)) put(n, 'cuenta', a.id)
    for (const [path, p] of Object.entries((j.projects ?? {}) as Record<string, any>)) if (same(path, root)) for (const n of names(p?.mcpServers)) put(n, 'carpeta', a.id)
  }
  return [...out.values()].sort((x, y) => x.name.localeCompare(y.name))
}

/** «claude_ai_Gmail» → «Gmail (claude.ai)»: the name the user knows. */
export const mcpLabel = (server: string): string => server.startsWith('claude_ai_') ? `${server.slice(10).replace(/_/g, ' ')} (claude.ai)` : server
