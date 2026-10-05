/**
 * C01 · Cambio de color del acento al cambiar de sección, hecho en JS.
 *
 * Antes era solo una transición CSS de `--accent` (propiedad registrada con
 * `@property`). Safari en iPhone no la interpolaba bien: la barra y los píxeles
 * (C11c) saltaban de golpe de un color a otro. Ahora el color se calcula aquí
 * fotograma a fotograma y se escribe en línea en <html> (`--accent`), así que
 * la barra de noticias, el cursor, el rotulador y la transición de píxeles
 * cambian a la vez, igual en todos los navegadores.
 *
 * - Interpolación lineal en sRGB, durante `--dur-accent` (src/styles/tokens.css).
 * - La transición CSS queda solo para cuando no hay JS (`html:not(.js)`).
 * - Si se navega a mitad de un cambio, el siguiente arranca desde el color que
 *   se ve en ese momento.
 */
import type { TransitionBeforeSwapEvent } from 'astro:transitions/client';
import type { SectionState } from '../config/sections';
import { formatColor, mixColor, parseColor, type Rgb } from '../lib/color';

const root = document.documentElement;

const SECTION_TOKEN: Record<SectionState, string> = {
  info: '--c-info',
  next: '--c-next',
  media: '--c-media',
  archive: '--c-archive',
  contact: '--c-contact',
  none: '--c-info',
};

const FALLBACK: Rgb = [255, 0, 255];

/** Color propio de una sección (los tokens `--c-*` de :root no cambian). */
function sectionColor(section: string | undefined): Rgb {
  const token = SECTION_TOKEN[(section ?? 'none') as SectionState] ?? '--c-info';
  return parseColor(getComputedStyle(root).getPropertyValue(token)) ?? FALLBACK;
}

/** Duración del cambio, en ms (`--dur-accent`). */
function duration(): number {
  const value = getComputedStyle(root).getPropertyValue('--dur-accent').trim();
  const ms = value.endsWith('ms') ? parseFloat(value) : parseFloat(value) * 1000;
  return Number.isFinite(ms) && ms >= 0 ? ms : 500;
}

let from: Rgb = sectionColor(root.dataset.section);
let to: Rgb = from;
/** ¿Hay un cambio de color en marcha? */
let animating = false;
/** Hora del primer fotograma del cambio (`null` hasta que se pinta). */
let startedAt: number | null = null;
let length = 0;
/** Cada cambio tiene su número: un bucle de fotogramas viejo se para solo. */
let generation = 0;

/**
 * Color del acento en el instante `now`: el mismo para todos los que lo pinten
 * en ese fotograma (barra, píxeles…). Hasta el primer fotograma, el de partida.
 */
export function accentAt(now: number = performance.now()): string {
  if (!animating) return formatColor(to);
  if (startedAt === null) return formatColor(from);
  const t = length > 0 ? (now - startedAt) / length : 1;
  return formatColor(mixColor(from, to, t));
}

function run(id: number): void {
  const frame = (now: number) => {
    if (id !== generation || !animating) return;
    startedAt ??= now;
    if (length > 0 && now - startedAt < length) {
      root.style.setProperty('--accent', accentAt(now));
      requestAnimationFrame(frame);
      return;
    }
    // Fin: manda otra vez la regla de la sección (mismo color).
    animating = false;
    root.style.removeProperty('--accent');
  };
  requestAnimationFrame(frame);
}

document.addEventListener('astro:before-swap', (event) => {
  const { newDocument } = event as TransitionBeforeSwapEvent;
  // El ClientRouter copia los atributos del <html> nuevo: con el color actual
  // en línea, la barra no salta al color nuevo al cambiar la página.
  const current = parseColor(accentAt()) ?? from;
  generation += 1;
  animating = false;
  from = current;
  to = current;
  newDocument.documentElement.classList.add('js');
  newDocument.documentElement.style.setProperty('--accent', formatColor(current));
});

document.addEventListener('astro:after-swap', () => {
  to = sectionColor(root.dataset.section);
  length = duration();
  startedAt = null;
  animating = true;
  root.style.setProperty('--accent', formatColor(from));
  run(generation);
});
