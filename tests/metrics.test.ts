// The figures of the week come from what is already kept, and count each thing once.
import { describe, it, expect, beforeAll } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

let dir: string
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'pmc-metrics-'))
  process.env.PMC_DATA_DIR = join(dir, 'data')
})

describe('metrics', async () => {
  const { openDb, addEvent } = await import('../src/core/db')
  const { metrics, spent } = await import('../src/core/metrics')
  const H = 3600_000
  const t0 = 1_800_000_000_000

  it('counts deliveries, approvals, checks, stops and the wait until another account goes on', () => {
    const db = openDb(join(dir, 'data', 'm.db'))
    const e = (at: number, kind: string, account: string | undefined, ref?: string) => addEvent(db, { projectId: 'p', at: t0 + at, account: account as any, kind, title: `${kind} ${ref ?? at}`, source: 'test', ref })
    e(1 * H, 'tarea-hecha', 'claude1', 'A1')
    e(2 * H, 'tarea-hecha', 'claude1', 'A1') // the same task marked twice is one delivery
    e(3 * H, 'tarea-hecha', 'claude3', 'A2')
    e(4 * H, 'tarea-verificada', undefined, 'A1')
    // claude1 stops (the session retries: three lines), claude3 writes 20 minutes later
    e(5 * H, 'limite', 'claude1'); e(5 * H + 60_000, 'limite', 'claude1'); e(5 * H + 120_000, 'limite', 'claude1')
    e(5 * H + 20 * 60_000, 'archivo', 'claude3')
    db.prepare("INSERT INTO verifications(project_id, task_key, account, at, outcome, summary) VALUES('p', 'A1', 'claude1', ?, 'bien', 'ok')").run(t0 + 2 * H)
    db.prepare("INSERT INTO verifications(project_id, task_key, account, at, outcome, summary) VALUES('p', 'A2', 'claude3', ?, 'falla', 'no')").run(t0 + 3 * H)
    const m = metrics(db, 'p', t0, t0 + 24 * H)
    expect(m.done).toBe(2)
    expect(m.approved).toBe(1)
    expect(m.checksOk).toBe(1)
    expect(m.checksFail).toBe(1)
    expect(m.limits).toBe(1)
    expect(m.handoffMinutes).toBe(20)
    expect(metrics(db, 'p', t0 + 30 * H, t0 + 40 * H).done).toBe(0)
  })

  it('usage spent is what went up inside a window; a reset is not usage given back', () => {
    const h = [{ at: t0, week: 10, weekResets: 1 }, { at: t0 + H, week: 14, weekResets: 1 }, { at: t0 + 2 * H, week: 2, weekResets: 2 }, { at: t0 + 3 * H, week: 5, weekResets: 2 }]
    expect(spent(h as any, t0, t0 + 10 * H)).toBe(7)
  })
})
