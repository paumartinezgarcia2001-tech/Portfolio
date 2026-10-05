/**
 * C11d · Efecto de monitor CRT sobre toda la web pública (Luna, 05-10-2026).
 *
 * Tres niveles, de más a menos compatible (src/components/CRT.astro):
 * 1. Base, solo CSS (siempre que `enabled`): scanlines, máscara de fósforo RGB,
 *    viñeta, resplandor y aberración cromática del texto, y parpadeo. El texto
 *    se sigue pudiendo seleccionar, leer con lector de pantalla e indexar.
 * 2. Curvatura de barril con un filtro SVG (`curvature.enabled`, apagada por
 *    defecto): consume bastante, Safari no la pinta bien (allí no se aplica) y
 *    los clics no se curvan (el puntero sigue en la posición sin deformar).
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
  /** Nivel 2 · curvatura de barril (filtro SVG). */
  curvature: {
    enabled: false,
    /**
     * Cuánto se curva: desplazamiento en las esquinas, en fracción del lado
     * mayor de la ventana. 0,03 es sutil (casi no se nota el desfase del clic).
     */
    strength: 0.03,
    /** Separación de los canales rojo y azul, en px. */
    rgbShift: 1,
  },
} as const;
