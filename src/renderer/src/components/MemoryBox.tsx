import { t } from '../../../core/i18n'
import { useState } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { BookMarked, Plus, X, ShieldCheck, Heart, Info, Gavel, Eye } from 'lucide-react'
import { useStore, useAsync } from '../lib/store'
import { api } from '../lib/api'
import { Segmented, SPRING, accName } from './ui'
import { ago } from '../lib/format'
import { useDraft } from '../lib/draft'

type Kind = 'regla' | 'preferencia' | 'dato'
interface Mem { id: number; kind: Kind; text: string; source: string; at: number }
interface MemView { list: Mem[]; decisions: string[]; kinds: { id: Kind; label: string; hint: string }[]; preview: string }

const KIND: Record<Kind, { label: string; color: string; icon: typeof ShieldCheck }> = {
  regla: { get label() { return t('Regla') }, color: 'var(--red)', icon: ShieldCheck },
  preferencia: { get label() { return t('Le gusta') }, color: 'var(--pink)', icon: Heart },
  dato: { get label() { return t('Dato') }, color: 'var(--blue)', icon: Info }
}

/**
 * «Lo que no deben olvidar» (EV63, the user 13-11): the project's memory that Mission Control keeps and hands to every
 * session at the start and after each compaction. The user adds, changes the kind of or forgets each memory; the Claudes
 * add theirs with `pmc recuerda`.
 */
export function MemoryBox() {
  const { state, toast, now } = useStore()
  const pid = state?.activeProjectId
  const project = state?.projects.find((p) => p.id === pid)
  // EV185: what is written and not sent stays, per project.
  const [text, setText] = useDraft(pid ? `memoria:${pid}` : undefined)
  const [kind, setKind] = useState<Kind>('regla')
  // EV24: for this project or for every project (the accounts, speaking Spanish, not bothering while playing…).
  const [everywhere, setEverywhere] = useState(false)
  const [peek, setPeek] = useState(false)
  // EV92: the memories the text being saved would contradict; asked which holds before saving.
  const [clashes, setClashes] = useState<{ id: number; text: string }[]>()
  const v = useAsync(() => (pid ? api<MemView>('memories', pid) : Promise.resolve(undefined)), [pid, state?.now && Math.floor(state.now / 30_000)])
  if (!pid || !project) return null
  const save = async (replace: { id: number }[] = []) => {
    try {
      for (const m of replace) await api('memoryForget', m.id)
      await api('memoryAdd', everywhere ? '_todos' : pid, kind, text); setText(''); setClashes(undefined); v.reload()
      toast(replace.length ? t('Guardado, y quitada la que decía lo contrario') : t('Guardado: lo leerán todas las sesiones de este proyecto'))
    } catch (e) { toast((e as Error).message) }
  }
  const add = async () => {
    if (!text.trim()) return
    const found = await api<{ id: number; text: string }[]>('memoryConflicts', pid, text).catch(() => [])
    if (found.length) { setClashes(found); return }
    await save()
  }
  const list = v.data?.list ?? []
  return (
    <section className="card p-5 mb-7 flex flex-col gap-4">
      <div className="flex items-center gap-3 flex-wrap">
        <span className="icon-sq icon-sq-lg" style={{ background: 'var(--teal)' }}><BookMarked size={15} /></span>
        <div className="min-w-0">
          <div className="t-section">{t('Lo que no deben olvidar')}</div>
          <div className="t-small c3">{t('Cada Claude lo lee al empezar y otra vez tras compactar su conversación. Lo de aquí manda sobre lo que recuerde de antes.')}</div>
        </div>
        <button className="btn btn-sm btn-ghost ml-auto" onClick={() => setPeek(!peek)}><Eye size={13} /> {t('{v0} lo que leen', { v0: peek ? t('Ocultar') : t('Ver') })}</button>
      </div>

      <div className="rounded-2xl p-3 flex flex-col gap-2" style={{ background: 'var(--fill)' }}>
        <div className="flex items-center gap-2 flex-wrap">
          <Segmented value={kind} onChange={setKind} options={(v.data?.kinds ?? []).map((k) => ({ value: k.id, label: KIND[k.id].label }))} />
          <span className="t-small c3 min-w-0 flex-1">{v.data?.kinds.find((k) => k.id === kind)?.hint}</span>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <input className="field flex-1" style={{ height: 36, minWidth: 0, flexBasis: 200 }} placeholder={t('Recuerda en {name}…', { name: project.name })} value={text} maxLength={400} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void add() }} />
          <Segmented value={everywhere ? 'todos' : 'aqui'} onChange={(x) => setEverywhere(x === 'todos')} options={[{ value: 'aqui', label: t('Solo aquí') }, { value: 'todos', label: t('En todos') }]} />
