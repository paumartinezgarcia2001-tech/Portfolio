/**
 * C11c · Transición de píxeles al cambiar de apartado (sin deslizamiento,
 * Luna, 05-10-2026).
 *
 * 1. Pixelado: la pantalla que se deja (el panel en escritorio; en móvil, lo
 *    que se vea, menú o página) se va llenando de cuadrados de 24 px en orden
 *    aleatorio (`PIXEL.transition.coverDuration`). Mientras tanto se descarga
 *    la página nueva; el cambio espera a que la pantalla esté llena.
 * 2. Despixelado: la página nueva aparece tapada por los mismos cuadrados, que
 *    desaparecen en orden aleatorio (`PIXEL.transition.revealDuration`).
 *
 * Los cuadrados llevan en cada fotograma el valor actual de `--accent`: el
 * color cambia a la vez y a la misma velocidad que la barra vertical de
 * noticias (transición de 0,5 s del acento, C01).
 *
 * - El canvas tiene un píxel por cuadrado y se amplía con
 *   `image-rendering: pixelated`: cuesta casi nada dibujarlo.
 * - Sin efecto con `prefers-reduced-motion` ni con colores forzados.
 */
import type { TransitionBeforePreparationEvent, TransitionBeforeSwapEvent } from 'astro:transitions/client';
import { PIXEL } from '../config/pixel';
import { DESKTOP_MEDIA_QUERY } from '../config/site';
import { clearedCount, pixelGrid, shuffledOrder } from '../lib/pixels';

const root = document.documentElement;
const desktop = window.matchMedia(DESKTOP_MEDIA_QUERY);
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const forcedColors = window.matchMedia('(forced-colors: active)');

/** ¿Hay transición de píxeles en esta navegación? (app.ts lo usa en móvil). */
export function pixelTransitionActive(): boolean {
  return PIXEL.enabled && PIXEL.transition.enabled && !reducedMotion.matches && !forcedColors.matches;
}

/** Color actual del acento: el mismo que tiene la barra de noticias en este fotograma. */
function accentColor(): string {
  return getComputedStyle(root).getPropertyValue('--accent').trim() || '#ff00ff';
}

type Mode = 'cover' | 'reveal';

/** Capa con un canvas de un píxel por cuadrado. */
class PixelLayer {
  readonly element: HTMLDivElement;
  private readonly context: CanvasRenderingContext2D;
  private readonly cols: number;
  private readonly total: number;
  private readonly order: Uint32Array;

  private constructor(context: CanvasRenderingContext2D, cols: number, rows: number) {
    const { block } = PIXEL.transition;
    const canvas = context.canvas;
    canvas.style.width = `${cols * block}px`;
    canvas.style.height = `${rows * block}px`;
    this.context = context;
    this.cols = cols;
    this.total = cols * rows;
    this.order = shuffledOrder(this.total);
    this.element = document.createElement('div');
    this.element.className = 'pixel-transition';
    this.element.setAttribute('aria-hidden', 'true');
    // appendChild: los tipos de Workers (HTMLRewriter) redefinen `append`.
    this.element.appendChild(canvas);
  }

  /** `filled`: arranca tapando todo (despixelado) o vacía (pixelado). */
  static create(width: number, height: number, filled: boolean): PixelLayer | null {
    if (!width || !height) return null;
    const { cols, rows } = pixelGrid(width, height, PIXEL.transition.block);
    const canvas = document.createElement('canvas');
    canvas.width = cols;
    canvas.height = rows;
    const context = canvas.getContext('2d');
    if (!context) return null;
    if (filled) {
      context.fillStyle = accentColor();
      context.fillRect(0, 0, cols, rows);
    }
    return new PixelLayer(context, cols, rows);
  }

  /** Pinta del color dado los cuadrados que ya estén pintados. */
  private recolor(color: string): void {
    const { context } = this;
    context.globalCompositeOperation = 'source-in';
    context.fillStyle = color;
    context.fillRect(0, 0, context.canvas.width, context.canvas.height);
    context.globalCompositeOperation = 'source-over';
  }

