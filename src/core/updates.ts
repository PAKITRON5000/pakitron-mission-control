// A new version on GitHub (the user, 14-11: «molaría que le avise dentro de la app de que hay una nueva update»). The
// app asks GitHub for the latest release of its public repository now and then (no data of the user goes with it) and,
// when it is newer than the one installed, the bar shows it with the installer for this system. Installing over the
// old version keeps everything: the data live in their own folder (core/paths.ts), not with the program.

export const RELEASES_REPO = 'PAKITRON5000/pakitron-mission-control'
export const LATEST_URL = `https://api.github.com/repos/${RELEASES_REPO}/releases/latest`

export interface UpdateInfo {
  version: string
  /** The release page, with its notes. */
  page: string
  /** The installer for this system and processor, when the release has one. */
  download?: string
  publishedAt?: number
}

/** -1, 0 or 1, number by number («0.33.10» is newer than «0.33.9»); a leading «v» and anything after «-» are ignored. */
export function compareVersions(a: string, b: string): number {
  const parts = (v: string) => v.trim().replace(/^v/i, '').split('-')[0].split('.').map((n) => Number.parseInt(n, 10) || 0)
  const x = parts(a), y = parts(b)
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] ?? 0) - (y[i] ?? 0)
    if (d) return d > 0 ? 1 : -1
  }
  return 0
}

/** The installer of a release for this system: the .exe on Windows, the .dmg of this processor on a Mac. */
export function pickAsset(assets: { name: string; browser_download_url: string }[], platform: string, arch: string): string | undefined {
  const by = (re: RegExp) => assets.find((a) => re.test(a.name))?.browser_download_url
  if (platform === 'win32') return by(/\.exe$/i)
  if (platform === 'darwin') return by(arch === 'arm64' ? /arm64.*\.dmg$/i : /x64.*\.dmg$/i) ?? by(/\.dmg$/i)
  return by(/\.AppImage$/i)
}

/** What GitHub's «latest release» answer says, when it is newer than `current`; undefined otherwise. */
export function updateFrom(release: any, current: string, platform: string, arch: string): UpdateInfo | undefined {
  const tag = typeof release?.tag_name === 'string' ? release.tag_name : ''
  if (!tag || release.draft || release.prerelease || compareVersions(tag, current) <= 0) return undefined
  const at = Date.parse(release.published_at ?? '')
  return {
    version: tag.replace(/^v/i, ''),
    page: typeof release.html_url === 'string' ? release.html_url : `https://github.com/${RELEASES_REPO}/releases/latest`,
    download: pickAsset(Array.isArray(release.assets) ? release.assets : [], platform, arch),
    ...(Number.isFinite(at) ? { publishedAt: at } : {})
  }
}
