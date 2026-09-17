/**
 * Filtro pixelado (C11). La fase 3 ajusta estos valores tras revisar la
 * legibilidad en todos los paneles.
 */
export const PIXEL = {
  /** Interruptor general de los tres efectos. */
  enabled: true,
  /** C11a · rejilla tipo LCD encima de toda la web. */
  overlay: {
    /** Lado de cada celda, en px CSS. */
    cell: 3,
    /** Grosor de las líneas entre celdas, en px CSS. */
    line: 1,
    /** Opacidad de la rejilla (0–1). */
    opacity: 0.12,
  },
  /** C11b · pixelado real del vídeo (fase 3): tamaño del bloque en px. */
  media: {
    block: 8,
  },
  /** C11c · transición de píxeles (fase 3). */
  transition: {
    /** Lado de cada cuadrado, en px. */
    block: 24,
    /** Duración en ms. */
    duration: 450,
  },
} as const;
