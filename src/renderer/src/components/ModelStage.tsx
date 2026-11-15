// Interactive 3D viewer (three.js + React Three Fiber). GLB/glTF (Draco and meshopt too), FBX and OBJ are loaded straight
// from the original file through pmc://, never copied or modified. Lighting is a procedural studio (RoomEnvironment),
// so nothing is downloaded. Formats it cannot open (.blend) say so instead of pretending.
import { t } from '../../../core/i18n'
import { Component, Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Canvas, useLoader, useThree, type ThreeEvent } from '@react-three/fiber'
import { OrbitControls, Html, Grid, useAnimations } from '@react-three/drei'
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js'
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js'
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js'
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import { Box, RotateCcw, Grid3x3, RefreshCw } from 'lucide-react'
import { media, type Comment } from '../lib/api'

export type ViewMode = 'solido' | 'arcilla' | 'malla' | 'normales'
export interface ModelInfo { triangles: number; meshes: number; materials: number; animations: number }

export function Studio() {
  const { gl, scene } = useThree()
  useEffect(() => {
    const pmrem = new THREE.PMREMGenerator(gl)
    const env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture
    scene.environment = env
    return () => { env.dispose(); pmrem.dispose(); scene.environment = null }
  }, [gl, scene])
  return (
    <>
      <ambientLight intensity={0.25} />
      <directionalLight position={[4, 8, 6]} intensity={1.6} />
    </>
  )
}

export function useModel(url: string, ext: string): { object: THREE.Object3D; clips: THREE.AnimationClip[] } {
  if (ext === 'fbx') {
    const o = useLoader(FBXLoader, url)
    return { object: o, clips: o.animations ?? [] }
  }
  if (ext === 'obj') {
    const o = useLoader(OBJLoader, url)
    return { object: o, clips: [] }
  }
  const g = useLoader(GLTFLoader, url, (loader) => {
    const draco = new DRACOLoader()
    draco.setDecoderPath('./draco/')
    ;(loader as GLTFLoader).setDRACOLoader(draco)
    ;(loader as GLTFLoader).setMeshoptDecoder(MeshoptDecoder)
  })
  return { object: g.scene, clips: g.animations ?? [] }
}

const clay = new THREE.MeshStandardMaterial({ color: '#c9c3bb', roughness: 0.82, metalness: 0 })
const wire = new THREE.MeshBasicMaterial({ color: '#0a84ff', wireframe: true })
const normals = new THREE.MeshNormalMaterial()

/**
 * Box to frame: every mesh except huge flat ones (a ground plane would make the model look tiny and far away).
 */
export function fitBox(object: THREE.Object3D): THREE.Box3 {
  object.updateWorldMatrix(true, true)
  const boxes: THREE.Box3[] = []
  object.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) {
      const b = new THREE.Box3().setFromObject(o)
      if (!b.isEmpty()) boxes.push(b)
    }
  })
  if (!boxes.length) return new THREE.Box3().setFromObject(object)
  const sizes = boxes.map((b) => b.getSize(new THREE.Vector3()))
  const areas = sizes.map((v) => v.x * v.z)
  const median = [...areas].sort((a, b) => a - b)[Math.floor(areas.length / 2)] || 1e-9
  const total = new THREE.Box3()
  boxes.forEach((b, i) => {
    const v = sizes[i]
    const flatHuge = boxes.length > 1 && v.y < 0.03 * Math.max(v.x, v.z) && areas[i] > 25 * median
    if (!flatHuge) total.union(b)
  })
  return total.isEmpty() ? new THREE.Box3().setFromObject(object) : total
}

/** Puts the model on the ground at the origin and the camera close to it, three-quarter view. */
function useFrame3(object: THREE.Object3D, onReady?: () => void) {
  const { camera, controls } = useThree() as any
  const target = useRef(new THREE.Vector3())
  useLayoutEffect(() => {
    if (!object.userData.pmcGrounded) {
      const b = fitBox(object)
      const c = b.getCenter(new THREE.Vector3())
      object.position.x -= c.x
      object.position.z -= c.z
      object.position.y -= b.min.y
      object.userData.pmcGrounded = true
    }
    const box = fitBox(object)
    const size = box.getSize(new THREE.Vector3())
    const center = box.getCenter(new THREE.Vector3())
    target.current.copy(center)
    const maxDim = Math.max(size.x, size.y, size.z) || 1
    const fov = ((camera.fov ?? 38) * Math.PI) / 180
    const dist = (maxDim / 2 / Math.tan(fov / 2)) * 1.3
    camera.position.copy(center.clone().add(new THREE.Vector3(0.95, 0.6, 1.2).normalize().multiplyScalar(dist)))
    camera.near = Math.max(0.001, dist / 300)
    camera.far = dist * 60
    camera.updateProjectionMatrix()
    camera.lookAt(center)
    onReady?.()
  }, [object])
  useEffect(() => {
    if (controls) { controls.target.copy(target.current); controls.update() }
  }, [controls, object])
}