  /**
   * `cover`: aparecen cuadrados hasta llenar la capa, que se queda puesta.
   * `reveal`: desaparecen hasta vaciarla, y entonces se quita.
   */
  animate(mode: Mode, duration: number): Promise<void> {
    return new Promise((resolve) => {
      let done = 0;
      let startedAt: number | null = null;
      const frame = (now: number) => {
        if (!this.element.isConnected) return resolve();
        startedAt ??= now;
        const color = accentColor();
        this.recolor(color);
        const target = clearedCount(now - startedAt, duration, this.total);
        this.context.fillStyle = color;
        for (; done < target; done++) {
          const index = this.order[done] as number;
          const x = index % this.cols;
          const y = Math.floor(index / this.cols);
          if (mode === 'cover') this.context.fillRect(x, y, 1, 1);
          else this.context.clearRect(x, y, 1, 1);
        }
        if (done < this.total) {
          requestAnimationFrame(frame);
          return;
        }
        if (mode === 'reveal') this.element.remove();
        else this.followAccent();
        resolve();
      };
      requestAnimationFrame(frame);
    });
  }

  /** Ya llena, sigue el color del acento hasta que el cambio de página la quite. */
  private followAccent(): void {
    const frame = () => {
      if (!this.element.isConnected) return;
      this.recolor(accentColor());
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }
}

/* ------------------------------------------------------------------------ */
/* 1 · Pixelado de la pantalla que se deja                                  */
/* ------------------------------------------------------------------------ */

let leaving: { layer: PixelLayer; done: Promise<void> } | null = null;

/** Lo que se ve y va a cambiar: el panel; en móvil con el menú abierto, toda la pantalla. */
function leavingBox(): { left: number; top: number; width: number; height: number } {
  const panel = document.getElementById('panel');
  const menuOpen = !desktop.matches && root.dataset.view === 'menu';
  if (panel && !menuOpen) {
    const rect = panel.getBoundingClientRect();
    return { left: rect.left, top: rect.top, width: panel.clientWidth, height: panel.clientHeight };
  }
  return { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight };
}

function coverLeavingScreen(): Promise<void> {
  // Si se pulsa otro enlace mientras se pixela, se sigue con la misma capa.
  if (leaving?.layer.element.isConnected) return leaving.done;
  const box = leavingBox();
  const layer = PixelLayer.create(box.width, box.height, false);
  if (!layer) return Promise.resolve();
  layer.element.classList.add('pixel-transition--screen');
  Object.assign(layer.element.style, {
    left: `${box.left}px`,
    top: `${box.top}px`,
    width: `${box.width}px`,
    height: `${box.height}px`,
  });
  document.body.appendChild(layer.element);
  const done = layer.animate('cover', PIXEL.transition.coverDuration);
  leaving = { layer, done };
  return done;
}

function removeLeavingLayer(): void {
  leaving?.layer.element.remove();
  leaving = null;
}

document.addEventListener('astro:before-preparation', (event) => {
  if (!pixelTransitionActive()) return;
  const preparation = event as TransitionBeforePreparationEvent;
  const load = preparation.loader;
  // La página nueva se descarga mientras se pixela la vieja; el cambio espera a las dos cosas.
  preparation.loader = async () => {
    try {
      await Promise.all([load(), coverLeavingScreen()]);
    } catch (error) {
      removeLeavingLayer();
      throw error;
    }
  };
});

/* ------------------------------------------------------------------------ */
/* 2 · Despixelado sobre la página nueva                                    */
/* ------------------------------------------------------------------------ */

let pendingTransition: ViewTransition | undefined;

document.addEventListener('astro:before-swap', (event) => {
  pendingTransition = (event as TransitionBeforeSwapEvent).viewTransition;
});

document.addEventListener('astro:after-swap', () => {
  const transition = pendingTransition;
  pendingTransition = undefined;
  // El cambio de <body> ya se la ha llevado; por si acaso.
  removeLeavingLayer();
  if (!pixelTransitionActive()) return;
  const panel = document.getElementById('panel');
  const layer = panel ? PixelLayer.create(panel.clientWidth, panel.clientHeight, true) : null;
  if (!panel || !layer) return;
  panel.appendChild(layer.element);
  // Empieza cuando la view transition tiene sus capas listas.
  void (transition ? transition.ready.catch(() => undefined) : Promise.resolve()).then(() =>
    layer.animate('reveal', PIXEL.transition.revealDuration),
  );
});
