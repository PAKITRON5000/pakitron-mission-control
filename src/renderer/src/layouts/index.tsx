// EV131: each shape of the app but the base one, in its own file, loaded only when it is chosen (the window's main bundle
// does not grow with them). What each one is: layouts/meta.ts.
import { lazy, type LazyExoticComponent, type ComponentType } from 'react'
import type { LayoutId } from '../../../core/types'

export const LAYOUT_VIEWS: Partial<Record<LayoutId, LazyExoticComponent<ComponentType>>> = {
  lateral: lazy(() => import('./Lateral')),
  columna: lazy(() => import('./Columna')),
  tablero: lazy(() => import('./Tablero')),
  consola: lazy(() => import('./Consola')),
  dividida: lazy(() => import('./Dividida')),
  mosaico: lazy(() => import('./Mosaico')),
  mapa: lazy(() => import('./Mapa'))
}
