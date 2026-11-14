import { t } from './i18n'
import { docWords } from './docwords'
// What kind of project the user is creating (EV45). An empty folder tells the app nothing, so the first Claude had to guess
// the technology, invent the first tasks and only then get the right helpers. A template says it at the start: the kind
// (so the subagents fit from the first minute: game reviewer, 3D artist, visual reviewer), a few rules for its CLAUDE.md,
// and the first tasks already ordered, with the model each needs and the resource it takes. The user's own words still
// lead: the template only frames them. No node imports: the screens list the templates.

import type { ProjectKind } from './profile'

export type TemplateId = 'libre' | 'juego-unity' | 'juego-godot' | 'web' | 'escritorio' | 'movil' | 'video' | 'arte-3d' | 'datos' | 'escritura' | 'musica' | 'documento'

export interface ProjectTemplate {
  id: TemplateId
  label: string
  sub: string
  kinds: ProjectKind[]
  heavy: string[]
  /** Rules for the project's CLAUDE.md, under «## Cómo es este proyecto». */
  rules: string[]
  /** The first tasks (without the «- [ ] »), in order. P1 is always the plan. */
  tasks: string[]
  /** Added to the first instruction of the Claude that starts it. */
  first: string
}

const plan = () => t('P1 · Plan: qué se hace en la primera versión y qué no, la tecnología y por qué, y las tareas siguientes troceadas en docs/TASKS.md; enséñaselo al usuario con pmc decide antes de construir [opus]')

