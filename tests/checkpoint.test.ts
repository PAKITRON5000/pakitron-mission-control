// pmc guarda (EV41): heartbeat in RELEVO.md, the account's files, git's list of changes.
import { describe, it, expect } from 'vitest'
import { archiveRelevo, enCursoLine, futureHours, heartbeatLine, leadingDate, pickFiles, porcelainPaths, staleEnCurso, withHeartbeat } from '../src/core/checkpoint'

describe('pmc guarda', () => {
  const at = new Date(2026, 10, 12, 12, 5)
  const line = heartbeatLine(at, 'claude3', 'EV41 hecha;\n falta la captura')

  it('writes the heartbeat line in the format both projects use', () => {
    expect(line).toBe('**Último latido:** 2026-11-12 12:05 · claude3 · EV41 hecha; falta la captura')
  })

  it('replaces the heartbeat and keeps one step of history, without piling up', () => {
    const md = ['# Relevo', '', '**En curso:** claude3, EV41.', '', '**Último latido:** 2026-11-12 10:04 · claude6 · MP cerrada.', '', '## Notas'].join('\n')
    const once = withHeartbeat(md, line)
    expect(once).toContain(`${line}\n\n**Latido anterior:** 2026-11-12 10:04 · claude6 · MP cerrada.\n\n## Notas`)
    const twice = withHeartbeat(once, heartbeatLine(new Date(2026, 10, 12, 13, 0), 'claude1', 'otra cosa'))
    expect(twice.match(/Latido anterior/g)).toHaveLength(1)
    expect(twice).toContain('**Latido anterior:** 2026-11-12 12:05 · claude3')
    expect(twice).not.toContain('MP cerrada')
  })

  it('with no heartbeat yet, it goes after «En curso», or under the title; Windows line ends are kept', () => {
    expect(withHeartbeat('# R\r\n\r\n**En curso:** algo\r\nque sigue\r\n\r\n## Más', line)).toBe(`# R\r\n\r\n**En curso:** algo\r\nque sigue\r\n\r\n${line}\r\n\r\n## Más`)
    expect(withHeartbeat('# R\n\nTexto.', line)).toBe(`# R\n\n${line}\n\nTexto.`)
  })

  it('reads git status -z, renames by their new name', () => {
    expect(porcelainPaths(' M src/a.ts\0R  b.ts\0old b.ts\0?? Logs/new/\0')).toEqual(['src/a.ts', 'b.ts', 'Logs/new/'])
  })

  it('commits everything when no other account wrote there; only its own when another did', () => {
    const changed = ['src/a.ts', 'src/b.ts', 'Logs/new/', 'docs/RELEVO.md']
    expect(pickFiles({ changed, mine: [], others: [] }).commit).toEqual(changed)
    const r = pickFiles({ changed, mine: ['src/a.ts','Logs/new/cap.png', 'docs/RELEVO.md'], others: ['src/b.ts'] })
    expect(r.commit).toEqual(['src/a.ts', 'Logs/new/', 'docs/RELEVO.md'])
    expect(r.left).toEqual(['src/b.ts'])
  })

  it('takes too what nobody else touched and changed after their last write, as a version raised by a script (EV143)', () => {
    const changed = ['package.json', 'src/b.ts', 'src/c.ts', 'docs/RELEVO.md']
    const mtime = (p: string) => ({ 'package.json': 500, 'src/b.ts': 600, 'src/c.ts': 50 } as Record<string, number>)[p]
    const r = pickFiles({ changed, mine: ['docs/RELEVO.md'], others: ['src/b.ts'], othersLast: 100, mtime })
    // package.json: changed at 500, after the other's last write at 100, and the other never touched it.
    // src/b.ts: the other touched it. src/c.ts: changed before the other's last write (it could be the other's, by an order).
    expect(r.commit).toEqual(['package.json', 'docs/RELEVO.md'])
    expect(r.left).toEqual(['src/b.ts', 'src/c.ts'])
    // Without knowing when the others last wrote, nothing changes.
    expect(pickFiles({ changed, mine: ['docs/RELEVO.md'], others: ['src/b.ts'], mtime }).commit).toEqual(['docs/RELEVO.md'])
  })

  it('leaves a late file when another account was running something here just before it changed (14-11 17:23)', () => {
    const changed = ['package.json', 'src/core/brief.ts', 'docs/RELEVO.md']
    const min = 60_000
    const mtime = (p: string) => ({ 'package.json': 100 * min, 'src/core/brief.ts': 50 * min } as Record<string, number>)[p]
    // The other's script started a minute before brief.ts changed; nobody else ran anything near package.json's change.
    const r = pickFiles({ changed, mine: ['docs/RELEVO.md'], others: ['src/b.ts'], othersLast: 10 * min, mtime, othersBusy: [49 * min, 20 * min] })
    expect(r.commit).toEqual(['package.json', 'docs/RELEVO.md'])
    expect(r.left).toEqual(['src/core/brief.ts'])
    // Long after, or well after the change, their calls say nothing about it.
    expect(pickFiles({ changed, mine: ['docs/RELEVO.md'], others: ['src/b.ts'], othersLast: 10 * min, mtime, othersBusy: [40 * min, 51 * min] }).left).toEqual([])
    // The others here only through orders (no file written with a tool): the same, with what this one wrote always in.
    const only = pickFiles({ changed, mine: ['docs/RELEVO.md', 'src/core/brief.ts'], others: [], mtime, othersBusy: [49 * min, 99 * min] })
    expect(only.commit).toEqual(['src/core/brief.ts', 'docs/RELEVO.md'])
    expect(only.left).toEqual(['package.json'])
    expect(pickFiles({ changed, mine: [], others: [], mtime }).commit).toEqual(changed)
  })

  it('leaving in an overlap, leaves the files both touched to the one who stays, but not the handover (EV42)', () => {
    const changed = ['src/main/index.ts', 'src/a.ts', 'docs/RELEVO.md', 'docs/archivo/relevo-2026-11.md']
    const mine = ['src/main/index.ts', 'src/a.ts', 'docs/RELEVO.md', 'docs/archivo/relevo-2026-11.md']
    const others = ['src/main/index.ts', 'docs/RELEVO.md']
    expect(pickFiles({ changed, mine, others }).commit).toEqual(changed)
    const r = pickFiles({ changed, mine, others, leaving: true })
    expect(r.commit).toEqual(['src/a.ts', 'docs/RELEVO.md', 'docs/archivo/relevo-2026-11.md'])
    expect(r.left).toEqual(['src/main/index.ts'])
  })
})

