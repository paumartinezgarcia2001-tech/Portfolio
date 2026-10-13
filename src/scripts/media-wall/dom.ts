/**
 * Último recurso del muro (D65): sin WebGL y sin bucle pre-renderizado, las
 * piezas se mueven igual (la misma simulación), pero son `<img>` con filtros
 * CSS aproximados. Solo se escribe `transform` en cada fotograma (lo compone
 * la GPU del navegador sin repintar); el filtro cambia por escalones, no en
 * cada fotograma.
 */
import { WALL_FILTERS } from '../../config/media-wall';
import { edgeEnvelope, type WallPiece, type WallSimulation } from '../../lib/media-wall';

interface Node {
  element: HTMLElement;
  /** Escalón de filtro aplicado (0–10), para no tocar el estilo si no cambia. */
  step: number;
}

export class WallDom {
  readonly root: HTMLDivElement;
  #nodes = new Map<number, Node>();
  #imageFor: (ref: number) => string;
  #onMissing: (ref: number) => void;

  /** `onMissing`: la imagen de la pieza no carga (404…); el muro deja de sacarla. */
  constructor(host: HTMLElement, imageFor: (ref: number) => string, onMissing: (ref: number) => void = () => undefined) {
    this.#imageFor = imageFor;
    this.#onMissing = onMissing;
    this.root = document.createElement('div');
    this.root.className = 'media-wall__dom';
    this.root.setAttribute('aria-hidden', 'true');
    host.appendChild(this.root);
  }

  render(sim: WallSimulation): void {
    const seen = new Set<number>();
    for (const piece of sim.pieces) {
      if (piece.y > sim.height || piece.y + piece.h < 0) continue;
      seen.add(piece.id);
      const node = this.#nodes.get(piece.id) ?? this.#create(piece, sim);
      node.element.style.transform = `translate3d(${piece.x}px, ${piece.y}px, 0)`;
      const step = Math.round(edgeEnvelope(sim.progress(piece)) * (1 - piece.hover) * 10);
      if (step !== node.step) {
        node.step = step;
        node.element.style.setProperty('--edge', String(step / 10));
      }
    }
    for (const [id, node] of this.#nodes) {
      if (!seen.has(id)) {
        node.element.remove();
        this.#nodes.delete(id);
      }
    }
  }

  destroy(): void {
    this.root.remove();
    this.#nodes.clear();
  }

  #create(piece: WallPiece, sim: WallSimulation): Node {
    const element = document.createElement('div');
    element.className = 'media-wall__dom-piece';
    element.style.width = `${piece.w}px`;
    if (piece.kind === 'tag') {
      element.classList.add('media-wall__dom-tag');
      element.style.height = `${piece.h}px`;
      const label = document.createElement('span');
      label.textContent = sim.tags[piece.ref] ?? '';
      element.appendChild(label);
    } else {
      const item = sim.items[piece.ref];
      element.dataset.filter = WALL_FILTERS[piece.filter] ?? 'duotone';
      const frame = document.createElement('div');
      frame.className = 'media-wall__dom-frame';
      frame.style.height = `${piece.mediaH}px`;
      const img = document.createElement('img');
      img.alt = '';
      img.decoding = 'async';
      img.addEventListener('error', () => this.#onMissing(piece.ref), { once: true });
      img.src = this.#imageFor(piece.ref);
      img.style.objectPosition = item ? `${item.focusX * 100}% ${item.focusY * 100}%` : '50% 50%';
      frame.appendChild(img);
      element.appendChild(frame);
      if (piece.h > piece.mediaH && item) {
        const caption = document.createElement('span');
        caption.className = 'media-wall__dom-caption';
        caption.textContent = item.caption;
        element.appendChild(caption);
      }
    }
    this.root.appendChild(element);
    const node = { element, step: -1 };
    this.#nodes.set(piece.id, node);
    return node;
  }
}
