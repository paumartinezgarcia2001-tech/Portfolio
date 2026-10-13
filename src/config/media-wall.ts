/**
 * Muro de Media (`<media-wall>`, D65): piezas (fotos, vídeos) y rótulos que caen
 * a velocidad constante por todo el panel. Cada pieza entra filtrada por arriba,
 * se aclara al pasar por el centro y se vuelve a filtrar al salir por abajo.
 *
 * - Las rutas son relativas a `PUBLIC_MEDIA_BASE_URL` (el bucket de R2) o URLs
 *   absolutas, como el vídeo de `src/config/media.ts`. Las piezas las prepara
 *   `npm run media:wall` (imagen JPG + AVIF y, si es vídeo, un bucle mudo en
 *   H.264 y AV1), que imprime la entrada para `items`.
 * - `enabled: false` vuelve al vídeo único de antes (`<media-video>`, C15).
 * - El muro es mudo: la banda sonora de Media es el reproductor de mixes (C06).
 * - Movimiento reducido: rejilla quieta. Sin WebGL: el bucle pre-renderizado de
 *   `fallback` (lo graba `npm run media:wall-render` con el mismo motor).
 */

/** Tratamientos de imagen (los pinta un shader, src/scripts/media-wall/shaders.ts). */
export const WALL_FILTERS = ['pixel', 'duotone', 'dither', 'rgb', 'halftone', 'scan'] as const;
export type WallFilter = (typeof WALL_FILTERS)[number];

export interface MediaWallItemConfig {
  /** Identificador estable (el slug de `npm run media:wall`). */
  id: string;
  kind: 'image' | 'video';
  /** Nombre para lectores de pantalla y para el visor. */
  title: string;
  /** Rótulo corto bajo la pieza; por defecto, el título. */
  caption?: string | undefined;
  /** La imagen (en los vídeos, también su póster). */
  image: { jpg: string; avif?: string | undefined };
  /** Bucle mudo. `av1` es opcional y se prefiere si el navegador lo decodifica. */
  video?: { mp4: string; av1?: string | undefined } | undefined;
  /** Tamaño de la imagen, en px: da la proporción de la pieza. */
  width: number;
  height: number;
  /** Punto que se mantiene a la vista si la pieza se recorta (0–1). */
  focusX?: number | undefined;
  focusY?: number | undefined;
  /** Filtro fijo; si no, el muro los reparte para que no se repitan seguidos. */
  filter?: WallFilter | undefined;
}

/** Bucle pre-renderizado para dispositivos sin WebGL (H.264, mudo). */
export interface WallFallbackVideo {
  mp4: string;
  poster: string;
  width: number;
  height: number;
}

export interface FilterTuning {
  /**
   * Cuánto filtro conserva la pieza al pasar por el centro (0 = nítida, 1 =
   * entera filtrada). En los bordes siempre llega a 1.
   */
  rest: number;
}

export interface MediaWallConfig {
  enabled: boolean;
  /**
   * Segundos que tarda una pieza en cruzar el panel de arriba abajo. La
   * velocidad (px/s) sale de aquí y del alto del panel: es constante y se ve
   * igual en un móvil que en una pantalla grande.
   */
  crossSeconds: number;
  /** Carriles (columnas) según el ancho del panel. */
  lanes: { narrow: number; wide: number; wideFrom: number };
  /**
   * Multiplicador de velocidad por carril (se repite si hay más carriles).
   * Todos constantes; distintos entre sí para que no caigan en bloque.
   */
  laneSpeeds: readonly number[];
  /** Hueco vertical entre piezas, en fracción del ancho del carril (mín.–máx.). */
  gap: readonly [number, number];
  /** Probabilidad de que entre dos piezas caiga un rótulo con un bolo del archivo. */
  tagChance: number;
  /** Cuántos bolos del archivo (los más recientes) se usan para los rótulos. */
  tagCount: number;
  /** Vídeos decodificándose a la vez como máximo (el resto, con su imagen). */
  maxVideos: { narrow: number; wide: number };
  /** Ajustes de cada filtro. */
  filters: Record<WallFilter, FilterTuning>;
  items: MediaWallItemConfig[];
  /** Bucles pre-renderizados para dispositivos sin WebGL (4:5 y 9:16). */
  fallback: { wide: WallFallbackVideo; narrow: WallFallbackVideo } | null;
}

