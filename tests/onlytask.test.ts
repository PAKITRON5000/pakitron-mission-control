import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { openDb, type DB } from '../src/core/db'
import { claimTask, releaseTask } from '../src/core/coord'
import { isStopPrompt } from '../src/core/autonomy'
import { answerPrompt, endedTurnSince, notePrompt, onlyTaskFinished, onlyTaskPrompt, ONLY_TASK_MS, reopenForAnswer } from '../src/core/onlytask'

const P = 'iv'
let db: DB
beforeEach(() => {
  db = openDb(join(mkdtempSync(join(tmpdir(), 'pmc-')), 't.db'))
  db.prepare(`INSERT INTO tasks (project_id, key, ext_id, title, detail, status, priority, source, gone, created_at, updated_at)
    VALUES (?, 'app:x', NULL, 'Limpiar los vídeos', '', 'pendiente', 2, 'app', 0, 1, 1)`).run(P)
})

describe('solo esta tarea (EV159)', () => {
  const t = { projectId: P, taskKey: 'app:x', label: 'app:x', at: 1000 }

  it('el texto con el que se abre nombra la tarea, prohíbe otras y termina en una orden de parar', () => {
    const s = onlyTaskPrompt({ label: 'IV30', title: 'Limpiar "los" vídeos & 100%', projectName: 'Mis Vídeos' })
    expect(s).toContain('UNA sola tarea: IV30')
    expect(s).toContain('No cojas ninguna otra tarea')
    expect(s).not.toMatch(/["%&]/)
    expect(isStopPrompt(s)).toBe(true)
  })

  it('no está terminada hasta que la suelta o se marca hecha', () => {
    expect(onlyTaskFinished(db, 'claude5' as never, t)).toBe(false)
    claimTask(db, P, 'app:x', 'claude5' as never, { now: 2000 })
    expect(onlyTaskFinished(db, 'claude5' as never, t)).toBe(false)
    releaseTask(db, P, 'app:x', 'claude5' as never, undefined, 3000)
    expect(onlyTaskFinished(db, 'claude5' as never, t)).toBe(true)
  })

  it('soltar algo de otra cuenta, o de antes de abrirla, no cuenta', () => {
    claimTask(db, P, 'app:x', 'claude1' as never, { now: 500 })
    releaseTask(db, P, 'app:x', 'claude1' as never, undefined, 600)
    expect(onlyTaskFinished(db, 'claude5' as never, t)).toBe(false)
    expect(onlyTaskFinished(db, 'claude1' as never, t)).toBe(false)
  })

  it('marcada hecha, cuenta como terminada', () => {
    db.prepare("UPDATE tasks SET status = 'terminada' WHERE key = 'app:x'").run()
    expect(onlyTaskFinished(db, 'claude5' as never, t)).toBe(true)
    expect(ONLY_TASK_MS).toBeGreaterThan(3600_000)
  })
})

describe('contestar a un Claude que se cerró tras su tarea (EV160)', () => {
  const closed = { claude5: { projectId: P, taskKey: 'app:x', label: 'IV20', at: 1000, closedAt: 5000 } }

  it('lo vuelve a abrir si preguntó mientras estaba abierto para ella y ya no tiene ventana allí', () => {
    expect(reopenForAnswer({ askedBy: 'claude5', projectId: P, createdAt: 3000 }, closed, false)?.label).toBe('IV20')
  })

  it('no, si sigue abierto, si es otro proyecto, si la pregunta es de antes o de otra cuenta', () => {
    expect(reopenForAnswer({ askedBy: 'claude5', projectId: P, createdAt: 3000 }, closed, true)).toBeUndefined()
    expect(reopenForAnswer({ askedBy: 'claude5', projectId: 'otro', createdAt: 3000 }, closed, false)).toBeUndefined()
    expect(reopenForAnswer({ askedBy: 'claude5', projectId: P, createdAt: 500 }, closed, false)).toBeUndefined()
    expect(reopenForAnswer({ askedBy: 'claude1', projectId: P, createdAt: 3000 }, closed, false)).toBeUndefined()
    expect(reopenForAnswer({ projectId: P, createdAt: 3000 }, closed, false)).toBeUndefined()
  })

  it('el texto con que se abre pide leer la respuesta, hacer solo eso y parar', () => {
    const s = answerPrompt({ projectName: 'Mis Vídeos', label: 'IV20', title: '¿Borro los vídeos "apartados"?', decisionId: 154 })
    expect(s).toContain('pmc respuestas')
    expect(s).toContain('#154')
    expect(s).not.toMatch(/["]/)
    expect(isStopPrompt(s)).toBe(true)
  })

  it('reabierto para una respuesta, termina cuando acaba un turno después de abrirse', () => {
    expect(endedTurnSince([{ at: 900, event: 'Stop' }], 1000)).toBe(false)
    expect(endedTurnSince([{ at: 3000, event: 'PreToolUse' }], 1000)).toBe(false)
    expect(endedTurnSince([{ at: 9000, event: 'Stop' }], 1000)).toBe(true)
  })
})

describe('abierta solo para una nota del usuario (EV182)', () => {
  it('lleva la nota con su marca, prohíbe otras tareas, sin caracteres que rompan la orden, y termina en parar', () => {
    const s = notePrompt({ projectName: 'Mission Control', id: 275, body: 'si te escribo "directamente" & estás apartada\r\nactívate 100%' })
    expect(s).toContain('(MC-275)')
    expect(s).toContain('estás apartada actívate')
    expect(s).toContain('No cojas ninguna otra tarea')
    expect(s).not.toMatch(/["%&\r\n]/)
    expect(isStopPrompt(s)).toBe(true)
  })

  it('una nota muy larga se corta y dice dónde está entera', () => {
    const s = notePrompt({ projectName: 'MC', id: 1, body: 'palabra '.repeat(400) })
    expect(s.length).toBeLessThan(2400)
    expect(s).toContain('entera, en lo que te llega al empezar')
  })
})
