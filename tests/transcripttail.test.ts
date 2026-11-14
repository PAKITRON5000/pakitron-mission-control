// EV115: a working conversation is read incrementally (only what was added). The result must be the same as reading the
// whole tail from scratch, step by step, also when a line was caught half written.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtempSync, writeFileSync, appendFileSync, copyFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { readTranscriptTail } from '../src/core/sessions'

let dir = ''
beforeAll(() => { dir = mkdtempSync(join(tmpdir(), 'pmc-tail-')) })
afterAll(() => rmSync(dir, { recursive: true, force: true }))

const at = (m: number) => new Date(Date.UTC(2026, 10, 13, 14, m)).toISOString()
const user = (m: number, text: string, branch = 'main') => JSON.stringify({ type: 'user', timestamp: at(m), gitBranch: branch, cwd: 'C:\\p', message: { content: text } })
const tool = (m: number) => JSON.stringify({ type: 'user', timestamp: at(m), gitBranch: 'main', cwd: 'C:\\p', message: { content: [{ type: 'tool_result', content: 'x'.repeat(2000) }] } })
const assistant = (m: number, text: string | undefined, model = 'claude-opus-5-5', limited = false) => JSON.stringify({ type: 'assistant', timestamp: at(m), gitBranch: 'main', cwd: 'C:\\p', ...(limited ? { error: 'rate_limit' } : {}), message: { model, content: text ? [{ type: 'text', text }] : [{ type: 'tool_use', name: 'Bash' }] } })

describe('incremental transcript tail', () => {
  it('matches a fresh full read after every append', () => {
    const f = join(dir, 'a.jsonl')
    let n = 0
    const fresh = () => { const g = join(dir, `copy-${n++}.jsonl`); copyFileSync(f, g); return readTranscriptTail(g) }
    const same = () => {
      const inc = readTranscriptTail(f)!
      const full = fresh()!
      for (const k of ['lastActivityAt', 'model', 'title', 'lastPrompt', 'branch', 'cwd', 'rateLimited', 'lastAssistantText'] as const) expect(inc[k], k).toEqual(full[k])
      expect(inc.limit?.resetsAt).toEqual(full.limit?.resetsAt)
      return inc
    }
    writeFileSync(f, [user(0, 'arregla la sonda'), assistant(1, 'Voy.')].join('\n') + '\n')
    expect(same()).toMatchObject({ lastPrompt: 'arregla la sonda', lastAssistantText: 'Voy.', model: 'claude-opus-5-5' })
    appendFileSync(f, [tool(2), assistant(3, undefined)].join('\n') + '\n')
    expect(same().lastAssistantText).toBeUndefined() // the newest reply has no text, as a full read says
    // A line caught half written: read on the next call.
    const half = assistant(4, 'Hecho y probado.')
    appendFileSync(f, half.slice(0, 40))
    same()
    appendFileSync(f, half.slice(40) + '\n' + JSON.stringify({ type: 'custom-title', customTitle: 'Sonda de uso' }) + '\n')
    expect(same()).toMatchObject({ lastAssistantText: 'Hecho y probado.', title: 'Sonda de uso' })
    appendFileSync(f, [user(5, 'sigue', 'otra'), JSON.stringify({ type: 'last-prompt', lastPrompt: 'sigue' }), assistant(6, "You've hit your limit", '<synthetic>', true)].join('\n') + '\n')
    expect(same()).toMatchObject({ lastPrompt: 'sigue', rateLimited: true, model: undefined, title: 'Sonda de uso' })
    appendFileSync(f, assistant(7, 'Vuelvo a tener uso.') + '\n')
    expect(same()).toMatchObject({ rateLimited: false, limit: undefined, model: 'claude-opus-5-5' })
    // A picture read (one line of more than 200 KB) is skipped, and the lines around it still say everything.
    const picture = JSON.stringify({ type: 'user', timestamp: at(8), message: { content: [{ type: 'tool_result', content: [{ type: 'image', source: { data: 'A'.repeat(300_000) } }] }] } })
    appendFileSync(f, [picture, assistant(9, 'Visto en la captura.')].join('\n') + '\n')
    expect(same()).toMatchObject({ lastAssistantText: 'Visto en la captura.', lastActivityAt: Date.parse(at(9)) })
  })
})

describe('out of credit (EV146)', () => {
  it('a key or Console account whose last reply is a billing_error is stopped like at a limit, with no reset', () => {
    const f = join(dir, 'credito.jsonl')
    writeFileSync(f, [user(1, 'sigue'), JSON.stringify({ type: 'assistant', timestamp: at(2), cwd: 'C:\\p', error: 'billing_error', message: { model: 'claude-opus-5-5', content: [{ type: 'text', text: 'Credit balance is too low' }] } })].join('\n') + '\n')
    expect(readTranscriptTail(f)).toMatchObject({ rateLimited: true, noCredit: true, limit: undefined })
    appendFileSync(f, [user(3, 'sigue'), assistant(4, 'Hecho.')].join('\n') + '\n')
    const t = readTranscriptTail(f)
    expect(t?.rateLimited).toBe(false)
    expect(t?.noCredit).toBeUndefined()
  })
})
