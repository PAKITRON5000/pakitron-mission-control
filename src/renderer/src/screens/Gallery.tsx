import { t, tn } from '../../../core/i18n'
import { useEffect, useMemo, useRef, useState } from 'react'
import { ScreenIcon } from '../components/Sidebar'
import { Search, Film, Box, AudioLines, MessageSquare, Images, ChevronRight, RefreshCw, Copy, LayoutGrid, Gamepad2, Palette, FlaskConical, FileText, FolderPlus, PenTool, Play, Pause } from 'lucide-react'
import { useStore, useAsync } from '../lib/store'
import { api, onAssets, thumbUrl, fileUrl, type Asset } from '../lib/api'
import { Segmented, Empty, flashElement } from '../components/ui'
import { requestModelThumb } from '../components/ModelThumbnailer'
import { SoundRow } from '../components/Sound'
import { dayLabel, plural } from '../lib/format'

type Item = Asset & { copies?: number; folder?: string; source?: string }
interface Album { path: string; name: string; parent?: string; n: number; kinds: Record<string, number>; covers: number[]; at: number }
interface HomeGroup { source: string; label: string; hint: string; n: number; albums: Album[]; more: number }
interface Facets { total: number; copies: number; kinds: { kind: string; n: number }[]; categories: { category: string; n: number }[]; sources: { source: string; label: string; hint: string; n: number }[] }
interface FolderView { path: string; crumbs: { path: string; name: string }[]; albums: Album[]; own: number }

const kindCount = (kind: string, n: number): string => kind === 'image' ? tn(n, '{n} imagen', '{n} imágenes') : kind === 'video' ? tn(n, '{n} vídeo', '{n} vídeos') : kind === 'model' ? tn(n, '{n} modelo 3D', '{n} modelos 3D') : kind === 'audio' ? tn(n, '{n} audio', '{n} audios') : ` `
const SOURCE_ICON: Record<string, typeof Images> = { juego: Gamepad2, astra: PenTool, arte: Palette, pruebas: FlaskConical, docs: FileText, otros: FolderPlus }
const SOURCE_COLOR: Record<string, string> = { juego: 'var(--green)', astra: 'var(--pink)', arte: 'var(--purple)', pruebas: 'var(--blue)', docs: 'var(--gray)', otros: 'var(--orange)' }
const es = (n: number) => n.toLocaleString('es-ES')

/** A file's name for people: no extension, spaces for the dashes, a capital. */
export function prettyName(name: string): string {
  const s = name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim()
  return s ? s[0].toUpperCase() + s.slice(1) : name
}

const kindsText = (k: Record<string, number>) => Object.entries(k).sort((a, b) => b[1] - a[1]).map(([x, n]) => kindCount(x, n)).join(' · ')

function folderLabel(folder: string | undefined, crumbs: Map<string, string>): string {
  if (!folder) return t('Sueltas')
  return crumbs.get(folder) ?? folder.split('/').map((p) => p.replace(/^_+/, '').replace(/[_-]+/g, ' ')).slice(-2).join(' › ')
}

