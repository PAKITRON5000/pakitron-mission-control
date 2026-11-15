// EV185 (the user, 15-11 03:35: «si escribo algo en alguna nota o lo que sea y salgo de ese menú, o se cierra la app…
// lo que había escrito si no lo he llegado a mandar… se borra y me toca reescribir todo»): what is written in a box and
// not sent stays, per box, in this computer (or phone). Sending clears it (set to '').
import { useEffect, useRef, useState } from 'react'

const PREFIX = 'pmc.draft.'

export function readDraft(key: string): string {
  try { return localStorage.getItem(PREFIX + key) ?? '' } catch { return '' }
}

export function writeDraft(key: string, value: string): void {
  try {
    if (value) localStorage.setItem(PREFIX + key, value)
    else localStorage.removeItem(PREFIX + key)
  } catch { /* private window or full: only this time is lost */ }
}

/**
 * Like useState for a text box, kept under `key` (screen, project and thing, e.g. `nota:<project>`). With no key yet
 * (nothing loaded) it is a plain state; when the key changes (another project, another task), that one's draft comes.
 */
export function useDraft(key: string | undefined): [string, (v: string) => void] {
  const [value, setValue] = useState(() => (key ? readDraft(key) : ''))
  const shown = useRef(key)
  useEffect(() => {
    if (shown.current === key) return
    shown.current = key
    setValue(key ? readDraft(key) : '')
  }, [key])
  const set = (v: string) => {
    setValue(v)
    if (key) writeDraft(key, v)
  }
  return [value, set]
}
