// The course of a project (EV102; the user, 13-11: «si he implementado sistemas y los Claude detectan que estamos cambiando
// mucho y enfocándolo hacia otro sitio, que sepan distinguir entre lo que quiere el usuario y lo que no, deshacerse de lo
// que saben que ya no quiere e ir autoarreglándose el proyecto»).
//
// `pmc rumbo` gives the Claude with the turn, in one read, what says where the project is going: the user's decisions
// (with what he chose and wrote), his rules and likes, his notes on what he saw, and what was discarded; and how to act on
// it, in the three piles of EV100. The judging is the Claude's; the evidence and the rules of the game are here. No node.

export interface CourseInput {
  project: string
  decisions: { title: string; choice?: string; note?: string; status: string; at: number }[]
  memories: { kind: string; text: string }[]
  notes: { body: string; status: string; at: number }[]
  discarded: string[]
}

const day = (ms: number) => new Date(ms).toLocaleDateString('es-ES', { day: 'numeric', month: 'numeric' })
const cut = (s: string, n: number) => { const t = s.replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n) + '…' : t }

export function courseText(i: CourseInput): string {
  const out: string[] = [`Rumbo de ${i.project}: lo que dice hacia dónde va, para el repaso (EV102).`]
  const rules = i.memories.filter((m) => m.kind === 'regla')
  const likes = i.memories.filter((m) => m.kind === 'preferencia')
  if (rules.length) out.push('REGLAS DEL USUARIO:', ...rules.slice(0, 12).map((m) => `- ${cut(m.text, 220)}`))
  if (likes.length) out.push('LE GUSTA:', ...likes.slice(0, 12).map((m) => `- ${cut(m.text, 220)}`))
  const decided = i.decisions.filter((d) => d.status !== 'pendiente').sort((a, b) => b.at - a.at)
  if (decided.length) out.push('LO QUE DECIDIÓ (lo más nuevo manda):', ...decided.slice(0, 25).map((d) => `- ${day(d.at)} · ${cut(d.title, 90)} → ${d.status === 'descartada' ? 'descartada' : cut(d.choice ?? 'con nota', 80)}${d.note ? ` («${cut(d.note, 200)}»)` : ''}`))
  if (i.notes.length) out.push('SUS NOTAS AL MIRAR (Revisar):', ...i.notes.slice(0, 15).map((n) => `- ${day(n.at)} · ${cut(n.body, 200)}`))
  if (i.discarded.length) out.push('DESCARTADO O QUITADO:', ...i.discarded.slice(0, 15).map((x) => `- ${cut(x, 160)}`))
  out.push(
    'CÓMO SE HACE EL REPASO: recorre los sistemas, pantallas y contenidos del proyecto y ponlos en tres montones.',
    '1) YA NO LO QUIERE (lo dijo claro, o lo sustituye algo que pidió): retíralo con vuelta atrás: una rama o etiqueta de git «retirado/<nombre>» con el estado de antes, quítalo del código y de sus restos (menús, ajustes, textos, archivos que solo usaba eso: pmc desechable <ruta> "por qué"), pmc verifica para ver que lo demás sigue bien, y una línea en docs/DECISIONS.md con la frase del usuario que lo justifica.',
    '2) DUDOSO (no lo dijo, pero el rumbo apunta a otro sitio): no lo toques; pregúntale con pmc decide, fotos o vídeo de lo que es, --opcion "A: mantener" --opcion "B: retirar" --defecto "A".',
    '3) LO QUIERE: se queda y, si toca, se mejora.',
    'Nunca retires nada por tu cuenta sin una frase del usuario que lo diga; ante la duda, es dudoso.'
  )
  return out.join('\n')
}
