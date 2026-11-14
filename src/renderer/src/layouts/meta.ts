import { t } from '../../../core/i18n'
// EV131 (the user, 13-11: «al menos 8 estilos de app muy diferentes visualmente, incluyendo el que ya tenemos… no me
// refiero a más colores»): eight shapes of the whole app. Each one decides where everything is and how one moves around;
// the screens, the data and the buttons underneath are the same. The colour themes (EV87/EV90) go on top of any of them.
// Only this list is in the window's main bundle: each shape's code loads when it is chosen (layouts/index.tsx).
import type { LayoutId } from '../../../core/types'

export interface LayoutMeta {
  id: LayoutId
  name: string
  /** One line: what it is like and who it suits. */
  sub: string
  /** The schematic of the preview (layouts/Preview.tsx): boxes in a 100 × 64 frame, [x, y, w, h, kind]. */
  boxes: [number, number, number, number, 'bar' | 'nav' | 'main' | 'pane' | 'tile' | 'map' | 'accent'][]
}

export const LAYOUTS: LayoutMeta[] = [
  {
    id: 'pestanas', get name() { return t('Pestañas') }, get sub() { return t('Proyectos en pestañas arriba, los apartados en una fila de iconos y cada uno en su panel.') },
    boxes: [[0, 0, 100, 8, 'bar'], [0, 8, 100, 10, 'nav'], [4, 22, 92, 40, 'main']]
  },
  {
    id: 'lateral', get name() { return t('Barra lateral') }, get sub() { return t('Como una app de escritorio de siempre: el menú a la izquierda, con tus Claude, y el contenido al lado.') },
    boxes: [[0, 0, 100, 8, 'bar'], [0, 8, 24, 56, 'nav'], [27, 11, 70, 51, 'main']]
  },
  {
    id: 'columna', get name() { return t('Columna') }, get sub() { return t('Una sola columna estrecha, como en el móvil, con las pestañas abajo. Para tener la app a un lado de la pantalla.') },
    boxes: [[0, 0, 100, 8, 'bar'], [34, 10, 32, 44, 'main'], [34, 55, 32, 8, 'nav']]
  },
  {
    id: 'tablero', get name() { return t('Tablero') }, get sub() { return t('Fichas grandes con lo importante de cada apartado de un vistazo; se abre la que pulsas.') },
    boxes: [[0, 0, 100, 8, 'bar'], [4, 12, 28, 22, 'tile'], [36, 12, 28, 22, 'tile'], [68, 12, 28, 22, 'tile'], [4, 38, 28, 22, 'tile'], [36, 38, 28, 22, 'tile'], [68, 38, 28, 22, 'accent']]
  },
  {
    id: 'consola', get name() { return t('Consola') }, get sub() { return t('Densa y de letra fija, con órdenes numeradas a la izquierda y una línea de estado abajo. Para manejarla con el teclado.') },
    boxes: [[0, 0, 100, 6, 'bar'], [0, 6, 18, 52, 'nav'], [20, 8, 78, 48, 'main'], [0, 58, 100, 6, 'accent']]
  },
  {
    id: 'dividida', get name() { return t('Dos paneles') }, get sub() { return t('Dos apartados a la vez, uno al lado del otro: por ejemplo los Chats mientras contestas en Decidir.') },
    boxes: [[0, 0, 100, 8, 'bar'], [2, 11, 47, 51, 'pane'], [51, 11, 47, 51, 'pane']]
  },
  {
    id: 'mosaico', get name() { return t('Mosaico') }, get sub() { return t('Cuatro paneles grandes a la vez, cada uno con el apartado que elijas; uno se agranda con un clic.') },
    boxes: [[0, 0, 100, 8, 'bar'], [2, 11, 47, 25, 'pane'], [51, 11, 47, 25, 'pane'], [2, 38, 47, 24, 'pane'], [51, 38, 47, 24, 'pane']]
  },
  {
    id: 'mapa', get name() { return t('Mapa') }, get sub() { return t('El mapa de tus Claude ocupa toda la ventana; los apartados se abren en un cajón a la derecha.') },
    boxes: [[0, 0, 100, 64, 'map'], [60, 4, 38, 56, 'main'], [20, 56, 36, 6, 'nav']]
  }
]

export const layoutOf = (id: string | undefined): LayoutMeta => LAYOUTS.find((l) => l.id === id) ?? LAYOUTS[0]