export function Model({ url, ext, mode, animate, onInfo, onPick, picking, onReady }: {
  url: string; ext: string; mode: ViewMode; animate: boolean; onInfo: (i: ModelInfo) => void; onPick: (p: THREE.Vector3) => void; picking: boolean; onReady?: () => void
}) {
  const { object, clips } = useModel(url, ext)
  const originals = useRef(new WeakMap<THREE.Mesh, THREE.Material | THREE.Material[]>())
  const group = useRef<THREE.Group>(null)
  const { actions, names } = useAnimations(clips, group)
  useFrame3(object, onReady)

  useEffect(() => {
    let triangles = 0, meshes = 0
    const mats = new Set<THREE.Material>()
    object.traverse((o) => {
      const m = o as THREE.Mesh
      if (!m.isMesh) return
      meshes++
      const g = m.geometry
      triangles += g.index ? g.index.count / 3 : (g.attributes.position?.count ?? 0) / 3
      for (const x of Array.isArray(m.material) ? m.material : [m.material]) mats.add(x)
    })
    onInfo({ triangles: Math.round(triangles), meshes, materials: mats.size, animations: clips.length })
  }, [object, clips, onInfo])

  useEffect(() => {
    object.traverse((o) => {
      const m = o as THREE.Mesh
      if (!m.isMesh) return
      if (!originals.current.has(m)) originals.current.set(m, m.material)
      m.material = mode === 'solido' ? originals.current.get(m)! : mode === 'arcilla' ? clay : mode === 'malla' ? wire : normals
    })
  }, [object, mode])

  useEffect(() => {
    const a = names[0] ? actions[names[0]] : undefined
    if (!a) return
    if (animate) a.reset().fadeIn(0.2).play()
    else a.fadeOut(0.2)
  }, [animate, actions, names])

  return (
    <group ref={group}>
      <primitive
        object={object}
        onClick={(e: ThreeEvent<MouseEvent>) => { if (picking) { e.stopPropagation(); onPick(e.point.clone()) } }}
        onPointerOver={() => { if (picking) document.body.style.cursor = 'crosshair' }}
        onPointerOut={() => { document.body.style.cursor = '' }}
      />
    </group>
  )
}

function Pin({ p, n, color }: { p: [number, number, number]; n: number; color: string }) {
  return (
    <Html position={p} center zIndexRange={[20, 0]}>
      <div className="w-6 h-6 rounded-full flex items-center justify-center text-[11px] num" style={{ background: color, color: 'white', fontWeight: 700, boxShadow: '0 0 0 2px white, 0 2px 8px rgb(0 0 0 / 0.4)' }}>{n}</div>
    </Html>
  )
}

function Fallback() {
  return (
    <Html center>
      <div className="t-small c2 px-3 py-2 rounded-xl" style={{ background: 'var(--chrome)' }}>{t('Cargando el modelo…')}</div>
    </Html>
  )
}

class Boundary extends Component<{ children: ReactNode; onError: (e: Error) => void }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  componentDidCatch(e: Error) { this.props.onError(e) }
  render() { return this.state.failed ? null : this.props.children }
}

