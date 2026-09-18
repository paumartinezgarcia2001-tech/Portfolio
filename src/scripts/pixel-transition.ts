/**
 * C11c · Transición de píxeles.
 *
 * Al entrar en una sección, el panel nuevo llega cubierto de cuadrados de
 * 24 px del color de esa sección, que desaparecen en orden aleatorio en unos
 * 450 ms (`src/config/pixel.ts`), a la vez que el panel se desliza (C08).
 *
 * - El canvas tiene un píxel por cuadrado y se amplía con
 *   `image-rendering: pixelated`: cuesta casi nada dibujarlo.
 * - Va dentro de #panel: en escritorio viaja con el panel en la view
 *   transition (por debajo del menú); en móvil queda por encima del menú
 *   mientras este sale (capa 20, §4.3).
 * - Sin movimiento con `prefers-reduced-motion`.
 */
import type { TransitionBeforeSwapEvent } from 'astro:transitions/client';
import { PIXEL } from '../config/pixel';
import type { SectionState } from '../config/sections';
import { clearedCount, pixelGrid, shuffledOrder } from '../lib/pixels';

const SECTION_COLOR: Record<SectionState, string> = {
  info: '--c-info',
  next: '--c-next',
  media: '--c-media',
  archive: '--c-archive',
  contact: '--c-contact',
  none: '--c-info',
};

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
let pendingTransition: ViewTransition | undefined;

/** Color propio de la sección que entra (el acento todavía se está animando). */
function sectionColor(): string {
  const root = document.documentElement;
  const token = SECTION_COLOR[(root.dataset.section ?? 'none') as SectionState] ?? '--c-info';
  return getComputedStyle(root).getPropertyValue(token).trim() || '#ff00ff';
}

/** Cubre el panel y devuelve la función que arranca la disolución. */
function cover(panel: HTMLElement): (() => void) | null {
  const { block, duration } = PIXEL.transition;
  const width = panel.clientWidth;
  const height = panel.clientHeight;
  if (!width || !height) return null;

  const { cols, rows } = pixelGrid(width, height, block);
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  if (!context) return null;
  canvas.width = cols;
  canvas.height = rows;
  canvas.style.width = `${cols * block}px`;
  canvas.style.height = `${rows * block}px`;
  context.fillStyle = sectionColor();
  context.fillRect(0, 0, cols, rows);

  const layer = document.createElement('div');
  layer.className = 'pixel-transition';
  layer.setAttribute('aria-hidden', 'true');
  layer.appendChild(canvas);
  // appendChild: los tipos de Workers (HTMLRewriter) redefinen `append`.
  panel.appendChild(layer);

  const total = cols * rows;
  const order = shuffledOrder(total);
  let cleared = 0;
  let startedAt: number | null = null;

  const frame = (now: number) => {
    if (!layer.isConnected) return;
    startedAt ??= now;
    const target = clearedCount(now - startedAt, duration, total);
    for (; cleared < target; cleared++) {
      const index = order[cleared] as number;
      context.clearRect(index % cols, Math.floor(index / cols), 1, 1);
    }
    if (cleared >= total) layer.remove();
    else requestAnimationFrame(frame);
  };
  return () => requestAnimationFrame(frame);
}

document.addEventListener('astro:before-swap', (event) => {
  pendingTransition = (event as TransitionBeforeSwapEvent).viewTransition;
});

document.addEventListener('astro:after-swap', () => {
  const transition = pendingTransition;
  pendingTransition = undefined;
  if (!PIXEL.enabled || !PIXEL.transition.enabled || reducedMotion.matches) return;
  const panel = document.getElementById('panel');
  const start = panel ? cover(panel) : null;
  if (!start) return;
  // Empieza con el deslizamiento: cuando la view transition tiene sus capas listas.
  void (transition ? transition.ready.catch(() => undefined) : Promise.resolve()).then(start);
});