describe('a RELEVO.md that does not grow (EV40)', () => {
  const now = new Date(2026, 10, 12, 12, 0).getTime()
  const filler = (n: number) => Array.from({ length: n }, (_, i) => `- paso ${i}: ${'texto largo de historia '.repeat(6)}`).join('\n')
  const md = [
    '# Por dónde vamos', '',
    '**Último latido (claude1, vuelco):** 2026-11-12 10:05 · Concurso juzgado.', '',
    '**En curso (claude1, 11-11 21:20): vuelco viral**', '',
    '**Latido anterior:** 2026-11-10 08:00 · tres.', '',
    '**Latido de claude4:** 2026-11-09 08:00 · dos.', '',
    '**Último latido de claude6:** 2026-11-08 19:40 · Director visual.', 'con una segunda línea', '',
    '## Historial de relevos', '', 'Lo que pasó.', '',
    '## 9-11-2026, 15:27: claude4, PUB7', filler(140), '',
    '## 12-11-2026, 09:00: claude1, de hoy', '- reciente', '',
    '## Encargo en curso: Cuatro climas, 7-11-2026', '- sigue vivo', '',
    '## Lo que quiere el usuario', '- que se entienda', ''
  ].join('\n')

  it('reads both date forms', () => {
    expect(leadingDate('9-11-2026, 15:27: claude4')).toBe(new Date(2026, 10, 9, 15, 27).getTime())
    expect(leadingDate('**Último latido:** 2026-11-12 10:05 · x')).toBe(new Date(2026, 10, 12, 10, 5).getTime())
  })

  it('moves history and old heartbeats out and leaves what is alive, with a pointer', () => {
    expect(archiveRelevo('# corto\n', now, 'x.md')).toBeUndefined()
    const r = archiveRelevo(md, now, 'RELEVO-hasta-2026-11-12.md')!
    expect(r.keep).toContain('2026-11-12 10:05 · Concurso juzgado')
    expect(r.keep).toContain('**En curso (claude1, 11-11 21:20)')
    expect(r.keep).toContain('## 12-11-2026, 09:00: claude1, de hoy')
    expect(r.keep).toContain('## Encargo en curso: Cuatro climas')
    expect(r.keep).toContain('## Lo que quiere el usuario')
    expect(r.keep).toContain('## Dónde está lo de antes\n\n- `docs/archivo/RELEVO-hasta-2026-11-12.md`')
    expect(r.keep).not.toContain('Director visual')
    expect(r.keep).not.toContain('PUB7')
    expect(r.archived).toContain('## Historial de relevos')
    expect(r.archived).toContain('## 9-11-2026, 15:27: claude4, PUB7')
    expect(r.archived).toContain('2026-11-08 19:40 · Director visual.\ncon una segunda línea')
    expect(Buffer.byteLength(r.keep)).toBeLessThan(2000)
  })
})

