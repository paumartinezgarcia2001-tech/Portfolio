/**
 * Filtro pixelado (C11). Valores revisados en la fase 3 (18-09-2026).
 *
 * El vídeo de Media NO se pixela (D40, decisión de Luna del 18-09-2026): se ve
 * nítido. Por eso ya no hay ajustes de `media`.
 *
 * La rejilla LCD (C11a) está **apagada** (Luna, 04-10-2026): con su
 * transparencia ensuciaba toda la web. La transición de píxeles al cambiar de
 * apartado (C11c) sigue igual. Para recuperarla: `overlay.enabled: true`.
 */
export const PIXEL = {
  /** Interruptor general de los efectos. */
  enabled: true,
  /** C11a · rejilla tipo LCD encima de toda la web (vídeo incluido). */
  overlay: {
    /** Apagada (Luna, 04-10-2026). No afecta a `transition`. */
    enabled: false,
    /** Lado de cada celda, en px CSS. */
    cell: 3,
    /** Grosor de las líneas entre celdas, en px CSS. */
    line: 1,
    /**
     * Opacidad de la rejilla (0–1). 0,12 revisado en la fase 3 en los cinco
     * paneles, el menú y el vídeo: se nota la textura y los textos se leen
     * igual (ver el resumen de la fase).
     */
    opacity: 0.12,
  },
  /** C11c · transición de píxeles al entrar en una sección. */
  transition: {
    enabled: true,
    /** Lado de cada cuadrado, en px. */
    block: 24,
    /** Duración en ms (el deslizamiento del panel dura 500). */
    duration: 450,
  },
} as const;
