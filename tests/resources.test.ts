// Shared resources: what is seen running and the turns agents take before a heavy job.
import { describe, it, expect, beforeAll } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

let dir: string
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'pmc-res-'))
  process.env.PMC_DATA_DIR = join(dir, 'data')
})

describe('shared resources', async () => {
  const { openDb } = await import('../src/core/db')
  const coord = await import('../src/core/coord')
  const res = await import('../src/core/resources')
  const fresh = () => openDb(join(dir, 'data', `m-${Math.random().toString(36).slice(2)}.db`))
  const tasklist = (...names: string[]) => names.map((n) => `"${n}","1234","Console","1","10.000 KB"`).join('\r\n')
  const exec = (list: string, gpu?: string): import('../src/core/resources').Run => (cmd) => {
    if (cmd === 'tasklist') return list
    if (gpu === undefined) throw new Error('no nvidia-smi')
    return gpu
  }

  it('pmc relevo also passes on the turns the account it takes over held (EV180)', () => {
    const db = fresh()
    expect(res.holdResource(db, 'unity', 'claude1' as never, 'build de F10').ok).toBe(true)
    res.holdResource(db, 'gpu', 'claude6' as never)
    expect(res.handOverResources(db, 'claude1' as never, 'claude3' as never)).toEqual(['unity'])
    const held = res.heldResources(db)
    expect(held.find((r) => r.name === 'unity')?.account).toBe('claude3')
    expect(held.find((r) => r.name === 'unity')?.note).toContain('claude1')
    expect(held.find((r) => r.name === 'gpu')?.account).toBe('claude6')
    // Nothing held: nothing passed.
    expect(res.handOverResources(db, 'claude1' as never, 'claude3' as never)).toEqual([])
  })

  it.skipIf(process.platform !== 'win32')('sees the user playing or editing, the editors open and the memory of the card', () => {
    const busy = res.detectBusy(exec(tasklist('System', 'Adobe Premiere Pro.exe', 'Unity.exe', 'Unity Hub.exe', 'VALORANT-Win64-Shipping.exe', 'blender.exe'), '13100, 16303\r\n'))
    expect(busy.playing).toBe('VALORANT-Win64-Shipping.exe')
    expect(busy.userApps).toEqual(['Premiere'])
    expect(busy.unityEditors).toBe(1) // the Hub is not an editor
    expect(busy.blender).toBe(1)
    expect(busy.gpu).toEqual({ usedMb: 13100, totalMb: 16303 })
    const text = res.resourcesText(fresh(), 'claude1', busy)
    expect(text).toContain('NADA PESADO AHORA')
    expect(text).toContain('Premiere')
    expect(text).toContain('12,8 de 15,9 GB en uso, sin sitio para otro trabajo pesado')
  })

  it('with «toda la potencia» on, an open editor does not hold heavy work back; playing still does (EV149)', () => {
    const db = fresh()
    db.prepare("INSERT OR REPLACE INTO settings(key, value) VALUES('ui', ?)").run(JSON.stringify({ fullPower: true }))
    const editing = res.resourcesText(db, 'claude1', { userApps: ['Premiere'], unityEditors: 0, blender: 0 })
    expect(editing).not.toContain('NADA PESADO AHORA')
    expect(editing).toContain('TODA LA POTENCIA')
    expect(res.resourcesText(db, 'claude1', { playing: 'VALORANT-Win64-Shipping.exe', userApps: ['Premiere'], unityEditors: 0, blender: 0 })).toContain('NADA PESADO AHORA (ni Unity, ni Blender, ni ejecutable, ni generación con la gráfica): el usuario está jugando')
  })

  it('what cannot be read is left out, and a free machine says nothing', () => {
    const busy = res.detectBusy(exec(tasklist('System', 'Unity Hub.exe')))
    expect(busy).toEqual({ playing: undefined, userApps: [], unityEditors: 0, blender: 0 })
    expect(res.resourcesText(fresh(), 'claude1', busy)).toBe('')
    expect(res.detectBusy(() => { throw new Error('nothing works') })).toEqual({ userApps: [], unityEditors: 0, blender: 0 })
  })

  it('one turn per resource, across projects; it frees itself when the session dies and is renewed while it works', () => {
    const db = fresh()
    const t0 = 1_000_000
    expect(res.holdResource(db, 'GPU', 'claude2', 'vídeo del menú', t0).ok).toBe(true)
    const second = res.holdResource(db, 'gpu', 'claude3', undefined, t0 + 60_000)
    expect(second.ok).toBe(false)
    if (!second.ok) expect(second.holder.account).toBe('claude2')
    expect(res.holdResource(db, 'unity', 'claude3', undefined, t0).ok).toBe(true)
    expect(res.resourcesText(db, 'claude3', { userApps: [], unityEditors: 0, blender: 0 }, t0 + 60_000)).toMatch(/gpu \(claude2: vídeo del menú, hasta las .*unity \(tú, hasta las/)
    // claude2 keeps working: its end of turn renews the turn. claude3's session died: after two hours unity is free.
    coord.renewClaims(db, 'claude2', t0 + coord.LEASE_MS - 1000)
    const later = t0 + coord.LEASE_MS + 1000
    expect(res.heldResources(db, later).map((h) => h.name)).toEqual(['gpu'])
    expect(res.holdResource(db, 'unity', 'claude1', undefined, later).ok).toBe(true)
    expect(res.freeResource(db, 'gpu', 'claude2')).toBe(true)
    expect(res.freeResource(db, 'gpu', 'claude2')).toBe(false)
  })
})
