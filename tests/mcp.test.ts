import { describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { countCalls } from '../src/core/subagentuse'
import { mcpLabel, mcpServers } from '../src/core/mcp'

describe('MCP in sight (EV26)', () => {
  it('counts the MCP tools called, by server, and not the tool lists', () => {
    const text = [
      '{"type":"tool_use","id":"toolu_1","name":"mcp__claude-in-chrome__navigate","input":{}}',
      '{"type":"tool_use","id":"toolu_2","name":"mcp__claude_ai_Gmail__search","input":{}}',
      '{"type":"tool_use","id":"toolu_3","name":"mcp__claude-in-chrome__computer","input":{}}',
      '{"name":"mcp__premiere-pro__verify","description":"a tool offered, not called"}',
    ].join('\n')
    const c = countCalls(text)
    expect(c['mcp:claude-in-chrome']).toBe(2)
    expect(c['mcp:claude_ai_Gmail']).toBe(1)
    expect(c['mcp:premiere-pro']).toBeUndefined()
  })

  it('lists the servers by name from the project and from each account, never their settings', () => {
    const base = mkdtempSync(join(tmpdir(), 'pmc-mcp-'))
    const root = join(base, 'Proyecto'), cfg = join(base, '.claude-uno')
    mkdirSync(root); mkdirSync(cfg)
    writeFileSync(join(root, '.mcp.json'), JSON.stringify({ mcpServers: { unity: { command: 'x', env: { KEY: 'secreto' } } } }))
    writeFileSync(join(cfg, '.claude.json'), JSON.stringify({ mcpServers: { blender: {} }, projects: { [root.replace(/\\/g, '/')]: { mcpServers: { figma: {} } }, 'C:/otro': { mcpServers: { nada: {} } } } }))
    const s = mcpServers(root, [{ id: 'claude1', configDir: cfg }])
    expect(s.map((x) => `${x.name}:${x.where}:${x.accounts.join('+')}`)).toEqual(['blender:cuenta:claude1', 'figma:carpeta:claude1', 'unity:proyecto:'])
    expect(JSON.stringify(s)).not.toContain('secreto')
  })

  it('counts files read whole, not the ones read in pieces (EV117)', () => {
    const text = [
      '{"type":"tool_use","id":"t1","name":"Read","input":{"file_path":"C:\\\\p\\\\docs\\\\TASKS.md"}}',
      '{"type":"tool_use","id":"t2","name":"Read","input":{"file_path":"C:\\\\p\\\\docs\\\\TASKS.md"}}',
      '{"type":"tool_use","id":"t3","name":"Read","input":{"file_path":"C:\\\\p\\\\src\\\\big.ts","offset":10,"limit":20}}',
    ].join('\n')
    const c = countCalls(text)
    expect(c['leido:C:\\p\\docs\\TASKS.md']).toBe(2)
    expect(Object.keys(c).filter((k) => k.startsWith('leido:'))).toHaveLength(1)
  })

  it('names the claude.ai connectors the way the user knows them', () => {
    expect(mcpLabel('claude_ai_Claude_Docs')).toBe('Claude Docs (claude.ai)')
    expect(mcpLabel('claude-in-chrome')).toBe('claude-in-chrome')
  })
})