export const TEMPLATES: ProjectTemplate[] = [
  {
    id: 'libre', get label() { return t('Que lo decida Claude') }, get sub() { return t('Cualquier otra cosa: el primer Claude elige la tecnología y te la cuenta.') },
    kinds: [], heavy: [], rules: [],
    get tasks() { return [plan()] },
    get first() { return t('Decide la tecnología adecuada y explícasela al usuario en dos líneas.') }
  },
  {
    id: 'juego-unity', get label() { return t('Juego en Unity') }, get sub() { return t('2D o 3D. Unity se usa por turnos: una compilación cada vez.') },
    kinds: ['unity'], heavy: ['unity'],
    get rules() { return [
      t('Juego en Unity. El editor y las compilaciones son un recurso que no se comparte: antes de abrir Unity o compilar, `pmc recurso unity "para qué"`, y suéltalo al acabar.'),
      t('Cada cosa que se ve se entrega con captura (`pmc entrega <ID> --foto`), sacada del juego de verdad, no descrita.'),
      t('Las comprobaciones (`pmc.json`) compilan en modo batch y pasan las pruebas de Unity; marca las tareas que necesitan Unity con `{unity}`.')
    ] },
    get tasks() { return [
      plan(),
      t('P2 · Proyecto de Unity creado en esta carpeta, con un tools/unity.ps1 que compila y pasa las pruebas en modo batch, declarado en pmc.json (tras: P1) [sonnet] {unity}'),
      t('P3 · Primera escena jugable: lo mínimo para mover al personaje y que pase algo (tras: P2) [opus] {unity}'),
      t('P4 · Captura y vídeo corto de esa escena para el usuario, con pmc entrega (tras: P3) [sonnet] {unity}')
    ] },
    get first() { return t('Tecnología: Unity (la versión más reciente instalada en Unity Hub).') }
  },
  {
    id: 'juego-godot', get label() { return t('Juego en Godot') }, get sub() { return t('Ligero y rápido de probar; bueno para 2D.') },
    kinds: ['godot'], heavy: [],
    get rules() { return [
      t('Juego en Godot 4. Las escenas y scripts se prueban sin ventana (`godot --headless`) en las comprobaciones de `pmc.json`.'),
      t('Cada cosa que se ve se entrega con captura (`pmc entrega <ID> --foto`).')
    ] },
    get tasks() { return [
      plan(),
      t('P2 · Proyecto de Godot creado, con una comprobación sin ventana en pmc.json (tras: P1) [sonnet]'),
      t('P3 · Primera escena jugable mínima (tras: P2) [opus]'),
      t('P4 · Captura de esa escena para el usuario, con pmc entrega (tras: P3) [sonnet]')
    ] },
    get first() { return t('Tecnología: Godot 4 con GDScript, salvo que el plan dé un motivo para otra cosa.') }
  },
  {
    id: 'web', get label() { return t('Web o app en el navegador') }, get sub() { return t('Una página, una tienda, una herramienta.') },
    kinds: ['web'], heavy: [],
    get rules() { return [
      t('Web con TypeScript. `pmc.json` comprueba tipos y pruebas; nada se da por hecho sin pasarlas.'),
      t('Cada pantalla se entrega con captura a tamaño de móvil y de escritorio.')
    ] },
    get tasks() { return [
      plan(),
      t('P2 · Esqueleto con tipos y pruebas que pasan, declarados en pmc.json (tras: P1) [sonnet]'),
      t('P3 · Primera pantalla útil, con datos de verdad o de ejemplo (tras: P2) [opus]'),
      t('P4 · Capturas en móvil y escritorio para el usuario, con pmc entrega (tras: P3) [sonnet]')
    ] },
    get first() { return t('Tecnología de partida: Vite con TypeScript; cambia solo si el plan lo justifica.') }
  },
  {
    id: 'escritorio', get label() { return t('Programa de escritorio') }, get sub() { return t('Una aplicación de Windows con ventana propia.') },
    kinds: ['electron'], heavy: [],
    get rules() { return [
      t('Aplicación de escritorio con Electron y TypeScript. `pmc.json` comprueba tipos y pruebas.'),
      t('Cada pantalla se entrega con captura de la aplicación abierta de verdad.')
    ] },
    get tasks() { return [
      plan(),
      t('P2 · Esqueleto que abre una ventana, con tipos y pruebas declarados en pmc.json (tras: P1) [sonnet]'),
      t('P3 · Primera pantalla útil (tras: P2) [opus]'),
      t('P4 · Instalable en este PC y captura para el usuario, con pmc entrega (tras: P3) [sonnet]')
    ] },
    get first() { return t('Tecnología de partida: Electron con React y TypeScript.') }
  },
  // EV127: the kinds that do not look like the first projects.
  {
    id: 'movil', get label() { return t('App de móvil') }, get sub() { return t('Para Android y iPhone a la vez.') },
    kinds: ['flutter'], heavy: [],
    get rules() { return [
      t('App de móvil con Flutter. `pmc.json` pasa `flutter analyze` y `flutter test`; nada se da por hecho sin pasarlos.'),
      t('Cada pantalla se entrega con captura del emulador o del móvil. La versión de iPhone solo se compila en un Mac: dilo si hace falta.')
    ] },
    get tasks() { return [
      plan(),
      t('P2 · Proyecto de Flutter creado, con analyze y test declarados en pmc.json (tras: P1) [sonnet]'),
      t('P3 · Primera pantalla útil (tras: P2) [opus]'),
      t('P4 · Captura en el emulador de Android para el usuario, con pmc entrega (tras: P3) [sonnet]')
    ] },
    get first() { return t('Tecnología de partida: Flutter con Dart.') }
  },
  {
    id: 'video', get label() { return t('Vídeo') }, get sub() { return t('Guion, montaje y render. La gráfica, por turnos.') },
    kinds: ['video'], heavy: ['gpu'],
    get rules() { return [
      t('Proyecto de vídeo. Renderizar y generar con la gráfica es un recurso que no se comparte: `pmc recurso gpu "para qué"` antes, y suéltalo al acabar. Si el usuario está jugando o editando, no se lanza.'),
      t('Un render de más de 5 minutos se avisa con `pmc trabajo`. Cada versión se entrega con el vídeo (`pmc entrega <ID> --video`).'),
      t('No se sobrescribe un vídeo con nota del usuario: la nueva versión va con otro nombre.')
    ] },
    get tasks() { return [
      plan(),
      t('P2 · Guion y lista de planos, para que el usuario los apruebe con pmc decide (tras: P1) [opus]'),
      t('P3 · Primer montaje completo, aunque sea con material provisional (tras: P2) [opus] {gpu}'),
      t('P4 · Render de revisión y entrega al usuario (tras: P3) [sonnet] {gpu}')
    ] },
    get first() { return t('Decide con qué se monta (lo que haya instalado en este PC) y díselo al usuario.') }
  },
  {
    id: 'arte-3d', get label() { return t('Arte 3D') }, get sub() { return t('Personajes, escenarios o piezas en Blender.') },
    kinds: ['blender'], heavy: ['gpu'],
    get rules() { return [
      t('Arte 3D con Blender, por scripts de Python en `ArtSource/` siempre que se pueda (se repiten y se pueden corregir). Renderizar usa la gráfica: `pmc recurso gpu "para qué"`.'),
      t('Cada pieza se entrega con render desde varios ángulos (`pmc entrega <ID> --foto`) y se juzga con el subagente `revisor-visual`.')
    ] },
    get tasks() { return [
      plan(),
      t('P2 · Hoja de estilo con referencias, para que el usuario la apruebe con pmc decide (tras: P1) [opus]'),
      t('P3 · Primera pieza en bloques (blockout) y render para revisar (tras: P2) [opus] {gpu}'),
      t('P4 · Pieza terminada con materiales, renders y exportación (tras: P3) [opus] {gpu}')
    ] },
    get first() { return t('Herramienta: Blender, por scripts de Python.') }
  },
  {
    id: 'datos', get label() { return t('Análisis de datos') }, get sub() { return t('Tablas, cuentas, gráficos y conclusiones.') },
    kinds: ['data', 'python'], heavy: [],
    get rules() { return [
      t('Análisis de datos con Python (pandas y cuadernos de Jupyter). Cada cifra sale de código que se puede volver a ejecutar, nunca a mano.'),
      t('Los datos originales no se tocan: se leen de `datos/` y lo calculado va a otra carpeta. Los datos grandes, fuera de git.'),
      t('Antes de enseñar una conclusión, la comprueba el subagente `revisor-datos`. Se entrega con el gráfico o la tabla (`pmc entrega <ID> --foto`).')
    ] },
    get tasks() { return [
      plan(),
      t('P2 · Los datos cargados y descritos: de dónde vienen, cuántas filas, qué falta o está mal (tras: P1) [sonnet]'),
      t('P3 · Primera respuesta a la pregunta del usuario, con su gráfico (tras: P2) [opus]'),
      t('P4 · Comprobada por revisor-datos y entregada al usuario (tras: P3) [sonnet]')
    ] },
    get first() { return t('Pregunta al usuario por los datos si no están en la carpeta, con pmc decide.') }
  },
  {
    id: 'escritura', get label() { return t('Libro o guion') }, get sub() { return t('Una novela, un guion, un cuento, un artículo largo.') },
    kinds: ['writing'], heavy: [],
    get rules() { return [
      t('Escritura. Un capítulo o escena por archivo (Markdown) y por cuenta: dos cuentas no escriben el mismo a la vez.'),
      t('El estilo, el tono, los nombres y lo que ya ha pasado se apuntan en docs/DECISIONS.md, para que nadie se contradiga.'),
      t('Antes de entregar, el subagente `corrector`; al usuario se le entrega el texto para leer, no un resumen.')
    ] },
    get tasks() { return [
      plan(),
      t('P2 · Guía de estilo y personajes o fuentes, para que el usuario la apruebe con pmc decide (tras: P1) [opus]'),
      t('P3 · Esquema completo, capítulo a capítulo (tras: P2) [opus]'),
      t('P4 · Primer capítulo escrito, repasado por el corrector y entregado (tras: P3) [opus]')
    ] },
    get first() { return t('Pregunta al usuario el tono y para quién es antes de escribir, con pmc decide.') }
  },
  {
    id: 'musica', get label() { return t('Música o audio') }, get sub() { return t('Canciones, efectos de sonido, un pódcast.') },
    kinds: ['audio'], heavy: [],
    get rules() { return [
      t('Música o audio. Lo que se pueda, por código (Python, SuperCollider, una estación de audio por línea de órdenes) para poder repetirlo; los proyectos de la estación de audio, uno por cuenta.'),
      t('Nunca se sobrescribe una pista o una mezcla con nota del usuario: cada versión con otro nombre.'),
      t('Se entrega para oírlo (`pmc entrega <ID> --audio "ruta::qué es"`), con lo que tiene que escuchar.')
    ] },
    get tasks() { return [
      plan(),
      t('P2 · Referencias y estilo, con ejemplos para que el usuario los oiga y elija con pmc decide (tras: P1) [opus]'),
      t('P3 · Primera maqueta (tras: P2) [opus]'),
      t('P4 · Maqueta entregada para oír, con lo que tiene que escuchar (tras: P3) [sonnet]')
    ] },
    get first() { return t('Mira qué hay instalado en este PC para hacer audio y díselo al usuario.') }
  },
  {
    id: 'documento', get label() { return t('Documento o investigación') }, get sub() { return t('Un informe, un libro, un estudio.') },
    kinds: ['docs'], heavy: [],
    get rules() { return [
      t('Documento o investigación. Cada dato con su fuente; lo que sea opinión, dicho como opinión.'),
      t('Cada capítulo o parte se entrega para que el usuario lo lea, con lo que tiene que mirar.')
    ] },
    get tasks() { return [
      plan(),
      t('P2 · Índice y fuentes principales (tras: P1) [opus]'),
      t('P3 · Primer borrador completo (tras: P2) [opus]'),
      t('P4 · Revisión: datos comprobados y estilo, y entrega al usuario (tras: P3) [sonnet]')
    ] },
    get first() { return t('Decide el formato del documento (Markdown, Word, PDF) según lo que pida.') }
  }
]

