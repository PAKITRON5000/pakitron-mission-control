// What the app on the PC hands its pages points at files as pmc://… (Electron's own scheme). In the phone's browser
// that scheme does not exist, and every picture of a task, a decision or a card came up empty (MC4, the user, 6-11:
// «en la web del móvil no se ven las imágenes en Tareas»). The same files are served over the network at /media/…
// (src/main/remote.ts), so on the phone every such address is rewritten on its way in, whatever screen it is for.

const SCHEME = 'pmc://'

/** The same value with every string that is a pmc:// address turned into its /media/ one, at any depth. */
export function phoneUrls<T>(value: T): T {
  if (typeof value === 'string') return (value.startsWith(SCHEME) ? `/media/${value.slice(SCHEME.length)}` : value) as T
  if (Array.isArray(value)) return value.map((v) => phoneUrls(v)) as T
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = phoneUrls(v)
    return out as T
  }
  return value
}
