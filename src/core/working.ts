import type { LiveSession } from './types'

/**
 * Does this session have work under way? An idle one is a window left open, and a background one marked «blocked»
 * finished its turn and waits for a message: `claude agents` keeps listing those for days. No node imports: the screens use it too.
 */
export function isSessionWorking(s: Pick<LiveSession, 'status' | 'state' | 'kind'>): boolean {
  if (s.status === 'idle' || s.state === 'done') return false
  return !(s.kind === 'background' && s.state === 'blocked')
}