export const templateOf = (id: string | undefined): ProjectTemplate => TEMPLATES.find((x) => x.id === id) ?? TEMPLATES[0]

/** CLAUDE.md of a new project: the user's words, then what kind of project it is. «Cada sesión» is added by prepareProject. */
export function templateClaudeMd(tpl: ProjectTemplate, name: string, description: string): string {
  const parts = [`# ${name}`, '', description.trim(), '']
  if (tpl.rules.length) parts.push(`## ${t('Cómo es este proyecto')}`, '', ...tpl.rules.map((r) => `- ${r}`), '')
  return parts.join('\n')
}

export function templateTasks(tpl: ProjectTemplate, name: string): string {
  const list = tpl.tasks.map((x) => `- [ ] ${x}`).join('\n')
  return `${t('# Tareas de {name}', { name })}\n\n${tasksIntro()}\n\n## ${t('Por hacer')}\n\n${list}\n`
}

/** The how-to line at the top of a TASKS.md (the marks it names are read by parse/tasks in both languages). */
export function tasksIntro(): string {
  return t('Una línea por tarea: `- [ ] ID · título` (`[~]` a medias, `[x]` hecha). Si una tarea espera a otra: `({after}: ID)`. El modelo que basta: `[sonnet]`, `[opus]` o `[fable]`. Si necesita algo que no se comparte: `{unity}`, `{gpu}`.', { after: docWords().after })
}
