import { t } from '../../../core/i18n'
import { useEffect, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { Send, Copy, Play } from 'lucide-react'
import { useStore } from '../lib/store'
import { api, type AccountId, type Instruction, type InstructionKind } from '../lib/api'
import { SPRING, accName } from './ui'
import { readDraft, writeDraft } from '../lib/draft'

const KINDS: { k: InstructionKind; label: string; hint: string }[] = [
  { k: 'mensaje', get label() { return t('Mensaje a un agente') }, get hint() { return t('Para un Claude concreto') } },
  { k: 'tarea', get label() { return t('Tarea nueva') }, get hint() { return t('Entra en Tareas como pendiente') } },
  { k: 'idea', get label() { return t('Idea') }, get hint() { return t('Se guarda en Ideas para decidir después') } },
  { k: 'correccion', get label() { return t('Corrección') }, get hint() { return t('Algo que está mal') } },
  { k: 'prioridad', get label() { return t('Prioridad') }, get hint() { return t('Cambia el orden del trabajo') } },
  { k: 'general', get label() { return t('Para todo el proyecto') }, get hint() { return t('La leen todos') } },
  { k: 'nota', get label() { return t('Nota privada') }, get hint() { return t('Solo para ti, no se envía') } }
]

export function Composer() {
  const { composer, closeComposer, state, toast } = useStore()
  const [text, setTextState] = useState('')
  // EV185: what is written and not sent stays (a preset text, from a button, comes first).
  const setText = (v: string) => { setTextState(v); writeDraft('composer', v) }
  const [kind, setKind] = useState<InstructionKind>('general')
  const [touched, setTouched] = useState(false)
  const [target, setTarget] = useState<AccountId | ''>('')
  const [saved, setSaved] = useState<Instruction>()
  // EV46: the project its words point to (unless the user picked one) and who will do it.
  const [pid, setPid] = useState<string>('')
  const [pidTouched, setPidTouched] = useState(false)
  const [routeWhy, setRouteWhy] = useState<string>()
  const [who, setWho] = useState<{ id: string; why: string }>()
  const ref = useRef<HTMLTextAreaElement>(null)
  const project = state?.projects.find((p) => p.id === (pid || state.activeProjectId))

  useEffect(() => {
    if (!composer.open) return
    setTextState(composer.preset?.text ?? readDraft('composer'))
    setKind((composer.preset?.kind as InstructionKind) ?? 'general')
    setTouched(Boolean(composer.preset?.kind))
    setTarget((composer.preset?.target as AccountId) ?? '')
    setSaved(undefined)
    setPid(''); setPidTouched(false); setRouteWhy(undefined)
    setTimeout(() => ref.current?.focus(), 60)
  }, [composer])

  useEffect(() => {
    if (pidTouched || !text.trim() || !composer.open) return
    const t = setTimeout(() => {
      api<{ id: string; why: string } | undefined>('routeRequest', text).then((r) => { setPid(r?.id ?? ''); setRouteWhy(r?.id && r.id !== state?.activeProjectId ? r.why : undefined) }, () => undefined)
    }, 400)
    return () => clearTimeout(t)
  }, [text, pidTouched, composer.open])

  useEffect(() => {
    if (!composer.open || !project) return
    void api<{ id: string; why: string } | undefined>('whoWillDo', project.id).then(setWho, () => setWho(undefined))
  }, [project?.id, composer.open, state?.refreshedAt?.agents])

  useEffect(() => {
    if (touched || !text.trim()) return
    const t = setTimeout(() => {
      api<{ kind: InstructionKind; target?: AccountId }>('guessKind', text).then((g) => {
        setKind(g.kind)
        if (g.target) setTarget(g.target)
      })
    }, 250)
    return () => clearTimeout(t)
  }, [text, touched])

  const startable = kind !== 'nota' && kind !== 'idea' && Boolean(target || who)
  const save = async (deliver: boolean, start = false) => {
    if (!project || !text.trim()) return
    try {
      const to = (target || (start ? who?.id : '')) as AccountId | ''
      let r = await api<Instruction>('addInstruction', { projectId: project.id, kind, body: text.trim(), target: to || undefined })
      if (start && to) {
        const d = await api<{ action: string; why: string }>('startOn', project.id, to)
        setSaved(r)
        writeDraft('composer', '')
        toast(d.action === 'abrir' ? t('{v0} se abre en {name} y empieza por esto', { v0: accName(to), name: project.name }) : d.action === 'avisar' ? t('Se lo ha escrito a {v0} en su ventana', { v0: accName(to) }) : t('Guardado para {v0}; no se abre nada: {why}', { v0: accName(to), why: d.why }))
        setTimeout(closeComposer, 700)
        return
      }
      if (deliver) r = await api<Instruction>('deliverInstruction', project.id, r.id)
      setSaved(r)
      if (r.status !== 'fallida') writeDraft('composer', '')
      toast(r.status === 'entregada' ? t('Escrita en el Buzón') : kind === 'idea' ? t('Idea guardada en Tareas › Ideas') : kind === 'tarea' ? t('Tarea creada') : t('Guardada en Mission Control'))
      if (r.status !== 'fallida') setTimeout(closeComposer, 500)
    } catch (e) { toast((e as Error).message) }
  }

  return (
    <AnimatePresence>
      {composer.open && (
        <>
          <motion.div className="scrim" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={closeComposer} />
          <motion.div
            className="palette p-4"
            style={{ x: '-50%', top: '14vh' }}
            initial={{ opacity: 0, y: -8, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -8, scale: 0.98 }} transition={SPRING}
            onKeyDown={(e) => { if (e.key === 'Escape') closeComposer(); if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) void save(Boolean(project?.allowBuzon) && kind !== 'nota') }}
            role="dialog" aria-label={t('Nueva instrucción')}
          >
            <div className="t-head mb-1 flex items-center gap-2">{t('Nueva instrucción ·')}
              <select className="field h-[28px] text-[13px]" style={{ fontWeight: 600 }} aria-label={t('Proyecto')} value={project?.id ?? ''} onChange={(e) => { setPid(e.target.value); setPidTouched(true); setRouteWhy(undefined) }}>
                {(state?.projects ?? []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
            {routeWhy && <div className="t-small mb-1" style={{ color: 'var(--indigo)' }}>{t('Va a {v0}: {routeWhy}. Cámbialo arriba si no es ahí.', { v0: project?.name, routeWhy: routeWhy })}</div>}
            <div className="t-small c3 mb-3">{t('Escribe lo que quieras; Mission Control propone el destino y puedes cambiarlo.')}</div>
            <textarea ref={ref} rows={4} className="field w-full t-body" placeholder={t('Ej.: Claude 4, encárgate de mejorar los materiales del castillo.')} value={text} onChange={(e) => setText(e.target.value)} />
            <div className="flex flex-wrap gap-1.5 mt-3">
              {KINDS.map((k) => (
                <button key={k.k} className={`chip ${kind === k.k ? 'on' : ''}`} title={k.hint} onClick={() => { setKind(k.k); setTouched(true) }}>{k.label}</button>
              ))}
            </div>
            <div className="flex items-center gap-2 mt-3">
              <select className="field h-[30px] text-[12.5px]" value={target} onChange={(e) => setTarget(e.target.value as AccountId)} aria-label={t('Destinatario')} disabled={kind === 'nota'}>
                <option value="">{t('Cualquier Claude')}</option>
                {(state?.agents ?? []).map((x) => x.id).map((x) => <option key={x} value={x}>{accName(x)}</option>)}
              </select>
              <span className="t-small c3 flex-1">{kind !== 'nota' && kind !== 'idea' && !target && who ? <>{t('Lo hará')} <b>{accName(who.id)}</b>: {who.why}.</> : KINDS.find((k) => k.k === kind)?.hint}</span>
            </div>
            <div className="hairline mt-4 pt-3 flex items-center gap-2">
              <span className="t-small c3 flex-1">
                {saved ? (saved.status === 'entregada' ? t('Entregada: escrita en el Buzón.') : saved.status === 'fallida' ? t('No se pudo: {error}', { error: saved.error }) : t('Guardada. Aún no la ha recibido ningún agente.'))
                  : kind === 'nota' ? t('Solo para ti: no se envía a nadie.')
                  : (target ? state?.hooks?.[target] : Object.values(state?.hooks ?? {}).some(Boolean)) ? t('La recibirá {v0} al abrir su próxima sesión en {v1}.', { v0: target ? 'Claude ' + target.slice(6) : t('el primer Claude'), v1: project?.name })
                  : project?.allowBuzon ? t('Al entregarla se escribe en el Buzón, que los agentes leen al empezar cada bloque.')
                  : t('Se guarda aquí. Para que llegue sola, activa la coordinación en Ajustes; o cópiala.')}
              </span>
              <button className="btn btn-sm" disabled={!text.trim()} onClick={() => { void navigator.clipboard.writeText(text.trim()); toast(t('Copiado')) }}><Copy size={13} /> {t('Copiar')}</button>
              <button className="btn btn-sm" disabled={!text.trim()} onClick={() => void save(false)}>{t('Guardar')}</button>
              {startable && <button className="btn btn-sm btn-primary" disabled={!text.trim()} title={t('Se guarda para esa cuenta y, si no está trabajando ya ahí, se le escribe en su ventana o se abre (nunca una ventana de más)')} onClick={() => void save(false, true)}><Play size={13} /> {t('Guardar y que empiece')}</button>}
              {kind !== 'nota' && project?.allowBuzon && <button className="btn btn-sm btn-primary" disabled={!text.trim()} onClick={() => void save(true)}><Send size={13} /> {t('Entregar al Buzón')}</button>}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}
