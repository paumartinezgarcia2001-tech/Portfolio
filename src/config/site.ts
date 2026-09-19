/**
 * Datos generales de la web (prompt maestro §1 y §8).
 * No pongas aquí datos personales (email, teléfono) ni el nombre del panel.
 */
export const SITE = {
  /** Alias con el que se presenta la web. */
  name: 'travest15m0',
  /** Nombre legal, solo para metadatos (JSON-LD). */
  personName: 'Pau Martínez García',
  jobTitle: 'DJ',
  lang: 'es',
  locale: 'es_ES',
  description: 'travest15m0 — DJ y productora de eventos afincada en Madrid.',
  social: {
    instagram: 'https://www.instagram.com/travest15m0/',
    soundcloud: 'https://soundcloud.com/travest15m0',
  },
  /** Texto inicial de la barra de noticias (fase 2: vendrá de `site_settings`). */
  tickerText: 'travest15m0 · DJ · Madrid',
} as const;

export type MobileView = 'page' | 'menu';

/**
 * Qué se ve al abrir la web en móvil (C02). `'menu'` = el menú a pantalla
 * completa (D44, Luna, 19-09-2026); `'page'` = la sección con el botón atrás.
 * El 404 y las páginas legales siempre abren la página. Navegar deja siempre
 * a la vista la página (src/scripts/app.ts).
 */
export const MOBILE_START_VIEW: MobileView = 'menu';

/** Anchura a partir de la cual la web se divide en dos mitades (§4.3). */
export const DESKTOP_MIN_WIDTH = 1024;
export const DESKTOP_MEDIA_QUERY = `(min-width: ${DESKTOP_MIN_WIDTH}px)`;
