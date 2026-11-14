// The conversation with the assistant (EV85), one for the whole app: the bubble and its own screen show the same one.
// Kept in this window's storage (the last 40 messages): a convenience, it can come back empty.
import { useEffect, useState } from 'react'
import { api } from './api'
import type { Reply, SendPlan } from '../../../core/assistant'

export type { Reply, SendPlan }

export interface ChatMsg {
  id: number
  from: 'tu' | 'app'
  text: string
  at: number
  reply?: Reply
  /** Waiting for its answer. */
  pending?: boolean
  /** The request in it was sent (or cancelled). */
  done?: 'enviado' | 'cancelado'
  /** The question this answer is about (for «Pregúntale a Claude»). */
  question?: string
}

const KEY = 'pmc.assistant'
let msgs: ChatMsg[] = load()
let seq = msgs.reduce((m, x) => Math.max(m, x.id), 0)
const subs = new Set<() => void>()

function load(): ChatMsg[] {
  try { return (JSON.parse(localStorage.getItem(KEY) ?? '[]') as ChatMsg[]).filter((m) => !m.pending) } catch { return [] }
}
function save(): void {
  try { localStorage.setItem(KEY, JSON.stringify(msgs.filter((m) => !m.pending).slice(-40))) } catch { /* private window */ }
}
function set(next: ChatMsg[]): void {
  msgs = next
  save()
  for (const f of subs) f()
}
const patch = (id: number, p: Partial<ChatMsg>) => set(msgs.map((m) => (m.id === id ? { ...m, ...p } : m)))

/** A short wait before the answer: it reads as an answer, not as a page that changed. */
const BEAT = 380

export async function ask(text: string, projectId?: string): Promise<void> {
  const q = text.trim()
  if (!q) return
  const mine: ChatMsg = { id: ++seq, from: 'tu', text: q, at: Date.now() }
  const wait: ChatMsg = { id: ++seq, from: 'app', text: '', at: Date.now(), pending: true, question: q }
  set([...msgs, mine, wait])
  const t0 = Date.now()
  try {
    const r = await api<Reply>('ask', q, projectId)
    await new Promise((ok) => setTimeout(ok, Math.max(0, BEAT - (Date.now() - t0))))
    patch(wait.id, { pending: false, text: r.text, reply: r, at: Date.now() })
  } catch (e) {
    patch(wait.id, { pending: false, text: `No he podido mirarlo: ${(e as Error).message}` })
  }
}

/** «Enviar» on a request: passed on, and the answer says to whom and when. */
export async function sendPlan(id: number): Promise<void> {
  const m = msgs.find((x) => x.id === id)
  if (!m?.reply?.send || m.done) return
  patch(id, { done: 'enviado' })
  const wait: ChatMsg = { id: ++seq, from: 'app', text: '', at: Date.now(), pending: true }
  set([...msgs, wait])
  try {
    const r = await api<Reply>('assistantSend', m.reply.send)
    patch(wait.id, { pending: false, text: r.text, reply: r })
  } catch (e) {
    patch(id, { done: undefined })
    patch(wait.id, { pending: false, text: `No se ha podido enviar: ${(e as Error).message}` })
  }
}

export function cancelPlan(id: number): void {
  patch(id, { done: 'cancelado' })
}

/** «Pregúntale a Claude»: spends usage, so only on a tap. */
export async function askClaude(id: number, projectId?: string): Promise<void> {
  const m = msgs.find((x) => x.id === id)
  const q = m?.question
  if (!q) return
  patch(id, { done: 'enviado' })
  const wait: ChatMsg = { id: ++seq, from: 'app', text: '', at: Date.now(), pending: true }
  set([...msgs, wait])
  try {
    const r = await api<Reply>('askClaude', q, projectId)
    patch(wait.id, { pending: false, text: r.text, reply: r })
  } catch (e) {
    patch(id, { done: undefined })
    patch(wait.id, { pending: false, text: `Claude no ha podido contestar: ${(e as Error).message}` })
  }
}

export function clearChat(): void {
  set([])
}

export function useChat(): ChatMsg[] {
  const [, force] = useState(0)
  useEffect(() => {
    const f = () => force((x) => x + 1)
    subs.add(f)
    return () => { subs.delete(f) }
  }, [])
  return msgs
}

/** Whether the bubble's panel is open: the screen hides the bubble, the shortcut opens it. */
let panelOpen = false
const panelSubs = new Set<() => void>()
export function setPanel(v: boolean): void { panelOpen = v; for (const f of panelSubs) f() }
export function usePanel(): boolean {
  const [, force] = useState(0)
  useEffect(() => { const f = () => force((x) => x + 1); panelSubs.add(f); return () => { panelSubs.delete(f) } }, [])
  return panelOpen
}

// For the visual review (PMC_SHOT_STEPS): ask and open the panel from the main process.
;(window as any).__pmcAssistant = { ask, clearChat, setPanel }
