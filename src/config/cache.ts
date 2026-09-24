/**
 * Caché de las páginas públicas (§6). Las respuestas se guardan unos 60 s en
 * la red de Cloudflare y se sirven «caducadas» hasta 5 min mientras se
 * regeneran. El panel (fase 6) purga por etiqueta al guardar.
 */
export const CACHE_TAGS = {
  /**
   * Ajustes: texto de la barra de noticias (en todas las páginas) y, desde la
   * fase 6 (P2), el texto de Info y el vídeo de Media.
   */
  settings: 'settings',
  /** Bolos: next dates, archive y la próxima fecha de la barra (todas las páginas). */
  gigs: 'gigs',
  /** Mixes del reproductor (columna izquierda de todas las páginas). */
  mixes: 'mixes',
} as const;

export type CacheTag = (typeof CACHE_TAGS)[keyof typeof CACHE_TAGS];

/**
 * Todas las páginas públicas llevan todas las etiquetas: la columna izquierda
 * (barra con la próxima fecha y reproductor) sale en todas. Al guardar desde
 * el panel se purga la etiqueta de lo que ha cambiado (src/actions/admin.ts).
 */
export const PUBLIC_CACHE = {
  maxAge: 60,
  swr: 300,
  tags: [CACHE_TAGS.settings, CACHE_TAGS.gigs, CACHE_TAGS.mixes],
};
