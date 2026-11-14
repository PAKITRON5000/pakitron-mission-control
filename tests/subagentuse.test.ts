// Are the subagents used? Counted from the conversations Claude Code keeps (EV32, EV43), without reading anything twice.
import { describe, it, expect } from 'vitest'
import { appendFileSync, mkdirSync, mkdtempSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { countCalls, subagentUse, transcriptDir } from '../src/core/subagentuse'

const call = (n: string) => `{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Agent","input":{"description":"x","prompt":"busca {a}","subagent_type":"${n}"}}]}}\n`

describe('subagent use', () => {
  it('names the folder like Claude Code does', () => {
    expect(transcriptDir('C:\\c', 'C:\\Users\\P\\Downloads\\Juego\\.claude\\worktrees\\rachas')).toBe(join('C:\\c', 'projects', 'C--Users-P-Downloads-Juego--claude-worktrees-rachas'))
  })

  it('counts real calls, not the tool description, in recent conversations of every account and copy', async () => {
    const schema = '{"type":"api-request-shape","shape":{"tools":[{"name":"Agent","input_schema":{"properties":{"subagent_type":{"type":"string"}}}}]}}'
    expect(countCalls([schema, call('explorador'), call('explorador'), call('verificador')].join('\n'))).toEqual({ explorador: 2, verificador: 1 })
    // Skills loaded count too, apart (EV26).
    expect(countCalls('{"type":"tool_use","name":"Skill","input":{"skill":"dataviz","args":""}}\n{"name":"Skill","input":{"skill":"anthropic-skills:pdf"}}')).toEqual({ 'skill:dataviz': 1, 'skill:anthropic-skills:pdf': 1 })
    const a = mkdtempSync(join(tmpdir(), 'pmc-sa-')), b = mkdtempSync(join(tmpdir(), 'pmc-sb-'))
    const cwd = 'C:\\p\\juego'
    for (const [conf, text] of [[a, call('explorador')], [b, `${call('relevo')}${call('explorador')}`]] as const) {
      mkdirSync(transcriptDir(conf, cwd), { recursive: true })
      writeFileSync(join(transcriptDir(conf, cwd), 's.jsonl'), text)
    }
    const old = join(transcriptDir(a, cwd), 'viejo.jsonl')
    writeFileSync(old, call('verificador'))
    utimesSync(old, new Date(2026, 0, 1), new Date(2026, 0, 1))
    expect(await subagentUse([a, b], [cwd])).toEqual({ explorador: 2, relevo: 1 })
    // A conversation that grows is read from where it was left.
    appendFileSync(join(transcriptDir(a, cwd), 's.jsonl'), call('coordinador'))
    expect(await subagentUse([a, b], [cwd])).toEqual({ explorador: 2, relevo: 1, coordinador: 1 })
  })
})
