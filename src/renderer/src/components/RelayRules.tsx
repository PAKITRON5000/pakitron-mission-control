// EV140 (Decidir #147 «B»): before the accounts hand over to each other for the first time, what Anthropic's rules say,
// to read and accept. Once accepted (relayRulesAt), never asked again. The main process refuses it without this too.
import { useRef, useState, type ReactNode } from 'react'
import { ShieldAlert, ExternalLink } from 'lucide-react'
import { useStore } from '../lib/store'
import { api } from '../lib/api'
import { RELAY_RULES, chainTurnsOnRelay, turnsOnRelay } from '../../../core/workmode'

export function useRelayRules(): { ask: () => Promise<boolean>; settingsOk: (patch: any) => Promise<boolean>; chainOk: (pid: string, patch: any) => Promise<boolean>; dialog: ReactNode } {
  const { state, refresh } = useStore()
  const [open, setOpen] = useState(false)
  const done = useRef<((ok: boolean) => void) | undefined>(undefined)
  const accepted = Boolean(state?.settings.relayRulesAt)
  const ask = () => (accepted ? Promise.resolve(true) : new Promise<boolean>((res) => { done.current = res; setOpen(true) }))
  const close = async (ok: boolean) => {
    if (ok) { await api('setSettings', { relayRulesAt: Date.now() }); await refresh() }
    setOpen(false)
    done.current?.(ok)
    done.current = undefined
  }
  const settingsOk = (patch: any) => (state && turnsOnRelay(patch, state.settings) ? ask() : Promise.resolve(true))
  const chainOk = (pid: string, patch: any) => (state && chainTurnsOnRelay(patch, state.settings.relayChains?.[pid]) ? ask() : Promise.resolve(true))
  const dialog = open ? (
    <>
      <div className="scrim" onClick={() => void close(false)} />
      <div role="dialog" aria-modal="true" aria-label={RELAY_RULES.title} className="card p-5 flex flex-col gap-3" style={{ position: 'fixed', left: '50%', top: '50%', transform: 'translate(-50%, -50%)', width: 'min(520px, calc(100vw - 32px))', zIndex: 80, maxHeight: 'calc(100vh - 32px)', overflowY: 'auto' }}>
        <div className="flex items-center gap-2"><ShieldAlert size={18} style={{ color: 'var(--orange)' }} /><b className="t-title" style={{ fontSize: 18 }}>{RELAY_RULES.title}</b></div>
        <ul className="flex flex-col gap-2 t-body" style={{ paddingLeft: 18, listStyle: 'disc' }}>
          {RELAY_RULES.points.map((p) => <li key={p}>{p}</li>)}
        </ul>
        <button className="btn btn-sm btn-ghost self-start" onClick={() => void api('openExternal', RELAY_RULES.link)}><ExternalLink size={13} /> Leer las normas de Anthropic</button>
        <div className="flex flex-wrap gap-2 justify-end mt-1">
          <button className="btn btn-sm" onClick={() => void close(false)}>Ahora no</button>
          <button className="btn btn-sm btn-primary" onClick={() => void close(true)}>{RELAY_RULES.accept}</button>
        </div>
      </div>
    </>
  ) : null
  return { ask, settingsOk, chainOk, dialog }
}
