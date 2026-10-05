/**
 * Filtro pixelado (C11). Valores revisados en la fase 3 (18-09-2026).
 *
 * El vídeo de Media NO se pixela (D40, decisión de Luna del 18-09-2026): se ve
 * nítido. Por eso ya no hay ajustes de `media`.
 *
 * La rejilla LCD (C11a) está **apagada** (Luna, 04-10-2026): con su
 * transparencia ensuciaba toda la web. Para recuperarla: `overlay.enabled: true`.
 *
 * Transición de píxeles (C11c), revisada el 05-10-2026 (Luna): sin
 * deslizamiento. Primero se pixela la pantalla vieja y, cuando está llena, se
 * despixela mostrando la nueva. El color sigue al acento (como la barra de
 * noticias).
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
  /** C11c · transición de píxeles al cambiar de sección. */
  transition: {
    enabled: true,
    /** Lado de cada cuadrado, en px. */
    block: 24,
    /** ms que tarda en llenarse de cuadrados la pantalla que se deja. */
    coverDuration: 450,
    /** ms que tardan en desaparecer los cuadrados sobre la página nueva. */
    revealDuration: 450,
  },
} as const;
