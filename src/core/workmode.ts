// How the Claude accounts work, as one choice (the user, 12-11: «que sea sencillo de entender para un usuario»). Before
// 0.16 there were five switches in two screens (relevo automático, modo autónomo, reparto automático, cómo se relevan,
// trabajo pesado por turnos) and no way to tell what would happen. Three ways of working cover what the user asked for;
// each one sets the switches underneath. Whatever the mode, every window the app opens goes through core/dispatch.ts.
// No node imports: the screens use it too.

import { t } from './i18n'

export type WorkMode = 'manual' | 'cada-uno' | 'relevos'

export interface WorkModeInfo { id: WorkMode; label: string; sub: string; happens: string }

// EV162: getters, so each text comes out in the language chosen when it is read (like the menu, NAV).
export const WORK_MODES: WorkModeInfo[] = [
  {
    id: 'manual', get label() { return t('Solo cuando yo lo diga') },
    get sub() { return t('Cada Claude trabaja mientras tenga su ventana abierta. Mission Control no abre ni retoma nada.') },
    get happens() { return t('Cuando una cuenta se queda sin uso, se queda parada hasta que tú la abras.') }
  },
  {
    id: 'cada-uno', get label() { return t('Cada uno sigue con lo suyo') },
    get sub() { return t('Cada cuenta sigue con su proyecto sin parar y, al volver su uso, lo retoma en su misma conversación. Lo pesado (Unity, Blender) va por turnos.') },
    get happens() { return t('Cuando una cuenta se queda sin uso, las demás siguen con lo suyo y ella sigue al volver, en su misma conversación.') }
  },
  {
    id: 'relevos', get label() { return t('Se relevan entre ellos') },
    get sub() { return t('Cuando una se queda sin uso, sigue su trabajo la siguiente libre del turno (con Fable si iba con Fable).') },
    get happens() { return t('Cuando una cuenta se queda sin uso, se abre la siguiente libre del turno en ese proyecto; si ya tiene ventana, se le escribe ahí.') }
  }
]

export interface ModeSettings { autonomous?: boolean; autoRelay?: boolean; autoPlan?: boolean; relayMode?: 'conjunto' | 'proyecto'; heavyTurns?: boolean }

/** The switches a mode sets. Automatic distribution (autoPlan) is an extra the user turns on by itself; modes leave it off. */
export function settingsFor(mode: WorkMode): Required<ModeSettings> {
  // 'conjunto' with both off: autoWake only acts on its own in 'proyecto' or autonomous, so nothing is started or resumed.
  if (mode === 'manual') return { autonomous: false, autoRelay: false, autoPlan: false, relayMode: 'conjunto', heavyTurns: false }
  if (mode === 'cada-uno') return { autonomous: true, autoRelay: false, autoPlan: false, relayMode: 'proyecto', heavyTurns: true }
  return { autonomous: true, autoRelay: true, autoPlan: false, relayMode: 'conjunto', heavyTurns: false }
}

/**
 * EV110 (the user, 13-11 12:40: «haya 1 claude contratado o muchos, eso debe entenderlo la misma app… cual es la manera
 * óptima de trabajar en cada momento»): the way that fits the team the user has, and why, in one line each.
 *  - 1 account: nobody to relay to: it works on and takes up its own work when its usage is back («cada uno»), and the
 *    wheel of one project (if on) just waits for it.
 *  - 2 or 3: a relay wheel on the project that matters now, with overlap: one at a time, nothing lost between them.
 *  - 4 or more: the wheel on the main project, plus one more account at once in it where nothing heavy is shared (two
 *    fronts), and the rest of the projects by turns.
 */
export interface TeamAdvice { mode: WorkMode; fronts: number; title: string; why: string }

