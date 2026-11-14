// 13-11: «B:\Video App» was taken for a folder of Video («B:\Video»): its requests went to the wrong project.
import { describe, it, expect } from 'vitest'
import { isInside } from '../src/core/projects'

describe('a folder inside another', () => {
  it('is the folder itself or something under it, never one that only starts the same', () => {
    expect(isInside('B:\\Video App', 'b:\\video')).toBe(false)
    expect(isInside('B:\\Video', 'b:\\video')).toBe(true)
    expect(isInside('B:\\Video\\video', 'B:\\Video\\')).toBe(true)
    expect(isInside('C:/Users/ana/Downloads/Juego/.claude/worktrees/rachas', 'C:\\Users\\ana\\Downloads\\Juego')).toBe(true)
    expect(isInside('C:\\Users\\ana\\Downloads\\JuegoGY', 'C:\\Users\\ana\\Downloads\\Juego')).toBe(false)
    expect(isInside('C:\\x', '')).toBe(false)
  })
})
