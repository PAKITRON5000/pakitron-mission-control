import { locale, t } from '../../../core/i18n'
import { useEffect, useState } from 'react'
import { motion } from 'motion/react'
import { Moon, Check, ChevronRight, Gavel } from 'lucide-react'
import { useStore } from '../lib/store'
import { api, thumbUrl } from '../lib/api'
import { Avatar, SPRING, accName, nameify } from './ui'
import { useGo } from './AssistantChat'
import type { ReplyRow } from '../../../core/assistant'

interface Away { from: number; to: number; accounts: { id: string; text: string; rows: ReplyRow[]; spentWeek?: number }[]; photos: { id: number; name: string; projectId: string }[]; asked: number }

const SEEN = 'pmc.seen'
/** Away for this long counts as «while you were away». */
const AWAY_MS = 60 * 60_000
const read = () => { try { return Number(localStorage.getItem(SEEN)) || 0 } catch { return 0 } }
const write = (t: number) => { try { localStorage.setItem(SEEN, String(t)) } catch { /* private */ } }

/**
 * EV66: when the user comes back after an hour or more, what the Claudes did meanwhile, account by account (what each
 * finished, its commits, what it asked, its limits, how much week it spent) and the new pictures. Until «Visto».
 */
export function AwayCard() {
  const { go, state, setViewer } = useStore()
  const run = useGo()
  const [since, setSince] = useState<number>()
  const [data, setData] = useState<Away>()
  useEffect(() => {
    const check = () => {
      const seen = read()
      const now = Date.now()
      if (seen && now - seen > AWAY_MS) setSince((s) => s ?? seen)
      if (!seen) write(now)
    }
    check()
    let last = 0
    const mark = () => { const now = Date.now(); if (now - last > 60_000) { last = now; check(); write(now) } }
    const vis = () => { if (document.visibilityState === 'visible') check() }
    window.addEventListener('pointerdown', mark)
    window.addEventListener('keydown', mark)
    window.addEventListener('focus', check)
    document.addEventListener('visibilitychange', vis)
    return () => { window.removeEventListener('pointerdown', mark); window.removeEventListener('keydown', mark); window.removeEventListener('focus', check); document.removeEventListener('visibilitychange', vis) }
  }, [])
  useEffect(() => { if (since) void api<Away>('away', since).then(setData, () => undefined) }, [since])
  if (!since || !data) return null
  const hours = Math.max(1, Math.round((data.to - data.from) / 3600_000))
  const fromText = new Date(data.from).toLocaleString(locale(), { weekday: 'short', hour: '2-digit', minute: '2-digit' })
  const close = () => { write(Date.now()); setSince(undefined); setData(undefined) }
  return (
    <motion.div className="card p-5 mb-6" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={SPRING}
      style={{ boxShadow: '0 0 0 2px color-mix(in srgb, var(--indigo) 55%, transparent), var(--shadow-1)' }}>
      <div className="flex items-center gap-3 mb-4">
        <span className="icon-sq icon-sq-lg" style={{ background: 'var(--indigo)' }}><Moon size={16} /></span>
        <div className="min-w-0 flex-1">
          <div className="t-title">{t('Mientras no estabas')}</div>
          <div className="t-small c3">{t('Desde el {fromText} ({hours} h){v0}', { fromText: fromText, hours: hours, v0: data.asked ? t(' · {asked} {v0} tu respuesta', { asked: data.asked, v0: data.asked === 1 ? t('pregunta espera') : t('preguntas esperan') }) : '' })}</div>
        </div>
        {data.asked > 0 && <button className="btn btn-sm" style={{ color: 'var(--red)' }} onClick={() => go('decisiones')}><Gavel size={13} /> {t('Contestar')}</button>}
        <button className="btn btn-sm btn-primary" onClick={close}><Check size={13} /> {t('Visto')}</button>
      </div>
      {data.accounts.length === 0 && <div className="t-body c2">{t('Ningún Claude ha hecho nada en este tiempo.')}</div>}
      <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))' }}>
        {data.accounts.map((a) => (
          <div key={a.id} className="rounded-xl p-3.5 flex flex-col gap-2" style={{ background: 'var(--fill)' }}>
            <div className="flex items-center gap-2.5">
              <Avatar id={a.id as any} size={30} />
              <b className="t-head flex-1 truncate">{accName(a.id)}</b>
              {a.spentWeek != null && <span className="t-small c3 num">{t('gastó {spentWeek} % de su semana', { spentWeek: a.spentWeek })}</span>}
            </div>
            <div className="t-small c2" style={{ lineHeight: 1.45 }}>{nameify(a.text.replace(/^Mientras no estabas \([^)]*\), /, '')).replace(/^./, (x) => x.toUpperCase())}</div>
            {a.rows.map((r, i) => (
              <button key={i} className="flex items-center gap-2 text-left border-0 bg-transparent p-0 min-w-0" onClick={() => r.go && void run(r.go)}>
                <span className="flex-none rounded-full" style={{ width: 7, height: 7, background: r.color ?? 'var(--label-3)' }} />
                <span className="t-small truncate flex-1" style={{ fontWeight: 560 }}>{nameify(r.title)}</span>
                {r.go && <ChevronRight size={12} className="c3 flex-none" />}
              </button>
            ))}
          </div>
        ))}
      </div>
      {data.photos.length > 0 && (
        <div className="mt-4">
          <div className="t-micro c3 mb-2">{t('Imágenes nuevas')}</div>
          <div className="flex gap-2 overflow-x-auto" style={{ scrollbarWidth: 'thin' }}>
            {data.photos.map((p) => (
              <button key={p.id} className="relative flex-none border-0 p-0 rounded-lg overflow-hidden" style={{ width: 128, aspectRatio: '4 / 3', background: 'var(--fill)' }} title={p.name}
                onClick={() => { if (p.projectId !== state?.activeProjectId) void api('setActiveProject', p.projectId); setViewer(p.id, data.photos.map((x) => x.id)) }}>
                <img src={thumbUrl(p.id, 260)} alt={p.name} className="w-full h-full object-cover" loading="lazy" />
                {/* Whose they are when they are not of the tab open (13-11: a video project's frames in Mission Control's Inicio). */}
                {p.projectId !== state?.activeProjectId && (() => { const pr = state?.projects.find((x) => x.id === p.projectId); return pr ? (
                  <span className="absolute left-1 bottom-1 max-w-[calc(100%-8px)] truncate rounded-md px-1.5 py-0.5 text-[10.5px] font-semibold flex items-center gap-1" style={{ background: 'rgb(0 0 0 / 0.62)', color: 'white' }}>
                    <span className="inline-block rounded-full flex-none" style={{ width: 6, height: 6, background: pr.color }} />{pr.name}
                  </span>
                ) : null })()}
              </button>
            ))}
          </div>
        </div>
      )}
    </motion.div>
  )
}
