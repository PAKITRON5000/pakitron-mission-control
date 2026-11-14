// The card that gets Mission Control onto the phone, in the fewest steps there can be. What it can do by itself, it does.
import { useEffect, useState } from 'react'
import { Smartphone } from 'lucide-react'
import { api } from '../lib/api'
import { useStore } from '../lib/store'
import { playDing, TONES } from '../lib/ding'

interface Status { installed: boolean; running: boolean; url?: string; qr?: string; problem?: string }

/** The notice on this PC: which tone, how loud. The phone's sound is the phone's own. */
export function NoticeSettings() {
  const { state, refresh } = useStore()
  const tone = state?.settings?.notifyTone ?? 'campana'
  const volume = state?.settings?.notifyVolume ?? 70
  const set = (patch: Record<string, unknown>) => api('setSettings', patch).then(() => refresh())
  return (
    <div className="group p-5 mb-6">
      <div className="t-head">Aviso cuando hay algo que mirar</div>
      <div className="flex flex-wrap gap-2 mt-3">
        {TONES.map((t) => (
          <button key={t.id} className={`chip ${tone === t.id ? 'on' : ''}`} onClick={() => { void set({ notifyTone: t.id }); playDing(t.id, volume) }}>{t.label}</button>
        ))}
      </div>
      <label className="flex items-center gap-3 mt-4 t-small c2">
        Volumen
        <input type="range" min={0} max={100} step={5} value={volume} className="flex-1 max-w-[320px]" onChange={(e) => void set({ notifyVolume: Number(e.target.value) })} onPointerUp={(e) => playDing(tone, Number((e.target as HTMLInputElement).value))} />
        <span className="num w-9 text-right">{volume}</span>
      </label>
      <label className="flex items-center gap-2 mt-4 t-small c2">
        <input type="checkbox" checked={Boolean(state?.settings?.quietNights)} onChange={(e) => void set({ quietNights: e.target.checked })} />
        Silencio de noche: de 0:00 a 9:00 solo parpadea
      </label>
      <p className="t-small c3 mt-3">Suena cuando un Claude te espera o termina, y cuando hay algo nuevo que revisar. Además, el icono parpadea en la barra de tareas hasta que abras la app. Mientras juegas solo parpadea, sin sonido ni ventanas.</p>
    </div>
  )
}

export function PhoneSetup() {
  const [s, setS] = useState<Status>()
  useEffect(() => {
    let alive = true
    const read = () => api<Status>('remoteStatus').then((r) => { if (alive) setS(r) }).catch(() => undefined)
    void read()
    const t = setInterval(read, 8000)
    return () => { alive = false; clearInterval(t) }
  }, [])
  if (!s) return null
  return (
    <div className="group p-5 mb-6">
      <div className="flex items-center gap-2 t-head"><Smartphone size={18} /> En el móvil</div>
      {!s.installed && <p className="t-small c2 mt-2">Falta Tailscale en este PC: es lo que conecta el móvil con él desde cualquier sitio, sin abrir nada a internet. Instálalo desde tailscale.com/download y vuelve aquí.</p>}
      {s.installed && !s.running && (
        <>
          <p className="t-small c2 mt-2">Inicia sesión en Tailscale en este PC, con la cuenta que quieras (Google vale). Usarás la misma en el móvil.</p>
          <button className="btn btn-primary mt-3" onClick={() => void api('remoteLogin')}>Iniciar sesión</button>
        </>
      )}
      {s.running && s.url && (
        <div className="flex flex-wrap gap-5 mt-3 items-start">
          {s.qr && <img src={s.qr} alt="Código QR de la app" width={170} height={170} style={{ borderRadius: 12 }} />}
          <ol className="t-small c2 flex-1 min-w-[240px]" style={{ listStyle: 'decimal', paddingLeft: 18, lineHeight: 1.8 }}>
            <li>Instala <b>Tailscale</b> en el iPhone desde la App Store e inicia sesión con la misma cuenta.</li>
            <li>Escanea este código con la cámara y ábrelo en Safari.</li>
            <li>Pulsa <b>Compartir</b> y <b>Añadir a pantalla de inicio</b>.</li>
            <li>Ábrela desde su icono y toca el aviso para activar las notificaciones.</li>
            <li className="c3" style={{ listStyle: 'none', marginTop: 6 }}>{s.url}</li>
          </ol>
        </div>
      )}
      {s.problem && <p className="t-small mt-3" style={{ color: 'var(--orange)' }}>{s.problem}</p>}
    </div>
  )
}
