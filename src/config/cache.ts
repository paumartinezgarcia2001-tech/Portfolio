/**
 * Caché de las páginas públicas (§6). Las respuestas se guardan unos 60 s en
 * la red de Cloudflare y se sirven «caducadas» hasta 5 min mientras se
 * regeneran. El panel (fase 6) purga por etiqueta al guardar.
 */
export const CACHE_TAGS = {
  /** Ajustes (texto de la barra de noticias). Está en todas las páginas. */
  settings: 'settings',
  /** Bolos: next dates, archive y la próxima fecha de la barra. */
  gigs: 'gigs',
} as const;

export const PUBLIC_CACHE = {
  maxAge: 60,
  swr: 300,
  tags: [CACHE_TAGS.settings, CACHE_TAGS.gigs],
};
