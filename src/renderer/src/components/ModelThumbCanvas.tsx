// The page of the hidden window that pictures one 3D model (src/main/modelThumbs.ts). It draws only once, by hand, and
// tells the main process when it is finished, which then destroys this window and its process.
import { Component, Suspense, useRef, type ReactNode } from 'react'
import { Canvas, type RootState } from '@react-three/fiber'
import * as THREE from 'three'
import { Model, Studio } from './ModelStage'

class Skip extends Component<{ children: ReactNode; onError: () => void }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  componentDidCatch() { this.props.onError() }
  render() { return this.state.failed ? null : this.props.children }
}

export default function ModelThumbCanvas({ id, name }: { id: number; name: string }) {
  const root = useRef<RootState | null>(null)
  const done = useRef(false)
  const ext0 = name.split('.').pop()!.toLowerCase()
  const ext = ext0 === 'blend' ? 'glb' : ext0
  const url = ext0 === 'blend' ? `pmc://converted/${id}` : `pmc://rel/${id}/${encodeURIComponent(name)}`
  const finish = (ok: boolean) => {
    if (done.current) return
    done.current = true
    void window.pmc.call('modelThumbDone', ok)
  }
  const capture = () => {
    // A moment for the textures, which arrive after the model.
    setTimeout(async () => {
      const s = root.current
      if (!s) return finish(false)
      try {
        s.gl.render(s.scene, s.camera)
        await window.pmc.call('saveModelThumb', id, s.gl.domElement.toDataURL('image/jpeg', 0.88))
        finish(true)
      } catch {
        finish(false)
      }
    }, 400)
  }
  if (!['glb', 'gltf', 'fbx', 'obj'].includes(ext)) { setTimeout(() => finish(false), 0); return null }
  return (
    <div style={{ position: 'fixed', left: 0, top: 0, width: 480, height: 360, pointerEvents: 'none' }} aria-hidden>
      <Canvas frameloop="never" dpr={1} camera={{ fov: 38, position: [3, 2, 4] }} gl={{ antialias: true, preserveDrawingBuffer: true, toneMapping: THREE.ACESFilmicToneMapping }}
        onCreated={(s) => { root.current = s; s.scene.background = new THREE.Color('#e9e9ee') }}>
        <Studio />
        <Skip onError={() => finish(false)}>
          <Suspense fallback={null}>
            <Model url={url} ext={ext} mode="solido" animate={false} onInfo={() => {}} onPick={() => {}} picking={false} onReady={capture} />
          </Suspense>
        </Skip>
      </Canvas>
    </div>
  )
}