export function Tile({ a, onOpen, size, caption }: { a: Item; onOpen: () => void; size?: number; caption?: boolean }) {
  const [failed, setFailed] = useState(false)
  const [v, setV] = useState(0)
  const [hover, setHover] = useState(false)
  const timer = useRef<number | undefined>(undefined)
  // 3D models have no Windows thumbnail: ask for one to be rendered, and show it when it is ready.
  useEffect(() => {
    if (a.kind !== 'model') return
    const on = (e: Event) => { if ((e as CustomEvent).detail === a.id) { setFailed(false); setV(Date.now()) } }
    window.addEventListener('pmc:model-thumb-ready', on)
    return () => window.removeEventListener('pmc:model-thumb-ready', on)
  }, [a.id, a.kind])
  useEffect(() => () => window.clearTimeout(timer.current), [])
  const Icon = a.kind === 'video' ? Film : a.kind === 'model' ? Box : a.kind === 'audio' ? AudioLines : Images
  const where = a.folder?.split('/').pop()?.replace(/^_+/, '').replace(/[_-]+/g, ' ')
  return (
    <div className="gal-item min-w-0">
      <button id={`asset-${a.id}`} className="tile p-0 border-0 aspect-[4/3] group w-full block" onClick={onOpen} title={`${a.name}\n${a.rel}`}
        onMouseEnter={() => { if (a.kind === 'video') timer.current = window.setTimeout(() => setHover(true), 260) }}
        onMouseLeave={() => { window.clearTimeout(timer.current); setHover(false) }}>
        {hover && a.kind === 'video' && <video src={fileUrl(a.id)} autoPlay muted loop playsInline className="absolute inset-0 w-full h-full object-cover z-[1]" />}
        {!failed ? (
          <img src={thumbUrl(a.id, size ?? 420) + (v ? `&v=${v}` : '')} loading="lazy" decoding="async" alt={a.name} onError={() => { setFailed(true); if (a.kind === 'model') requestModelThumb(a.id) }} />
        ) : (
          <div className="w-full h-full flex flex-col items-center justify-center gap-2 c3">
            <Icon size={26} />
            {!caption && <span className="t-small px-3 truncate max-w-full">{a.name}</span>}
          </div>
        )}
        {a.kind !== 'image' && !failed && (
          <span className="absolute left-2 top-2 pill z-[2]" style={{ background: 'rgb(0 0 0 / 0.55)', color: 'white', backdropFilter: 'blur(8px)' }}><Icon size={12} /></span>
        )}
        {(a.openComments ?? 0) > 0 && (
          <span className="absolute right-2 top-2 pill num z-[2]" style={{ background: 'var(--orange)', color: 'white' }}><MessageSquare size={11} /> {a.openComments}</span>
        )}
        {!caption && <span className="absolute inset-x-0 bottom-0 px-2.5 py-1.5 t-small text-left truncate opacity-0 group-hover:opacity-100 transition-opacity z-[2]" style={{ background: 'linear-gradient(transparent, rgb(0 0 0 / 0.65))', color: 'white' }}>{a.name}</span>}
      </button>
      {caption && (
        <div className="px-0.5 pt-1.5 pb-1 min-w-0">
          <div className="t-small truncate" style={{ fontWeight: 560 }} title={a.name}>{prettyName(a.name)}</div>
          <div className="t-small c3 truncate" title={a.rel}>{where || a.category}{(a.copies ?? 1) > 1 ? <span title={t('Este archivo está igual en {copies} copias del proyecto', { copies: a.copies })}> · <Copy size={10} className="inline -mt-0.5" /> {a.copies}</span> : null}</div>
        </div>
      )}
    </div>
  )
}

/** A sound in the grid: it plays right there, without opening anything. */
function SoundTile({ a, onOpen }: { a: Item; onOpen: () => void }) {
  const ref = useRef<HTMLAudioElement>(null)
  const [on, setOn] = useState(false)
  return (
    <div className="gal-item min-w-0">
      <div className="tile aspect-[4/3] w-full flex items-center justify-center" id={`asset-${a.id}`} style={{ background: 'linear-gradient(135deg, color-mix(in srgb, var(--purple) 30%, var(--fill)), var(--fill))' }}>
        <audio ref={ref} src={fileUrl(a.id)} preload="none" onPlay={() => { document.querySelectorAll('audio').forEach((x) => { if (x !== ref.current) x.pause() }); setOn(true) }} onPause={() => setOn(false)} onEnded={() => setOn(false)} />
        <button className="w-12 h-12 rounded-full border-0 flex items-center justify-center" style={{ background: 'var(--accent)', color: 'white' }} aria-label={on ? t('Pausa') : t('Escuchar')} onClick={() => { const el = ref.current; if (el) { if (el.paused) void el.play(); else el.pause() } }}>
          {on ? <Pause size={19} fill="currentColor" /> : <Play size={19} fill="currentColor" style={{ marginLeft: 2 }} />}
        </button>
      </div>
      <button className="px-0.5 pt-1.5 pb-1 min-w-0 w-full text-left border-0 bg-transparent" onClick={onOpen} title={a.rel}>
        <div className="t-small truncate" style={{ fontWeight: 560 }}>{prettyName(a.name)}</div>
        <div className="t-small c3 truncate">{a.folder?.split('/').pop()?.replace(/[_-]+/g, ' ') || t('Audio')}</div>
      </button>
    </div>
  )
}

