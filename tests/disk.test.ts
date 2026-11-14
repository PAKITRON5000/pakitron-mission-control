// 13-11: «Queda poco disco» in red with 111 GB free (6 % of a big disk). Short of space is about gigabytes too.
import { describe, it, expect } from 'vitest'
import { diskLow, diskWords } from '../src/core/disk'

const GB = 1 << 30
describe('disk short of space', () => {
  it('not with 111 GB free of 1.8 TB, nor with plenty; yes under 50 GB and 15 %, or under 15 GB anywhere', () => {
    expect(diskLow(111 * GB, 1863 * GB)).toBe(false)
    expect(diskLow(124 * GB, 1800 * GB)).toBe(false)
    expect(diskLow(40 * GB, 1000 * GB)).toBe(true)
    expect(diskLow(40 * GB, 200 * GB)).toBe(false) // 20 %: still fine
    expect(diskLow(10 * GB, 50 * GB)).toBe(true) // under 15 GB, whatever the share
    expect(diskLow(0, 0)).toBe(false)
    expect(diskWords(111 * GB, 1863 * GB)).toBe('6 % libre, 111 GB')
  })
})