export const MEDIA_WALL: MediaWallConfig = {
  enabled: true,
  crossSeconds: 20,
  lanes: { narrow: 2, wide: 3, wideFrom: 640 },
  laneSpeeds: [1, 0.84, 1.13],
  gap: [0.18, 0.55],
  tagChance: 0.4,
  tagCount: 24,
  maxVideos: { narrow: 2, wide: 4 },
  filters: {
    // Pixelado de la web (C11): grueso en los bordes, nítido en el centro (D40).
    pixel: { rest: 0 },
    // Luminancia → del fondo #27272B al acento de Media.
    duotone: { rest: 0.85 },
    // 1 bit con trama Bayer, en celdas de 2 px: pantalla LCD.
    dither: { rest: 0.55 },
    // Separación RGB y cortes de glitch a ráfagas.
    rgb: { rest: 0.2 },
    // Trama de puntos de imprenta, como un cartel.
    halftone: { rest: 0.5 },
    // Una línea de escaneo la revela al entrar y la borra al salir.
    scan: { rest: 0 },
  },
  /*
   * Piezas de prueba (13-10-2026) sacadas de los carteles animados que hizo Pau
   * para La Casa de las Muñecas e Insulto Club (`Raw_Files/Audiovisual Content`).
   * TODO(Q02): añadir fotos y vídeos de sesiones cuando Pau los elija.
   */
  items: [
    {
      id: 'lcdlm-barcelona',
      kind: 'video',
      title: 'La Casa de las Muñecas · Barcelona, cartel animado',
      caption: 'LCDLM · BARCELONA',
      image: { jpg: 'wall/lcdlm-barcelona-a937988e/still.jpg', avif: 'wall/lcdlm-barcelona-a937988e/still.avif' },
      video: { mp4: 'wall/lcdlm-barcelona-a937988e/loop.mp4', av1: 'wall/lcdlm-barcelona-a937988e/loop-av1.mp4' },
      width: 720,
      height: 1280,
    },
    {
      id: 'insulto-cartel',
      kind: 'image',
      title: 'Insulto Club · Sala Siroco, cartel',
      caption: 'INSULTO · LINE UP',
      image: { jpg: 'wall/insulto-cartel-418431a4/still.jpg', avif: 'wall/insulto-cartel-418431a4/still.avif' },
      width: 720,
      height: 1280,
    },
    {
      id: 'lcdlm-malaga',
      kind: 'video',
      title: 'La Casa de las Muñecas · Málaga, cartel animado',
      caption: 'LCDLM · MÁLAGA',
      image: { jpg: 'wall/lcdlm-malaga-f6e48805/still.jpg', avif: 'wall/lcdlm-malaga-f6e48805/still.avif' },
      video: { mp4: 'wall/lcdlm-malaga-f6e48805/loop.mp4', av1: 'wall/lcdlm-malaga-f6e48805/loop-av1.mp4' },
      width: 720,
      height: 1280,
    },
    {
      id: 'lcdlm-barcelona-cartel',
      kind: 'image',
      title: 'La Casa de las Muñecas · Barcelona, cartel',
      caption: 'LCDLM · BCN · 27.11',
      image: {
        jpg: 'wall/lcdlm-barcelona-cartel-5a5bb952/still.jpg',
        avif: 'wall/lcdlm-barcelona-cartel-5a5bb952/still.avif',
      },
      width: 720,
      height: 1280,
    },
    {
      id: 'insulto-siroco',
      kind: 'video',
      title: 'Insulto Club · Sala Siroco, cartel animado',
      caption: 'INSULTO · SIROCO',
      image: { jpg: 'wall/insulto-siroco-60b62e2d/still.jpg', avif: 'wall/insulto-siroco-60b62e2d/still.avif' },
      video: { mp4: 'wall/insulto-siroco-60b62e2d/loop.mp4', av1: 'wall/insulto-siroco-60b62e2d/loop-av1.mp4' },
      width: 720,
      height: 1280,
    },
    {
      id: 'lcdlm-malaga-cartel',
      kind: 'image',
      title: 'La Casa de las Muñecas · Málaga, cartel',
      caption: 'LCDLM · MÁLAGA · CARTEL',
      image: { jpg: 'wall/lcdlm-malaga-cartel-88659d29/still.jpg', avif: 'wall/lcdlm-malaga-cartel-88659d29/still.avif' },
      width: 720,
      height: 1280,
    },
    {
      id: 'insulto-cartel-2',
      kind: 'image',
      title: 'Insulto Club · Sala Siroco, cartel (detalle)',
      caption: 'INSULTO · 00–06',
      image: { jpg: 'wall/insulto-cartel-2-3013e4f8/still.jpg', avif: 'wall/insulto-cartel-2-3013e4f8/still.avif' },
      width: 720,
      height: 1280,
    },
  ],
  // Bucles de 20 s grabados con `npm run media:wall-render` (13-10-2026) a
  // partir de las piezas de arriba. Regenerarlos al cambiar las piezas.
  fallback: {
    wide: { mp4: 'wall/wall-loop-4x5-a2d72909/loop.mp4', poster: 'wall/wall-loop-4x5-a2d72909/poster.jpg', width: 720, height: 900 },
    narrow: { mp4: 'wall/wall-loop-9x16-c4fdf0ef/loop.mp4', poster: 'wall/wall-loop-9x16-c4fdf0ef/poster.jpg', width: 720, height: 1280 },
  },
};