export default function ModelStage({ id, name, picking, comments, draftPoint, onPick }: {
  id: number; name: string; picking: boolean; comments: Comment[]; draftPoint?: [number, number, number]; onPick: (p: [number, number, number]) => void
}) {
  const origExt = name.split('.').pop()!.toLowerCase()
  // .blend: Blender makes a GLB copy in the background (no window); the viewer shows that copy.
  const [converted, setConverted] = useState<'no' | 'working' | 'ok' | 'error'>(origExt === 'blend' ? 'working' : 'no')
  const [convertError, setConvertError] = useState<string>()
  useEffect(() => {
    if (origExt !== 'blend') return
    let alive = true
    setConverted('working')
    ;(window as any).pmc.call('convertModel', id).then(() => alive && setConverted('ok'), (e: Error) => { if (alive) { setConverted('error'); setConvertError(e.message) } })
    return () => { alive = false }
  }, [id, origExt])
  const ext = origExt === 'blend' ? 'glb' : origExt
  const glRef = useRef<THREE.WebGLRenderer | null>(null)
  const shot = useRef(false)
  const [mode, setMode] = useState<ViewMode>('solido')
  const [grid, setGrid] = useState(true)
  const [spin, setSpin] = useState(false)
  const [animate, setAnimate] = useState(false)
  const [info, setInfo] = useState<ModelInfo>()
  const [error, setError] = useState<string>()
  const [key, setKey] = useState(0)
  const dark = document.documentElement.classList.contains('dark')
  const url = useMemo(() => (origExt === 'blend' ? media(`converted/${id}`) : media(`rel/${id}/${encodeURIComponent(name)}`)), [id, name, origExt])
  const supported = ['glb', 'gltf', 'fbx', 'obj'].includes(ext)
  // Gallery thumbnails are made by ModelThumbnailer (light background, close framing), not here.
  // Closing a model lets its memory go: the loader would otherwise keep every model opened until the app closes.
  useEffect(() => () => {
    if (ext === 'fbx') useLoader.clear(FBXLoader, url)
    else if (ext === 'obj') useLoader.clear(OBJLoader, url)
    else useLoader.clear(GLTFLoader, url)
  }, [ext, url])

  if (converted === 'working' || converted === 'error') {
    return (
      <div className="absolute inset-0 flex items-center justify-center p-6">
        <div className="group p-8 max-w-[460px] text-center">
          <Box size={30} className="mx-auto c3" />
          <div className="t-head mt-3">{converted === 'working' ? t('Preparando el modelo con Blender…') : t('Blender no pudo exportar este archivo')}</div>
          <div className="t-small c3 mt-1.5">{converted === 'working' ? t('Se hace una copia en GLB en segundo plano, sin abrir Blender ni tocar el original. La primera vez tarda unos segundos; después es instantáneo.') : convertError}</div>
          {converted === 'working' && <div className="skeleton h-1.5 rounded-full mt-4" />}
        </div>
      </div>
    )
  }
  const pins = comments.filter((c) => c.geom && (c.geom as any).p).map((c, i) => ({ p: (c.geom as any).p as [number, number, number], n: i + 1, color: c.status === 'aprobado' ? '#30D158' : '#FF453A' }))

  if (!supported || error) {
    return (
      <div className="absolute inset-0 flex items-center justify-center p-6">
        <div className="group p-8 max-w-[460px] text-center">
          <Box size={30} className="mx-auto c3" />
          <div className="t-head mt-3">{error ? t('No se pudo abrir este modelo') : t('Los archivos .{ext} no se ven aquí', { ext: ext })}</div>
          <div className="t-small c3 mt-1.5">{error ? error : ext === 'blend' ? t('Ábrelo en Blender. Para verlo aquí, exporta una copia en GLB; el original no se toca.') : t('Formatos que se ven aquí: GLB, glTF, FBX y OBJ.')}</div>
        </div>
      </div>
    )
  }
  return (
    <div className="absolute inset-0">
      <Canvas key={key} onCreated={({ gl }) => { glRef.current = gl }} dpr={[1, 2]} camera={{ fov: 38, position: [3, 2, 4], near: 0.01, far: 2000 }} gl={{ antialias: true, toneMapping: THREE.ACESFilmicToneMapping, preserveDrawingBuffer: true }}>
        <Studio />
        <Boundary onError={(e) => setError(e.message.split('\n')[0])}>
          <Suspense fallback={<Fallback />}>

                <Model url={url} ext={ext} mode={mode} animate={animate} onInfo={setInfo} picking={picking} onPick={(p) => onPick([p.x, p.y, p.z])} />

            {pins.map((p) => <Pin key={p.n} {...p} />)}
            {draftPoint && <Pin p={draftPoint} n={pins.length + 1} color="#0A84FF" />}
          </Suspense>
        </Boundary>
        {grid && <Grid infiniteGrid fadeDistance={14} fadeStrength={2.2} sectionColor={dark ? '#48484a' : '#b8b8bf'} cellColor={dark ? '#2c2c2e' : '#dcdce2'} sectionThickness={1} cellThickness={0.6} sectionSize={1} cellSize={0.25} position={[0, -0.001, 0]} />}
        <OrbitControls makeDefault enableDamping dampingFactor={0.08} autoRotate={spin} autoRotateSpeed={1.2} />
      </Canvas>
      <div className="absolute left-4 bottom-4 flex flex-wrap items-center gap-2">
        <div className="seg" style={{ background: 'var(--chrome)' }}>
          {([['solido', t('Sólido')], ['arcilla', t('Arcilla')], ['malla', t('Malla')], ['normales', t('Normales')]] as const).map(([m, l]) => (
            <button key={m} className={mode === m ? 'on' : ''} onClick={() => setMode(m)}>{mode === m && <div className="seg-thumb" />}<span>{l}</span></button>
          ))}
        </div>
        <button className={`chip ${grid ? 'on' : ''}`} onClick={() => setGrid(!grid)}><Grid3x3 size={13} /> {t('Suelo')}</button>
        <button className={`chip ${spin ? 'on' : ''}`} onClick={() => setSpin(!spin)}><RefreshCw size={13} /> {t('Girar')}</button>
        {info && info.animations > 0 && <button className={`chip ${animate ? 'on' : ''}`} onClick={() => setAnimate(!animate)}>{t('Animación')}</button>}
        <button className="chip" onClick={() => setKey((k) => k + 1)}><RotateCcw size={13} /> {t('Encuadrar')}</button>
      </div>
      {info && (
        <div className="absolute right-4 bottom-4 t-small c2 px-3 py-1.5 rounded-xl num" style={{ background: 'var(--chrome)' }}>
          {t('{v0} triángulos · {meshes} mallas · {materials} materiales{v1}', { v0: info.triangles.toLocaleString('es-ES'), meshes: info.meshes, materials: info.materials, v1: info.animations ? t(' · {animations} animaciones', { animations: info.animations }) : '' })}
        </div>
      )}
      {picking && <div className="absolute left-1/2 top-4 -translate-x-1/2 t-small px-3 py-1.5 rounded-xl" style={{ background: 'var(--accent)', color: 'white' }}>{t('Pulsa sobre el modelo donde quieras comentar')}</div>}
    </div>
  )
}
