/**
 * Vídeo de Media (C15).
 *
 * - Las rutas son relativas a `PUBLIC_MEDIA_BASE_URL` (el dominio público del
 *   bucket R2) o URLs absolutas. Si falta esa variable, Media muestra un aviso.
 * - El bloque de `slug` a `mobile` lo imprime `scripts/video-to-hls.mjs` al
 *   terminar: se pega tal cual. `title`, `focusX`, `focusY` y `fullSet` se
 *   rellenan a mano.
 * - Más adelante podrá venir de `site_settings.video` (panel, fase 6).
 * - Sin pixelado (D40): el vídeo se ve nítido. La textura LCD global (C11a)
 *   sí pasa por encima, como en el resto de la web.
 */

export interface VideoRendition {
  /** Lista maestra HLS (`master.m3u8`). */
  hls: string;
  /** MP4 de respaldo, para navegadores sin HLS ni MSE o si falla el HLS. */
  mp4: string;
  /** Póster mientras carga: JPG y, si hay, AVIF (más ligero). */
  poster: { jpg: string; avif?: string };
  /** Tamaño del recorte, en px: da la proporción (4:5, 9:16…). */
  width: number;
  height: number;
}

export interface MediaVideoConfig extends VideoRendition {
  slug: string;
  /** Nombre del vídeo para lectores de pantalla. */
  title: string;
  /** ¿Tiene pista de audio? Sin audio no sale el botón de sonido. */
  audio: boolean;
  /**
   * Versión para pantallas estrechas (9:16). Se usa cuando la proporción del
   * panel se parece más a la suya que a la principal (móvil en vertical, una
   * ventana de escritorio muy estrecha…).
   */
  mobile?: VideoRendition | undefined;
  /** Punto que se mantiene a la vista cuando el panel recorta el vídeo (0–1). */
  focusX: number;
  focusY: number;
  /** Enlace opcional «ver set completo ↗» (C15). */
  fullSet?: { href: string; label: string } | null | undefined;
}

/**
 * Set completo de LAGRIMA en YouTube (C15, desde el minuto 42:21). Úsalo en
 * `fullSet` cuando el vídeo de Media sea un fragmento de ese set.
 */
export const LAGRIMA_FULL_SET = {
  href: 'https://www.youtube.com/watch?v=XokoqVkCmQg&t=2541s',
  label: 'ver set completo',
} as const;

/**
 * Vídeo de prueba (`Raw_Files/WEB PAGE FILES/VIDEO PRUEBA APARTADO MEDIA.mp4`,
 * 576×1024, 14 s, con audio), elegido por Luna el 18-09-2026 para montar la
 * sección. TODO(Q02): sustituirlo por el vídeo que elija Pau.
 */
export const MEDIA_VIDEO: MediaVideoConfig = {
  slug: 'prueba-media',
  title: 'Vídeo de prueba',
  audio: true,
  hls: 'video/prueba-media-598b3d11/4x5/master.m3u8',
  mp4: 'video/prueba-media-598b3d11/4x5/fallback.mp4',
  poster: { jpg: 'video/prueba-media-598b3d11/4x5/poster.jpg', avif: 'video/prueba-media-598b3d11/4x5/poster.avif' },
  width: 576,
  height: 720,
  mobile: {
    hls: 'video/prueba-media-598b3d11/9x16/master.m3u8',
    mp4: 'video/prueba-media-598b3d11/9x16/fallback.mp4',
    poster: { jpg: 'video/prueba-media-598b3d11/9x16/poster.jpg', avif: 'video/prueba-media-598b3d11/9x16/poster.avif' },
    width: 576,
    height: 1024,
  },
  focusX: 0.5,
  focusY: 0.5,
  // No es un fragmento del set de LAGRIMA: sin enlace.
  fullSet: null,
};
