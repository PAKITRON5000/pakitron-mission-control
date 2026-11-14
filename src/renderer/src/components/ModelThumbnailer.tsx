// Gallery tiles of 3D models without a picture ask for one. The main process makes them one at a time, away from this
// window (see src/main/modelThumbs.ts), and this tells the tile when its picture is ready.
import { useEffect } from 'react'

export function requestModelThumb(id: number): void {
  void window.pmc.call('queueModelThumb', id)
}

export function ModelThumbnailer() {
  useEffect(() => window.pmc.on('model-thumb', (id) => {
    window.dispatchEvent(new CustomEvent('pmc:model-thumb-ready', { detail: id }))
  }), [])
  return null
}
