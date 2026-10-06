/**
 * Colores de la web que se pueden cambiar desde el panel oculto (página
 * «colores», Luna, 06-10-2026). Los valores por defecto son los de
 * src/styles/tokens.css: si cambias uno allí, cámbialo también aquí
 * (tests/unit/theme.test.ts lo comprueba).
 *
 * Los textos no se eligen aparte: el diseño usa los dos fondos al revés, así
 * que el texto del menú es el fondo de la página y el de la página es el
 * fondo del menú (y el texto sobre los neones, también ese oscuro).
 */
import type { SectionKey } from './sections';

export type ThemeColorKey = SectionKey | 'menuBg' | 'panelBg' | 'player';

export interface Theme {
  info: string;
  next: string;
  media: string;
  archive: string;
  contact: string;
  /** Fondo de la columna del menú (y texto de la página y de los neones). */
  menuBg: string;
  /** Fondo de la página (y texto del menú). */
  panelBg: string;
  /** Color propio del reproductor. */
  player: string;
  /** El reproductor usa el color de cada sección, como la barra y el rotulador. */
  playerFollowsSection: boolean;
}

export const DEFAULT_THEME: Theme = {
  info: '#ff00ff',
  next: '#00ffff',
  media: '#ffff00',
  archive: '#00ff00',
  contact: '#ff5f1f',
  menuBg: '#27272b',
  panelBg: '#c5c7d6',
  player: '#bf00ff',
  playerFollowsSection: false,
};

/** Campos de color del panel, en orden, con su etiqueta y su token CSS. */
export const THEME_FIELDS: readonly { key: ThemeColorKey; label: string; token: `--c-${string}`; group: 'sections' | 'backgrounds' | 'player' }[] = [
  { key: 'info', label: 'info', token: '--c-info', group: 'sections' },
  { key: 'next', label: 'next dates', token: '--c-next', group: 'sections' },
  { key: 'media', label: 'media', token: '--c-media', group: 'sections' },
  { key: 'archive', label: 'archive', token: '--c-archive', group: 'sections' },
  { key: 'contact', label: 'contact', token: '--c-contact', group: 'sections' },
  { key: 'menuBg', label: 'fondo del menú', token: '--c-menu-bg', group: 'backgrounds' },
  { key: 'panelBg', label: 'fondo de la página', token: '--c-panel-bg', group: 'backgrounds' },
  { key: 'player', label: 'reproductor', token: '--c-player', group: 'player' },
];

/**
 * Contraste mínimo que el panel pide (WCAG AA para texto normal). Solo avisa:
 * se puede guardar igualmente.
 */
export const THEME_MIN_CONTRAST = 4.5;

/** Mínimo para los iconos del reproductor (WCAG 1.4.11, elementos que no son texto). */
export const THEME_MIN_ICON_CONTRAST = 3;
