// Gallery pictures of 3D models. Each model is loaded in its own hidden window (its own process, at low priority), which
// is destroyed afterwards: the app never freezes and all the memory comes back. Time and memory are capped, and a model
// that goes over is remembered so it is not tried again.
import { app, BrowserWindow } from 'electron'
import { writeFileSync } from 'node:fs'
import { constants, freemem, setPriority } from 'node:os'
import { ThumbQueue } from '../core/thumbQueue'

const MAX_MS = 90_000
const MAX_MEMORY_KB = 3 * 1024 * 1024
const MIN_FREE_BYTES = 6 * 1024 ** 3
const REST_MS = 1500
const WAIT_MS = 3000

export interface ModelThumbJob { id: number; name: string; failMark: string }

export interface ModelThumbsDeps {
  preload: string
  /** Opens the app's page at this hash in the given window. */
  open: (w: BrowserWindow, hash: string) => void
  /** False pauses the queue (for example, while the user is in a game and the app is not in front). */
  allowed: () => boolean
  onReady: (id: number) => void
}

export function createModelThumbs(deps: ModelThumbsDeps) {
  let settle: ((ok: boolean) => void) | undefined
  let abort: (() => void) | undefined

  const run = (job: ModelThumbJob) => new Promise<void>((resolve) => {
    const w = new BrowserWindow({
      show: false,
      width: 480,
      height: 360,
      skipTaskbar: true,
      webPreferences: { preload: deps.preload, sandbox: false, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false }
    })
    let pid = 0
    let finished = false
    const end = (outcome: 'ok' | 'failed' | 'stopped') => {
      if (finished) return
      finished = true
      clearTimeout(limit)
      clearInterval(watch)
      settle = abort = undefined
      if (!w.isDestroyed()) w.destroy()
      // A renderer busy parsing would outlive its window for a while: over the limit it goes at once.
      if (outcome !== 'ok' && pid) try { process.kill(pid) } catch { /* already gone */ }
      if (outcome === 'failed') try { writeFileSync(job.failMark, '') } catch { /* it would just be tried again next time */ }
      if (outcome === 'ok') deps.onReady(job.id)
      resolve()
    }
    const limit = setTimeout(() => end('failed'), MAX_MS)
    const watch = setInterval(() => {
      const used = app.getAppMetrics().find((m) => m.pid === pid)?.memory.workingSetSize ?? 0
      if (used > MAX_MEMORY_KB) end('failed')
    }, 1000)
    settle = (ok) => end(ok ? 'ok' : 'failed')
    abort = () => end('stopped')
    w.webContents.once('did-start-loading', () => {
      pid = w.webContents.getOSProcessId()
      try { setPriority(pid, constants.priority.PRIORITY_BELOW_NORMAL) } catch { /* it still works, just less politely */ }
    })
    w.webContents.once('render-process-gone', () => end('failed'))
    w.webContents.once('did-fail-load', () => end('failed'))
    deps.open(w, `/model-thumb/${job.id}/${encodeURIComponent(job.name)}`)
  })

  const queue = new ThumbQueue<ModelThumbJob>({
    key: (job) => job.id,
    run,
    canStart: () => deps.allowed() && freemem() > MIN_FREE_BYTES,
    restMs: REST_MS,
    waitMs: WAIT_MS
  })

  return {
    add: (job: ModelThumbJob) => queue.add(job),
    done: (ok: boolean) => settle?.(ok),
    stop: () => { queue.stop(); abort?.() }
  }
}