describe('hours written ahead of the clock (EV113)', () => {
  it('finds the hours of today that have not come yet, in added lines only', () => {
    const now = new Date(2026, 10, 13, 13, 3).getTime()
    const diff = ['+- [x] EV116 · *Hecha (13-11 13:18, claude3)', '+**0.30.71 (13-11, 13:20, claude3', '-(13-11 14:00) quitada', '+(13-11 12:42) bien', '+(12-11 23:50) ayer', '+el 13-11 a las 13:10'].join('\n')
    expect(futureHours(diff, now)).toEqual(['13-11 13:18', '13-11, 13:20', '13-11 a las 13:10'])
    expect(futureHours('+13-11 13:04', now)).toEqual([])
    // A time meant to come is not a slip (14-11: «claude6, que vuelve el 14-11 a las 01:10» written at 01:00).
    expect(futureHours('+siguiendo a claude6, que vuelve el 13-11 a las 15:10; sin uso hasta el 13-11 a las 16:00; por defecto a las 13-11 14:00', now)).toEqual([])
    expect(futureHours('+**En curso (claude1, desde el 13-11 a las 13:30)**', now)).toEqual(['13-11 a las 13:30'])
  })
})

describe('«En curso» que se queda viejo (14-11)', () => {
  const md = '# Relevo\r\n\r\n**En curso (claude1, desde las 23:51, siguiendo a claude6):** EV141.\r\n\r\n**Último latido:** algo'
  const t0 = new Date(2026, 10, 14, 0, 0).getTime()
  it('lee la línea y no dice nada mientras cambia', () => {
    expect(enCursoLine(md)).toBe('**En curso (claude1, desde las 23:51, siguiendo a claude6):** EV141.')
    const a = staleEnCurso(enCursoLine(md), 'claude1', undefined, t0)
    expect(a.reminder).toBeUndefined()
    const b = staleEnCurso('**En curso (claude1, desde las 23:51):** EV146.', 'claude1', a.mark, t0 + 60_000)
    expect(b.reminder).toBeUndefined()
    expect(b.mark?.saves).toBe(1)
  })
  it('avisa al tercer guardado sin cambios o pasada hora y media', () => {
    let m = staleEnCurso(enCursoLine(md), 'claude1', undefined, t0).mark
    m = staleEnCurso(enCursoLine(md), 'claude1', m, t0 + 10 * 60_000).mark
    const third = staleEnCurso(enCursoLine(md), 'claude1', m, t0 + 20 * 60_000)
    expect(third.reminder).toMatch(/no ha cambiado desde las 00:00 \(3 guardados\)/)
    const first = staleEnCurso(enCursoLine(md), 'claude1', undefined, t0).mark
    expect(staleEnCurso(enCursoLine(md), 'claude1', first, t0 + 91 * 60_000).reminder).toContain('no ha cambiado')
  })
  it('avisa si es de otra cuenta, aunque la nombre más adelante', () => {
    expect(staleEnCurso(enCursoLine(md), 'claude6', undefined, t0).reminder).toContain('es de otra cuenta')
    expect(staleEnCurso('**En curso:** algo sin cuenta', 'claude6', undefined, t0).reminder).toBeUndefined()
    expect(staleEnCurso(undefined, 'claude1', undefined, t0)).toEqual({})
  })
})