function AlbumCard({ al, onOpen }: { al: Album; onOpen: () => void }) {
  const covers = al.covers
  return (
    <button className="album text-left border-0 bg-transparent p-0 min-w-0" onClick={onOpen} title={al.path}>
      <div className={`album-cover ${covers.length >= 4 ? 'four' : ''}`}>
        {covers.length ? (covers.length >= 4 ? covers.slice(0, 4) : covers.slice(0, 1)).map((id) => <img key={id} src={thumbUrl(id, 320)} alt="" loading="lazy" decoding="async" onError={(e) => { e.currentTarget.style.visibility = 'hidden' }} />)
          : <div className="w-full h-full flex items-center justify-center c3"><AudioLines size={30} /></div>}
      </div>
      <div className="pt-2 px-0.5 min-w-0">
        <div className="t-body truncate" style={{ fontWeight: 600 }}>{al.name}</div>
        {al.parent && <div className="t-small c3 truncate">{al.parent}</div>}
        <div className="t-small c3 truncate">{kindsText(al.kinds)}</div>
      </div>
    </button>
  )
}

export function Gallery() {
  const { state, setViewer, focus, clearFocus } = useStore()
  const pid = state?.activeProjectId
  const [want, setWant] = useState<number>()
  const [kind, setKind] = useState('')
  const [cat, setCat] = useState('')
  const [source, setSource] = useState('')
  const [folder, setFolder] = useState('')
  const [status, setStatus] = useState('')
  const [q, setQ] = useState('')
  const [dq, setDq] = useState('')
  const [size, setSize] = useState<'s' | 'm' | 'l'>('m')
  const [order, setOrder] = useState<'fecha' | 'carpeta' | 'nombre'>('fecha')
  const [all, setAll] = useState(false)
  const [items, setItems] = useState<Item[]>([])
  const [total, setTotal] = useState(0)
  const [groupsN, setGroupsN] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(false)
  const [reload, setReload] = useState(0)
  const [fresh, setFresh] = useState(false)
  const [seeFiles, setSeeFiles] = useState(false)
  const sentinel = useRef<HTMLDivElement>(null)
  const top = useRef<HTMLDivElement>(null)

  // Arriving from a search: the gallery shows what was searched and the picture glows.
  useEffect(() => {
    if (focus?.kind !== 'asset') return
    setKind(''); setCat(''); setStatus(''); setSource(''); setFolder('')
    setQ(focus.q ?? ''); setDq(focus.q ?? '')
    setWant(focus.id >= 0 ? focus.id : undefined)
    setSeeFiles(true)
    clearFocus()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus?.n])

  useEffect(() => { const t = setTimeout(() => setDq(q), 220); return () => clearTimeout(t) }, [q])
  // New files never move the list under the user's feet: they are offered, and come in when he wants.
  useEffect(() => onAssets((p) => { if (p === pid) setFresh(true) }), [pid])

  const filtered = Boolean(cat || source || folder || status || dq)
  const landing = !filtered && !seeFiles
  const query = useMemo(() => ({ projectId: pid, kind: kind || undefined, category: cat || undefined, source: source || undefined, folder: folder || undefined, text: dq || undefined, status: status || undefined, unique: !all, order }), [pid, kind, cat, source, folder, dq, status, all, order])
  const facets = useAsync(() => (pid ? api<Facets>('assetFacets', query) : Promise.resolve(undefined)), [query, state?.refreshedAt?.media])
  const home = useAsync(() => (pid && landing ? api<HomeGroup[]>('galleryHome', { projectId: pid, kind: kind || undefined }) : Promise.resolve(undefined)), [pid, kind, landing, state?.refreshedAt?.media])
  const view = useAsync(() => (pid && (source || folder) ? api<FolderView>('assetFolder', query) : Promise.resolve(undefined)), [query, state?.refreshedAt?.media])

  useEffect(() => {
    if (!pid) return
    let alive = true
    setLoading(true)
    setFresh(false)
    api<{ items: Item[]; total: number; groups: Record<string, number> }>('assets', { ...query, offset: 0, limit: landing ? 18 : 120 }).then((r) => {
      if (!alive) return
      setItems(r.items)
      setTotal(r.total)
      setGroupsN(r.groups)
      setLoading(false)
    })
    return () => { alive = false }
  }, [query, reload, pid, landing])

  useEffect(() => {
    const el = sentinel.current
    if (!el || landing) return
    // The list scrolls inside the app's content area: that is the frame to look from, or the margin does nothing.
    let root: HTMLElement | null = el.parentElement
    while (root && !/(auto|scroll)/.test(getComputedStyle(root).overflowY)) root = root.parentElement
    const io = new IntersectionObserver((es) => {
      if (es[0].isIntersecting && !loading && items.length < total) {
        setLoading(true)
        api<{ items: Item[]; total: number; groups: Record<string, number> }>('assets', { ...query, offset: items.length, limit: 120 }).then((r) => {
          setItems((prev) => {
            const have = new Set(prev.map((x) => x.id))
            return [...prev, ...r.items.filter((x) => !have.has(x.id))]
          })
          setTotal(r.total)
          setGroupsN(r.groups)
          setLoading(false)
        })
      }
    }, { root, rootMargin: '1400px' })
    io.observe(el)
    return () => io.disconnect()
  }, [items.length, total, loading, query, landing])

  useEffect(() => {
    if (want == null || !items.some((a) => a.id === want)) return
    flashElement(`asset-${want}`)
    setWant(undefined)
  }, [items, want])

  const crumbsMap = useMemo(() => new Map((view.data?.albums ?? []).map((a) => [a.path, a.parent ? `${a.parent} › ${a.name}` : a.name])), [view.data])
  const groups = useMemo(() => {
    const m = new Map<string, Item[]>()
    for (const a of items) {
      const d = new Date(a.mtime)
      const pad = (n: number) => String(n).padStart(2, '0')
      const k = order === 'carpeta' ? a.folder ?? '' : order === 'nombre' ? (a.name[0] ?? '#').toUpperCase() : `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
      if (!m.has(k)) m.set(k, [])
      m.get(k)!.push(a)
    }
    return [...m.entries()]
  }, [items, order])
  const min = size === 's' ? 150 : size === 'm' ? 220 : 340
  const grid = { gridTemplateColumns: `repeat(auto-fill, minmax(${min}px, 1fr))` }
  const list = items.map((x) => x.id)
  const open = (a: Item, ids = list) => setViewer(a.id, ids)
  const clear = () => { setCat(''); setSource(''); setFolder(''); setStatus(''); setQ(''); setDq(''); setSeeFiles(false); top.current?.scrollIntoView() }
  const openAlbum = (src: string, path: string) => { setSource(src); setCat(''); setFolder(path); setOrder('fecha'); top.current?.scrollIntoView() }

  const f = facets.data
  const countKind = (k: string) => f?.kinds.find((x) => x.kind === k)?.n ?? 0
  const KINDS = [
    { value: '', label: t('Todo{v0}', { v0: f ? ' · ' + es(f.kinds.reduce((s, x) => s + x.n, 0)) : '' }) },
    { value: 'image', label: t('Imágenes · {v0}', { v0: es(countKind('image')) }) },
    { value: 'video', label: t('Vídeos · {v0}', { v0: es(countKind('video')) }) },
    { value: 'model', label: t('Modelos 3D · {v0}', { v0: es(countKind('model')) }) },
    { value: 'audio', label: t('Audio · {v0}', { v0: es(countKind('audio')) }) }
  ]
  const srcLabel = f?.sources.find((s) => s.source === source)?.label ?? ''
  const title = dq ? t('Buscando «{dq}»', { dq: dq }) : folder ? view.data?.crumbs[view.data.crumbs.length - 1]?.name ?? t('Carpeta') : source ? srcLabel : cat || (status === 'comentados' ? t('Con notas abiertas') : status === 'duplicados' ? t('Repetidos') : seeFiles ? t('Todo, lo último primero') : t('Galería'))
  const onlySound = kind === 'audio'

  return (
    <div className="gal-shell">
      <aside className="gal-rail">
        <button className={`gal-rail-row ${!filtered && !seeFiles ? 'on' : ''}`} onClick={clear}>
          <span className="icon-sq" style={{ background: 'var(--accent)' }}><LayoutGrid size={13} /></span>
          <span className="flex-1 truncate">{t('Inicio de la galería')}</span>
        </button>
        <button className={`gal-rail-row ${!filtered && seeFiles ? 'on' : ''}`} onClick={() => { clear(); setSeeFiles(true); setOrder('fecha') }}>
          <span className="icon-sq" style={{ background: 'var(--gray)' }}><Images size={13} /></span>
          <span className="flex-1 truncate">{t('Todo')}</span>
        </button>
        <div className="t-micro c3 px-2 pt-4 pb-1">{t('De dónde sale')}</div>
        {(f?.sources ?? []).map((s) => {
          const Icon = SOURCE_ICON[s.source] ?? FolderPlus
          return (
            <button key={s.source} className={`gal-rail-row ${source === s.source && !folder ? 'on' : ''}`} title={s.hint} onClick={() => { setSource(source === s.source && !folder ? '' : s.source); setFolder(''); setCat(''); setSeeFiles(false); top.current?.scrollIntoView() }}>
              <span className="icon-sq" style={{ background: SOURCE_COLOR[s.source] }}><Icon size={13} /></span>
              <span className="flex-1 truncate">{s.label}</span>
              <span className="num c3 t-small">{es(s.n)}</span>
            </button>
          )
        })}
        <div className="t-micro c3 px-2 pt-4 pb-1">{t('Qué es')}</div>
        {(f?.categories ?? []).map((c) => (
          <button key={c.category} className={`gal-rail-row ${cat === c.category ? 'on' : ''}`} onClick={() => { setCat(cat === c.category ? '' : c.category); setFolder(''); setSource(''); setSeeFiles(false); setOrder('carpeta'); top.current?.scrollIntoView() }}>
            <span className="flex-1 truncate pl-1">{c.category}</span>
            <span className="num c3 t-small">{es(c.n)}</span>
          </button>
        ))}
        <div className="t-micro c3 px-2 pt-4 pb-1">{t('Más')}</div>
        <button className={`gal-rail-row ${status === 'comentados' ? 'on' : ''}`} onClick={() => setStatus(status === 'comentados' ? '' : 'comentados')}><span className="flex-1 truncate pl-1">{t('Con notas abiertas')}</span></button>
        <button className={`gal-rail-row ${all ? 'on' : ''}`} title={t('El mismo archivo suele estar en varias copias del proyecto; normalmente se enseña una vez')} onClick={() => setAll(!all)}>
          <span className="flex-1 truncate pl-1">{t('Ver también las copias iguales')}</span>
          {!all && f?.copies ? <span className="num c3 t-small">{es(f.copies)}</span> : null}
        </button>
      </aside>

      <div className="gal-main">
        <div ref={top} />
        <div className="flex flex-wrap items-end gap-3 mb-3">
          <div className="min-w-0">
            {(folder || source) && (
              <div className="flex items-center gap-1 t-small c3 mb-1 flex-wrap">
                <button className="border-0 bg-transparent p-0 c3 hover:underline" onClick={clear}>{t('Galería')}</button>
                {source && <><ChevronRight size={12} /><button className="border-0 bg-transparent p-0 c3 hover:underline" onClick={() => setFolder('')}>{srcLabel}</button></>}
                {(view.data?.crumbs ?? []).map((c) => <span key={c.path} className="flex items-center gap-1"><ChevronRight size={12} /><button className="border-0 bg-transparent p-0 c3 hover:underline" onClick={() => setFolder(c.path)}>{c.name}</button></span>)}
              </div>
            )}
            <h1 className="t-display truncate flex items-center gap-3"><ScreenIcon route="galeria" /><span className="truncate">{title}</span></h1>
            <div className="t-small c3 mt-1 num">
              {landing ? t('{v0} archivos distintos · {v1} copias iguales no se repiten', { v0: es(f?.total ?? 0), v1: es(f?.copies ?? 0) }) : `${es(total)} ${total === 1 ? 'archivo' : 'archivos'}${f?.sources.find((s) => s.source === source)?.hint && !folder ? ' · ' + f!.sources.find((s) => s.source === source)!.hint : ''}`}
            </div>
          </div>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 c3" />
              <input className="field pl-8 w-64" placeholder={t('Busca en todo: «racha águila», «castle»…')} value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
            <Segmented value={size} onChange={setSize} options={[{ value: 's', label: 'S' }, { value: 'm', label: 'M' }, { value: 'l', label: 'L' }]} />
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 mb-5">
          <Segmented value={kind} onChange={setKind} options={KINDS} />
          {!landing && <Segmented value={order} onChange={setOrder} options={[{ value: 'fecha', label: t('Por fecha') }, { value: 'carpeta', label: t('Por carpeta') }, { value: 'nombre', label: t('Por nombre') }]} />}
          {fresh && <button className="btn btn-sm btn-primary ml-auto" onClick={() => { setReload((r) => r + 1); top.current?.scrollIntoView() }}><RefreshCw size={13} /> {t('Hay archivos nuevos')}</button>}
        </div>

        {/* EV118: an empty gallery says why and what to do, instead of blank sections. */}
        {landing && f && !f.total && (
          <div className="card p-6 flex flex-col items-center text-center gap-2 mb-8">
            <b className="t-head">{t('Aún no hay imágenes, vídeos ni modelos en este proyecto')}</b>
            <span className="t-small c3 max-w-[560px]">{t('Aparecen solos cuando los Claude los crean en la carpeta del proyecto. Si están en otra carpeta, añádela en Ajustes › Proyecto › Carpetas de la galería.')}</span>
          </div>
        )}
        {landing && Boolean(f?.total) && (
          <>
            <section className="mb-8">
              <div className="flex items-baseline gap-3 mb-2.5">
                <h2 className="t-title">{t('Lo más nuevo')}</h2>
                <button className="btn btn-sm btn-ghost" onClick={() => setSeeFiles(true)}>{t('Ver todo por fecha')} <ChevronRight size={13} /></button>
              </div>
              <div className="grid gap-2" style={grid}>
                {items.slice(0, size === 's' ? 18 : 12).map((a) => a.kind === 'audio' ? <SoundTile key={a.id} a={a} onOpen={() => open(a)} /> : <Tile key={a.id} a={a} caption={size !== 's'} onOpen={() => open(a)} size={size === 'l' ? 640 : 420} />)}
              </div>
            </section>
            {(home.data ?? []).map((g) => {
              const Icon = SOURCE_ICON[g.source] ?? FolderPlus
              return (
                <section key={g.source} className="mb-9">
                  <div className="flex items-center gap-2.5 mb-1">
                    <span className="icon-sq" style={{ background: SOURCE_COLOR[g.source] }}><Icon size={13} /></span>
                    <h2 className="t-title">{g.label}</h2>
                    <span className="t-small c3 num">{es(g.n)}</span>
                    <button className="btn btn-sm btn-ghost ml-auto" onClick={() => { setSource(g.source); setFolder('') }}>{g.more ? t('Ver sus {v0} carpetas', { v0: g.albums.length + g.more }) : t('Abrir')} <ChevronRight size={13} /></button>
                  </div>
                  <div className="t-small c3 mb-3">{g.hint}</div>
                  <div className="grid gap-x-3 gap-y-4" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))' }}>
                    {g.albums.map((al) => <AlbumCard key={al.path} al={al} onOpen={() => openAlbum(g.source, al.path)} />)}
                  </div>
                </section>
              )
            })}
          </>
        )}

        {!landing && (view.data?.albums.length ?? 0) > 0 && !dq && (
          <section className="mb-8">
            <h2 className="t-head mb-2.5">{t('Carpetas')} <span className="t-small c3 num">· {view.data!.albums.length}</span></h2>
            <div className="grid gap-x-3 gap-y-4" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))' }}>
              {view.data!.albums.map((al) => <AlbumCard key={al.path} al={al} onOpen={() => openAlbum(source, al.path)} />)}
            </div>
          </section>
        )}

        {!landing && !loading && items.length === 0 && <Empty icon={<Images size={28} />} title={t('Nada que mostrar')} text={t('No hay archivos con estos filtros. Prueba a quitar alguno, o añade una carpeta en Ajustes › Proyecto.')} />}
        {!landing && groups.map(([k, g]) => {
          const label = order === 'carpeta' ? folderLabel(k, crumbsMap) : order === 'nombre' ? k : dayLabel(g[0].mtime)
          const n = order === 'nombre' ? g.length : groupsN[k] ?? g.length
          return (
            <section key={k} className="mb-7">
              <div className="t-head mb-2.5 flex items-baseline gap-2">
                {order === 'carpeta' && k ? <button className="border-0 bg-transparent p-0 t-head hover:underline text-left" onClick={() => { const s = g[0].source ?? ''; openAlbum(s, k) }}>{label}</button> : <span>{label}</span>}
                <span className="t-small c3 num">· {g.length < n ? t('{shown} de {total}', { shown: es(g.length), total: es(n) }) : es(n)}</span>
              </div>
              {onlySound ? (
                <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))' }}>
                  {g.map((a) => <div key={a.id} id={`asset-${a.id}`}><SoundRow src={fileUrl(a.id)} caption={prettyName(a.name)} sub={a.folder?.split('/').slice(-2).join(' › ')} /></div>)}
                </div>
              ) : (
                <div className="grid gap-2" style={grid}>
                  {g.map((a) => a.kind === 'audio' ? <SoundTile key={a.id} a={a} onOpen={() => open(a)} /> : <Tile key={a.id} a={a} caption={size !== 's'} onOpen={() => open(a)} size={size === 'l' ? 640 : 420} />)}
                </div>
              )}
            </section>
          )
        })}
        <div ref={sentinel} className="h-10" />
        {!landing && loading && <div className="grid gap-2" style={grid}>{Array.from({ length: 12 }).map((_, i) => <div key={i} className="skeleton aspect-[4/3] rounded-xl" />)}</div>}
        {!landing && !loading && items.length > 0 && items.length >= total && <div className="t-small c3 text-center py-6">{t('Eso es todo: {v0}.', { v0: tn(total, '{n} archivo', '{n} archivos') })}</div>}
      </div>
    </div>
  )
}
