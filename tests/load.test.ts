import { describe, expect, it } from 'vitest'
import { doingOf, loadText, machineLoad, type Load } from '../src/core/resources'

describe('who loads the machine (EV112)', () => {
  const load: Load = {
    cpuPct: 64, freeMb: 11 * 1024, totalMb: 31 * 1024, cores: 32,
    procs: [
      { name: 'ffmpeg.exe', pid: 1, cpuPct: 12.5, ramMb: 549, account: 'claude5', cmd: 'ffmpeg -i a.mp4 b.mp4' },
      { name: 'python.exe', pid: 2, cpuPct: 0.5, ramMb: 2268, account: 'claude', cmd: 'python.exe fotos_peak.py mediterraneo' },
      { name: 'cam_helper.exe', pid: 3, cpuPct: 3, ramMb: 19, cmd: '' },
    ],
  }

  it('names each process with its Claude, what it does and what it takes', () => {
    const t = loadText(load)
    expect(t).toContain('Procesador al 64 %, memoria 20,0 de 31 GB')
    expect(t).toContain('Claude 5: ffmpeg (convirtiendo o exportando vídeo, 4 de 32 núcleos)')
    expect(t).toContain('un Claude: python (ejecutando fotos_peak.py, 2,2 GB)')
    expect(t).toContain('el PC: cam_helper (1 de 32 núcleos)')
  })

  it('says what a process does from its name', () => {
    expect(doingOf({ name: 'Adobe Media Encoder.exe', cmd: '' })).toBe('exportando vídeo (Media Encoder)')
    expect(doingOf({ name: 'python.exe', cmd: 'python' })).toBe('un programa de Python')
  })

  it('reads nothing when Windows cannot be asked: never a guess', () => {
    expect(machineLoad(() => { throw new Error('no powershell') })).toBeUndefined()
    expect(machineLoad(() => 'not json')).toBeUndefined()
  })
})
