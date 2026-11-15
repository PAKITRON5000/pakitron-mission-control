// The notice of a new version on GitHub (core/updates.ts).
import { describe, it, expect } from 'vitest'
import { compareVersions, pickAsset, updateFrom } from '../src/core/updates'

const assets = [
  { name: 'Pakitron.Mission.Control.Setup.0.33.1.exe', browser_download_url: 'https://x/win.exe' },
  { name: 'Pakitron-Mission-Control-0.33.1-mac-arm64.dmg', browser_download_url: 'https://x/arm.dmg' },
  { name: 'Pakitron-Mission-Control-0.33.1-mac-x64.dmg', browser_download_url: 'https://x/intel.dmg' }
]

describe('updates', () => {
  it('compares versions number by number', () => {
    expect(compareVersions('v0.33.10', '0.33.9')).toBe(1)
    expect(compareVersions('0.33.0', '0.33')).toBe(0)
    expect(compareVersions('0.32.49', '0.33.0')).toBe(-1)
  })

  it('picks the installer of this system and processor', () => {
    expect(pickAsset(assets, 'win32', 'x64')).toBe('https://x/win.exe')
    expect(pickAsset(assets, 'darwin', 'arm64')).toBe('https://x/arm.dmg')
    expect(pickAsset(assets, 'darwin', 'x64')).toBe('https://x/intel.dmg')
  })

  it('tells only of a newer, published release', () => {
    const rel = { tag_name: 'v0.33.1', html_url: 'https://x/rel', assets, published_at: '2026-11-14T16:00:00Z' }
    expect(updateFrom(rel, '0.33.0', 'darwin', 'arm64')).toMatchObject({ version: '0.33.1', page: 'https://x/rel', download: 'https://x/arm.dmg' })
    expect(updateFrom(rel, '0.33.1', 'win32', 'x64')).toBeUndefined()
    expect(updateFrom({ ...rel, prerelease: true }, '0.33.0', 'win32', 'x64')).toBeUndefined()
    expect(updateFrom({ message: 'Not Found' }, '0.33.0', 'win32', 'x64')).toBeUndefined()
  })

  it('an Intel build running on an Apple chip is offered the Apple one, even of its own version', () => {
    const rel = { tag_name: 'v0.33.1', html_url: 'https://x/rel', assets }
    expect(updateFrom(rel, '0.33.1', 'darwin', 'x64', true)).toMatchObject({ version: '0.33.1', download: 'https://x/arm.dmg', native: true })
    expect(updateFrom(rel, '0.33.0', 'darwin', 'x64', true)).toMatchObject({ download: 'https://x/arm.dmg' })
    expect(updateFrom(rel, '0.33.0', 'darwin', 'x64', true)?.native).toBeUndefined()
    expect(updateFrom(rel, '0.33.1', 'darwin', 'x64')).toBeUndefined()
    expect(updateFrom(rel, '0.33.2', 'darwin', 'x64', true)).toBeUndefined()
  })
})
