/**
 * Secciones de la web, en el orden del menú (C05).
 * Los colores viven en `src/styles/tokens.css`; aquí solo se nombra el token.
 * `href` es la ruta lógica, sin el `base`: al pintarla, pásala por
 * `withBase()` (src/lib/url.ts).
 */
import { withoutBase } from '../lib/url';

export type SectionKey = 'info' | 'next' | 'media' | 'archive' | 'contact';

/** Valor de `html[data-section]`. `none` = 404 y páginas legales. */
export type SectionState = SectionKey | 'none';

export interface Section {
  key: SectionKey;
  /** Etiqueta del menú: en minúsculas y en inglés, tal cual el brief. */
  label: string;
  href: string;
  /** Token de color propio de la sección. */
  colorVar: `--c-${string}`;
}

export const SECTIONS = [
  { key: 'info', label: 'info', href: '/', colorVar: '--c-info' },
  { key: 'next', label: 'next dates', href: '/next-dates', colorVar: '--c-next' },
  { key: 'media', label: 'media', href: '/media', colorVar: '--c-media' },
  { key: 'archive', label: 'archive', href: '/archive', colorVar: '--c-archive' },
  { key: 'contact', label: 'contact', href: '/contact', colorVar: '--c-contact' },
] as const satisfies readonly Section[];

/** Token de color del reproductor (C06). */
export const PLAYER_COLOR_VAR = '--c-player';

export function getSection(key: SectionKey): Section {
  const section = SECTIONS.find((s) => s.key === key);
  if (!section) throw new Error(`Sección desconocida: ${key}`);
  return section;
}

/** Devuelve la sección que corresponde a una ruta (con o sin `base` y barra final). */
export function sectionFromPath(pathname: string): SectionState {
  const clean = withoutBase(pathname).replace(/\/+$/, '') || '/';
  return SECTIONS.find((s) => s.href === clean)?.key ?? 'none';
}