<button className="btn btn-primary" disabled={!text.trim()} onClick={() => void add()}><Plus size={14} /> {t('Guardar')}</button>
        </div>
        {clashes && (
          <div className="rounded-xl px-4 py-3 flex flex-col gap-2" style={{ background: 'color-mix(in srgb, var(--orange) 12%, transparent)' }}>
            <span className="t-body"><b>{t('Esto parece decir lo contrario de {v0}:', { v0: clashes.length === 1 ? t('lo que ya hay') : t('{length} cosas que ya hay', { length: clashes.length }) })}</b> {clashes.map((c) => `«${c.text}»`).join(' · ')}{t('. ¿Cuál vale?')}</span>
            <div className="flex gap-2 flex-wrap">
              <button className="btn btn-primary btn-sm" onClick={() => void save(clashes)}>{t('Vale la nueva (quitar la anterior)')}</button>
              <button className="btn btn-sm" onClick={() => void save()}>{t('Guardar las dos')}</button>
              <button className="btn btn-sm btn-ghost" onClick={() => setClashes(undefined)}>{t('Cancelar')}</button>
            </div>
          </div>
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        <AnimatePresence initial={false}>
          {list.map((m) => {
            const k = KIND[m.kind] ?? KIND.dato
            const I = k.icon
            return (
              <motion.div key={m.id} layout initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, height: 0 }} transition={SPRING}
                className="rounded-xl px-3 py-2.5 flex items-start gap-3 group" style={{ background: `color-mix(in srgb, ${k.color} 8%, var(--bg-elev-2))` }}>
                <span className="flex-none rounded-lg flex items-center justify-center mt-0.5" style={{ width: 24, height: 24, background: k.color, color: 'white' }}><I size={13} /></span>
                <div className="min-w-0 flex-1">
                  <div className="t-body">{m.text}{(m as any).projectId === '_todos' && <span className="pill ml-2" style={{ background: 'var(--fill-2)', height: 18, fontSize: 11 }}>{t('en todos los proyectos')}</span>}</div>
                  <div className="t-small c3">{k.label} · {m.source === 'usuario' ? t('lo guardaste tú') : t('lo guardó {v0}', { v0: accName(m.source) })} · {ago(m.at, now)}</div>
                </div>
                {/* EV118: the type selector only with the mouse on the memory (on every row at once it was noise); the type is
                    already said by the icon and the line under the text. */}
                <span className="flex items-center gap-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
                  <Segmented value={m.kind} onChange={(nk) => void api('memoryEdit', m.id, { kind: nk }).then(v.reload)} options={(['regla', 'preferencia', 'dato'] as Kind[]).map((x) => ({ value: x, label: KIND[x].label }))} />
                  <button className="btn btn-sm btn-icon btn-ghost" title={t('Olvidarlo')} onClick={() => void api('memoryForget', m.id).then(() => { v.reload(); toast(t('Olvidado')) })}><X size={13} /></button>
                </span>
              </motion.div>
            )
          })}
        </AnimatePresence>
        {!list.length && <div className="t-small c3 py-2">{t('Aún no hay nada. Escribe arriba lo que un Claude nuevo debería saber siempre de {name} (reglas, gustos, datos), o deja que ellos lo guarden con', { name: project.name })} <b>{t('pmc recuerda')}</b>.</div>}
      </div>

      {(v.data?.decisions.length ?? 0) > 0 && (
        <div className="flex flex-col gap-1">
          <div className="t-small c2 flex items-center gap-1.5" style={{ fontWeight: 600 }}><Gavel size={13} /> {t('También leen tus últimas decisiones (Decidir, 14 días)')}</div>
          {v.data!.decisions.map((d, i) => <div key={i} className="t-small c3 pl-5">· {d}</div>)}
        </div>
      )}
      {peek && <pre className="t-small c2 rounded-xl p-3 whitespace-pre-wrap selectable" style={{ background: 'var(--fill)', fontFamily: 'inherit' }}>{v.data?.preview || t('Nada que leer todavía.')}</pre>}
    </section>
  )
}
