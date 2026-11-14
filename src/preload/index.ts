import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('pmc', {
  call: (method: string, ...args: unknown[]) => ipcRenderer.invoke('pmc', method, ...args),
  on: (channel: 'state' | 'assets' | 'model-thumb' | 'ding' | 'pty' | 'pty-exit' | 'pty-focus', cb: (...args: unknown[]) => void) => {
    const listener = (_e: unknown, ...args: unknown[]) => cb(...args)
    ipcRenderer.on(`pmc:${channel}`, listener)
    return () => ipcRenderer.removeListener(`pmc:${channel}`, listener)
  },
  // EV156: a terminal inside the app. Its screen once, then keys and size one way (no answer awaited: typing stays fast).
  pty: {
    attach: (id: string) => ipcRenderer.invoke('pmc:pty-attach', id),
    detach: (id: string) => ipcRenderer.send('pmc:pty-detach', id),
    input: (id: string, data: string) => ipcRenderer.send('pmc:pty-in', id, data),
    resize: (id: string, cols: number, rows: number) => ipcRenderer.send('pmc:pty-resize', id, cols, rows)
  },
  platform: process.platform
})
