/**
 * C11d · Efecto de monitor CRT sobre toda la web pública (Luna, 05-10-2026).
 *
 * Tres niveles (src/components/CRT.astro):
 * 1. Capa CSS (siempre que `enabled`): scanlines, máscara de fósforo RGB,
 *    viñeta, resplandor y aberración cromática del texto, y parpadeo. El texto
 *    se sigue pudiendo seleccionar, leer con lector de pantalla e indexar.
 * 2. Filtro SVG sobre toda la página (`curvature` y `bloom`), en todos los
 *    navegadores, Safari incluido: curvatura de barril (apagada en producción,
 *    Luna, 05-10-2026) y bloom (lo brillante «sangra» luz). Consume: mientras algo
 *    se mueve (la barra de noticias, el parpadeo) el navegador lo recalcula en
 *    cada fotograma. La separación RGB se hace con `text-shadow` y no en el
 *    filtro, que costaba el doble. Los clics no se curvan (el puntero sigue en
 *    la posición sin deformar); con la curvatura sutil casi no se nota.
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
  /** Nivel 2 · bloom: halo de luz alrededor de lo más brillante. */
  bloom: {
    enabled: true,
    /** Brillo (0–1) a partir del cual algo emite halo: así brillan los neones del acento y no el papel. */
    threshold: 0.8,
    /** Radio del halo (desviación del desenfoque), en px. */
    radius: 6,
    /** Cuánta luz suma el halo (0–1). */
    strength: 0.55,
  },
} as const;
