import type { DashboardState } from '../../../main/service'
export type { DashboardState }
export type * from '../../../core/types'

declare global {
  interface Window {
    pmc: {
      call: <T = any>(method: string, ...args: unknown[]) => Promise<T>
      on: (channel: 'state' | 'assets' | 'model-thumb' | 'ding', cb: (...args: unknown[]) => void) => () => void
      platform: string
    }
  }
}

export const api = <T = any>(method: string, ...args: unknown[]): Promise<T> => window.pmc.call<T>(method, ...args)
export const onState = (cb: () => void) => window.pmc.on('state', cb)
export const onAssets = (cb: (projectId: string) => void) => window.pmc.on('assets', (p) => cb(p as string))
/** A file of Mission Control: through its own protocol in the app, over the network on the phone. */
export const media = (path: string) => (window.pmc.platform === 'remote' ? `/media/${path}` : `pmc://${path}`)
export const fileUrl = (id: number) => media(`file/${id}`)
export const thumbUrl = (id: number, s = 420) => media(`thumb/${id}?s=${s}`)
