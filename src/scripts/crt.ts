/**
 * C11d · CRT: lo que no se puede hacer solo con CSS (src/config/crt.ts).
 *
 * - Nivel 2: genera con un <canvas> el mapa de desplazamiento de la curvatura
 *   de barril, lo pasa al <feImage> del filtro y marca `html[data-crt-curved]`.
 *   No se aplica en Safari, que pinta mal los filtros SVG sobre HTML.
 * - Nivel 3: detecta la API HTML-in-Canvas y marca `html[data-crt-html-in-canvas]`.
 *
 * El ClientRouter copia los atributos del <html> nuevo al navegar, así que las
 * marcas se vuelven a poner tras cada cambio de página.
 */
import { CRT } from '../config/crt';

const root = document.documentElement;
const lessEffects = window.matchMedia('(prefers-contrast: more), (forced-colors: active)');
const isSafari = /^((?!chrome|chromium|crios|fxios|edg|android).)*safari/i.test(navigator.userAgent);
const supportsHtmlInCanvas =
  typeof CanvasRenderingContext2D !== 'undefined' && 'drawElementImage' in CanvasRenderingContext2D.prototype;

/** Resolución del mapa: se estira a toda la ventana (el desplazamiento varía suave). */
const MAP_SIZE = 256;
let mapUrl: string | null = null;

/**
 * Mapa de la curvatura de barril. Para cada punto (u, v) ∈ [−1, 1]², el filtro
 * toma el color de (u, v)·(1 + k·r²): el centro queda igual y las esquinas se
 * encogen hacia dentro. R guarda el desplazamiento horizontal y G el vertical,
 * centrados en 0,5 (u·r² va de −2 a 2, de ahí el /4).
 */
function barrelMap(): string | null {
  const canvas = document.createElement('canvas');
  canvas.width = MAP_SIZE;
  canvas.height = MAP_SIZE;
  const context = canvas.getContext('2d');
  if (!context) return null;
  const image = context.createImageData(MAP_SIZE, MAP_SIZE);
  for (let y = 0; y < MAP_SIZE; y++) {
    const v = ((y + 0.5) / MAP_SIZE) * 2 - 1;
    for (let x = 0; x < MAP_SIZE; x++) {
      const u = ((x + 0.5) / MAP_SIZE) * 2 - 1;
      const r2 = u * u + v * v;
      const i = (y * MAP_SIZE + x) * 4;
      image.data[i] = Math.round(255 * (0.5 + (u * r2) / 4));
      image.data[i + 1] = Math.round(255 * (0.5 + (v * r2) / 4));
      image.data[i + 2] = 128;
      image.data[i + 3] = 255;
    }
  }
  context.putImageData(image, 0, 0);
  return canvas.toDataURL('image/png');
}

/** Ajusta el filtro al tamaño de la ventana. */
function sizeCurvature(): boolean {
  const filter = document.getElementById('crt-barrel');
  const feImage = filter?.querySelector('feImage');
  const displacement = filter?.querySelector('feDisplacementMap');
  if (!feImage || !displacement) return false;
  mapUrl ??= barrelMap();
  if (!mapUrl) return false;
  const width = document.body.clientWidth || window.innerWidth;
  const height = document.body.clientHeight || window.innerHeight;
  feImage.setAttribute('href', mapUrl);
  feImage.setAttribute('width', String(width));
  feImage.setAttribute('height', String(height));
  // Con el mapa en [0,25; 0,75], en la esquina el desplazamiento es escala/2.
  displacement.setAttribute('scale', String(2 * CRT.curvature.strength * Math.max(width, height)));
  return true;
}

function mark(): void {
  if (!CRT.enabled) return;
  if (supportsHtmlInCanvas) {
    // Nivel 3 · aquí se montaría el shader WebGL real sobre el DOM
    // (p. ej. `import('./crt-webgl')`) cuando la API salga del origin trial.
    root.dataset.crtHtmlInCanvas = '';
  }
  const curved = CRT.curvature.enabled && !isSafari && !lessEffects.matches && sizeCurvature();
  if (curved) root.dataset.crtCurved = '';
  else delete root.dataset.crtCurved;
}

mark();
document.addEventListener('astro:after-swap', mark);
lessEffects.addEventListener('change', mark);
if (CRT.curvature.enabled) {
  window.addEventListener('resize', () => {
    if (root.dataset.crtCurved !== undefined) sizeCurvature();
  });
}
