// EV52 step 2: one event, two hooks (account and project): only the first one acts.
import { describe, it, expect } from 'vitest'
import { mkdtempSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { cleanEventMarks, firstForEvent, hookEventKey } from '../src/core/hookonce'
import { describe as d2, it as it2, expect as e2 } from 'vitest'

d2('two different tools at once, with no tool_use_id', () => {
  it2('do not share a key: the second one is not lost; the same text twice is one event', () => {
    const a = '{"session_id":"s","hook_event_name":"PreToolUse","tool_name":"Bash","tool_input":{"command":"ls"}}'
    const b = '{"session_id":"s","hook_event_name":"PreToolUse","tool_name":"Read","tool_input":{"file_path":"x"}}'
    const ev = { session_id: 's', hook_event_name: 'PreToolUse' }
    e2(hookEventKey(ev, 10_000, a)).not.toBe(hookEventKey(ev, 10_000, b))
    e2(hookEventKey(ev, 10_000, a)).toBe(hookEventKey(ev, 10_500, a))
  })
})

describe('un evento, dos ganchos (EV52)', () => {
  it('solo el primero lo atiende; otro evento o otra herramienta sí', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pmc-once-'))
    const k = hookEventKey({ session_id: 's1', hook_event_name: 'PostToolUse', tool_use_id: 't1' })
    expect(firstForEvent(dir, k)).toBe(true)
    expect(firstForEvent(dir, k)).toBe(false)
    expect(firstForEvent(dir, hookEventKey({ session_id: 's1', hook_event_name: 'PostToolUse', tool_use_id: 't2' }))).toBe(true)
    expect(firstForEvent(dir, hookEventKey({ session_id: 's1', hook_event_name: 'Stop' }, 10_000))).toBe(true)
    expect(firstForEvent(dir, hookEventKey({ session_id: 's1', hook_event_name: 'Stop' }, 11_000))).toBe(false)
    expect(cleanEventMarks(dir, -1)).toBe(3)
    expect(readdirSync(dir)).toEqual([])
  })
})
