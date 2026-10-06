/**
 * C11d · Efecto de monitor CRT sobre toda la web pública (Luna, 05-10-2026).
 *
 * Tres niveles (src/components/CRT.astro):
 * 1. Capa CSS (siempre que `enabled`): scanlines, máscara de fósforo RGB,
 *    viñeta, resplandor y aberración cromática del texto, y parpadeo. El texto
 *    se sigue pudiendo seleccionar, leer con lector de pantalla e indexar.
 * 2. Bloom (`bloom`): halo de luz con sombras CSS solo alrededor de los neones.
 *    Curvatura de barril (`curvature`, apagada en producción, Luna, 05-10-2026):
 *    filtro SVG sobre toda la página. Consume mucho: mientras algo se mueve (la
 *    barra de noticias, el parpadeo, el cursor, el vídeo) el navegador lo
 *    recalcula en cada fotograma, y los clics no se curvan.
 * 3. API HTML-in-Canvas (`drawElementImage`, en origin trial en Chromium): solo
 *    se detecta y se marca `html[data-crt-html-in-canvas]`; el shader WebGL real
 *    queda como mejora progresiva para cuando la API sea estable.
 *
 * Todo el efecto se quita con `prefers-contrast: more`, con colores forzados y
 * al imprimir; el parpadeo, también con `prefers-reduced-motion`.
 * El panel oculto (AdminLayout) no lo lleva.
 */
export const CRT = {
  /** Interruptor general. */
  enabled: true,
  /** Parpadeo sutil de la capa (opacidad 0,95 ↔ 1 cada 0,12 s). */
  flicker: true,
  /**
   * Tamaño del «píxel» del tubo, en px CSS: grosor de cada scanline y de cada
   * franja de fósforo (rojo, verde, azul). Engordado de 1 a 2 (Luna, 05-10-2026).
   */
  pixel: 2,
  /**
   * Nivel 2 · curvatura de barril. Apagada en producción (Luna, 05-10-2026);
   * se recupera con `enabled: true`.
   */
  curvature: {
    enabled: false,
    /**
     * Cuánto se curva: desplazamiento en las esquinas, en fracción del lado
     * mayor de la ventana. 0,03 es sutil (casi no se nota el desfase del clic).
     */
    strength: 0.03,
  },
  /**
   * Bloom: halo de luz alrededor de los neones del color de la sección (barra
   * de noticias, ítem del menú, rotulador, cursor y botones del reproductor).
   * Con sombras CSS en esos elementos, no con un filtro sobre toda la página
   * (Luna, 05-10-2026: el filtro iba a tirones).
   */
  bloom: {
    enabled: true,
    /** Alcance del halo ancho, en px CSS (el corto es un tercio). */
    radius: 14,
    /** Intensidad del halo ancho (0–1). */
    strength: 0.6,
  },
} as const;