export function teamAdvice(usable: number, heavyMain = false, rulesOk = true): TeamAdvice {
  // EV140: until the user has read Anthropic's rules, several accounts each go on with their own work, never handing over.
  if (usable >= 2 && !rulesOk) return { mode: 'cada-uno', fronts: 1, title: t('Tienes {usable} Claude: cada uno con lo suyo', { usable }), why: t('Cada cuenta sigue con su proyecto y retoma lo suyo al volver su uso. Para que se releven entre ellas, elige «Se relevan entre ellos» abajo: antes verás lo que dicen las normas de Anthropic.') }
  if (usable <= 1) return { mode: 'cada-uno', fronts: 1, title: t('Tienes un Claude: que siga solo con lo suyo'), why: t('No hay a quién pasar el turno: trabaja sin parar, guarda a menudo y, cuando vuelve su uso, retoma su misma conversación.') }
  if (usable <= 3) return { mode: 'relevos', fronts: 1, title: t('Tienes {usable} Claude: que se releven', { usable }), why: t('Uno trabaja cada vez en lo importante y, al quedarse sin uso, sigue el siguiente con lo que dejó (la rueda de Relevos, con unos minutos de solape). Así no se pisan ni se pierde nada.') }
  return { mode: 'relevos', fronts: heavyMain ? 1 : 2, title: t('Tienes {usable} Claude: rueda y dos a la vez', { usable }), why: heavyMain ? t('El proyecto principal usa algo que no se comparte (Unity o la gráfica): uno cada vez allí, en rueda, y los demás en otros proyectos por turnos.') : t('Rueda en el proyecto principal con dos cuentas a la vez en partes distintas (cada una reserva su tarea), y las demás en otros proyectos por turnos.') }
}

/** The mode the switches amount to; undefined when they were set one by one to something none of the three is. */
export function modeOf(s: ModeSettings): WorkMode | undefined {
  if (!s.autonomous && !s.autoRelay) return 'manual'
  if (s.autonomous && !s.autoRelay && s.relayMode === 'proyecto') return 'cada-uno'
  if (s.autonomous && s.autoRelay && (s.relayMode ?? 'conjunto') === 'conjunto') return 'relevos'
  return undefined
}

/**
 * EV128: what to change so the way of working fits the accounts signed in, while the app is the one that chose it
 * (`workModeBy: 'app'`). Undefined when it already fits, or when the user chose it himself.
 */
export function fitTeam(s: ModeSettings & { workModeBy?: 'app' | 'usuario'; maxFronts?: number; relayRulesAt?: number }, signed: number): { patch: Required<ModeSettings> & { maxFronts: number }; advice: TeamAdvice } | undefined {
  if (s.workModeBy !== 'app') return undefined
  const advice = teamAdvice(Math.max(1, signed), false, Boolean(s.relayRulesAt))
  if (modeOf(s) === advice.mode && (s.maxFronts ?? 1) === advice.fronts) return undefined
  return { patch: { ...settingsFor(advice.mode), maxFronts: advice.fronts }, advice }
}

// ---- Anthropic's rules before the hand-over between accounts (EV140, Decidir #147 «B») --------------------------------
// The rules do not say whether one person may chain several subscriptions (docs/research/normas-anthropic.md). A new install
// keeps it off; whoever turns it on reads this first and takes it on himself.

export const RELAY_RULES = {
  get title() { return t('Antes de que tus cuentas se releven') },
  get points() {
    return [
      t('Con esto, cuando una cuenta se queda sin uso, sigue el trabajo otra de tus cuentas.'),
      t('Las normas de Anthropic dicen que los límites de Pro y Max «suponen un uso normal e individual» de Claude Code. No aclaran si una misma persona puede juntar varias suscripciones así.'),
      t('Anthropic puede limitar o cerrar cuentas, sin avisar, si cree que no se cumplen sus normas.'),
      t('Mission Control no es de Anthropic: la usas bajo tu responsabilidad. Si dudas, pregúntales antes.')
    ]
  },
  link: 'https://code.claude.com/docs/en/legal-and-compliance',
  get accept() { return t('Lo he leído: que se releven') },
  get refused() { return t('Para encenderlo, antes hay que leer el aviso de las normas de Anthropic (Relevos › Cómo trabajan los Claude).') }
}

/** A settings change that starts accounts taking over from each other (the relay, or the automatic sharing out). */
export function turnsOnRelay(patch: { autoRelay?: boolean; autoPlan?: boolean } | undefined, s: { autoRelay?: boolean; autoPlan?: boolean }): boolean {
  return (patch?.autoRelay === true && !s.autoRelay) || (patch?.autoPlan === true && !s.autoPlan)
}

/** A project's wheel change that leaves two or more accounts taking turns where there were not. */
export function chainTurnsOnRelay(patch: { on?: boolean; order?: string[] } | undefined, chain: { on?: boolean; order?: string[] } | undefined): boolean {
  const before = Boolean(chain?.on) && (chain?.order?.length ?? 0) > 1
  const after = Boolean(patch?.on ?? chain?.on) && (patch?.order ?? chain?.order ?? []).length > 1
  return after && !before
}
