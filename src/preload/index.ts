import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('pmc', {
  call: (method: string, ...args: unknown[]) => ipcRenderer.invoke('pmc', method, ...args),
  on: (channel: 'state' | 'assets' | 'model-thumb' | 'ding', cb: (...args: unknown[]) => void) => {
    const listener = (_e: unknown, ...args: unknown[]) => cb(...args)
    ipcRenderer.on(`pmc:${channel}`, listener)
    return () => ipcRenderer.removeListener(`pmc:${channel}`, listener)
  },
  platform: process.platform
})
