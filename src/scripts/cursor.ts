/**
 * C10 · Cursor personalizado.
 * - Sigue al ratón con suavizado (interpolación del 50 % por fotograma) y se
 *   detiene cuando el ratón está quieto.
 * - Sobre enlaces y botones crece (×1,6); sobre un ítem del menú toma su
 *   color; al pulsar se encoge (×0,8); se oculta al salir de la ventana.
 * - En campos de texto, iframes y zonas marcadas con `data-native-cursor`
 *   (el widget de Turnstile, C17) se oculta y vuelve el cursor del sistema.
 * - Cualquier elemento puede pedir otro color con la custom property
 *   `--cursor-over` (se hereda). La usan los ítems del menú (su color), el
 *   reproductor (violeta) y las zonas con fondo de acento (oscuro), para que
 *   el círculo no desaparezca sobre ellas.
 */

const FINE_POINTER = window.matchMedia('(hover: hover) and (pointer: fine)');
const REDUCED_MOTION = window.matchMedia('(prefers-reduced-motion: reduce)');

const NATIVE_CURSOR_SELECTOR =
  'input, textarea, select, [contenteditable]:not([contenteditable="false"]), iframe, [data-native-cursor]';
const INTERACTIVE_SELECTOR = 'a[href], button, [role="button"], label, summary, [data-cursor-grow]';

const LERP = 0.5;
const SCALE_HOVER = 1.6;
const SCALE_PRESS = 0.8;
const EPSILON = 0.1;

const root = document.documentElement;

interface CursorState {
  x: number;
  y: number;
  targetX: number;
  targetY: number;
  scale: number;
  targetScale: number;
  hovering: boolean;
  pressed: boolean;
  hasPosition: boolean;
  frame: number | null;
}

const state: CursorState = {
  x: 0,
  y: 0,
  targetX: 0,
  targetY: 0,
  scale: 1,
  targetScale: 1,
  hovering: false,
  pressed: false,
  hasPosition: false,
  frame: null,
};

let enabled = false;

function getCursor(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[data-cursor]');
}

function render(el: HTMLElement): void {
  el.style.transform = `translate3d(${state.x}px, ${state.y}px, 0) scale(${state.scale})`;
}

function tick(): void {
  state.frame = null;
  const el = getCursor();
  if (!el) return;

  const smooth = !REDUCED_MOTION.matches;
  const dx = state.targetX - state.x;
  const dy = state.targetY - state.y;
  const ds = state.targetScale - state.scale;

  if (!smooth || (Math.abs(dx) < EPSILON && Math.abs(dy) < EPSILON && Math.abs(ds) < 0.001)) {
    state.x = state.targetX;
    state.y = state.targetY;
    state.scale = state.targetScale;
    render(el);
    return; // Quieto: se detiene el bucle.
  }

  state.x += dx * LERP;
  state.y += dy * LERP;
  state.scale += ds * LERP;
  render(el);
  state.frame = requestAnimationFrame(tick);
}

function schedule(): void {
  if (state.frame === null) state.frame = requestAnimationFrame(tick);
}

function updateScale(): void {
  state.targetScale = state.pressed ? SCALE_PRESS : state.hovering ? SCALE_HOVER : 1;
  schedule();
}

function setVisible(visible: boolean): void {
  const el = getCursor();
  if (!el) return;
  el.toggleAttribute('data-visible', visible);
}

/** Decide el aspecto del cursor según el elemento que hay debajo. */
function inspect(target: Element | null): void {
  const el = getCursor();
  // Durante una view transition el navegador dirige los eventos a <html>:
  // se mantiene el estado anterior hasta que termine.
  if (!el || !target || target === root) return;

  if (target.closest(NATIVE_CURSOR_SELECTOR)) {
    setVisible(false);
    return;
  }
  setVisible(state.hasPosition);

  state.hovering = target.closest(INTERACTIVE_SELECTOR) !== null;

  const color = getComputedStyle(target).getPropertyValue('--cursor-over').trim();
  if (color) el.style.setProperty('--cursor-color', color);
  else el.style.removeProperty('--cursor-color');

  updateScale();
}

function onPointerMove(event: PointerEvent): void {
  if (event.pointerType !== 'mouse') return;
  state.targetX = event.clientX;
  state.targetY = event.clientY;
  if (!state.hasPosition) {
    state.hasPosition = true;
    state.x = state.targetX;
    state.y = state.targetY;
    inspect(event.target instanceof Element ? event.target : null);
  }
  schedule();
}

function onPointerOver(event: PointerEvent): void {
  if (event.pointerType !== 'mouse') return;
  inspect(event.target instanceof Element ? event.target : null);
}

function onPointerDown(event: PointerEvent): void {
  if (event.pointerType !== 'mouse') return;
  state.pressed = true;
  updateScale();
}

function onPointerUp(): void {
  state.pressed = false;
  updateScale();
}

function onMouseOut(event: MouseEvent): void {
  // relatedTarget nulo = el ratón sale de la ventana (o entra en un iframe).
  if (event.relatedTarget === null) setVisible(false);
}

/** Tras cambiar de página, el contenido bajo el ratón es otro. */
function onAfterSwap(): void {
  applyRootClass();
  if (!enabled || !state.hasPosition) return;
  inspect(document.elementFromPoint(state.targetX, state.targetY));
}

function applyRootClass(): void {
  root.classList.toggle('has-cursor', enabled);
}

function enable(): void {
  if (enabled) return;
  enabled = true;
  applyRootClass();
  document.addEventListener('pointermove', onPointerMove, { passive: true });
  document.addEventListener('pointerover', onPointerOver, { passive: true });
  document.addEventListener('pointerdown', onPointerDown, { passive: true });
  document.addEventListener('pointerup', onPointerUp, { passive: true });
  document.addEventListener('mouseout', onMouseOut, { passive: true });
  window.addEventListener('blur', onPointerUp);
}

function disable(): void {
  if (!enabled) return;
  enabled = false;
  applyRootClass();
  setVisible(false);
  state.hasPosition = false;
  document.removeEventListener('pointermove', onPointerMove);
  document.removeEventListener('pointerover', onPointerOver);
  document.removeEventListener('pointerdown', onPointerDown);
  document.removeEventListener('pointerup', onPointerUp);
  document.removeEventListener('mouseout', onMouseOut);
  window.removeEventListener('blur', onPointerUp);
}

function sync(): void {
  if (FINE_POINTER.matches) enable();
  else disable();
}

sync();
FINE_POINTER.addEventListener('change', sync);
// El ClientRouter copia los atributos del <html> nuevo: hay que reponer la clase.
document.addEventListener('astro:after-swap', onAfterSwap);
