/**
 * Muro de Media (D65): funciones puras y la simulación del movimiento.
 *
 * Aquí no hay DOM ni WebGL, así que todo se prueba con Vitest y lo comparten
 * el render en tiempo real (src/scripts/media-wall/) y la exportación a vídeo
 * (`npm run media:wall-render`), que avanza la misma simulación a paso fijo.
 *
 * Geometría en px CSS, con el origen arriba a la izquierda del panel.
 */
import {
  WALL_FILTERS,
  type MediaWallConfig,
  type MediaWallItemConfig,
  type WallFallbackVideo,
  type WallFilter,
} from '../config/media-wall';
import type { Gig } from './data/core';
import { resolveMediaUrl } from './media';
import { seededRandom, type RandomSource } from './shuffle';

// ---------------------------------------------------------------------------
// Configuración resuelta (servidor → navegador)
// ---------------------------------------------------------------------------

export interface ResolvedWallItem {
  id: string;
  kind: 'image' | 'video';
  title: string;
  caption: string;
  image: { jpg: string; avif: string | null };
  video: { mp4: string; av1: string | null } | null;
  /** Ancho ÷ alto. */
  aspect: number;
  focusX: number;
  focusY: number;
  /** Índice en `WALL_FILTERS`, o −1 si lo elige el muro. */
  filter: number;
}

/** Lo que el navegador necesita para animar (va en un `<script type="application/json">`). */
export interface WallClientConfig {
  crossSeconds: number;
  lanes: { narrow: number; wide: number; wideFrom: number };
  laneSpeeds: number[];
  gap: [number, number];
  tagChance: number;
  maxVideos: { narrow: number; wide: number };
  /** `rest` de cada filtro, en el orden de `WALL_FILTERS`. */
  rest: number[];
  items: ResolvedWallItem[];
  tags: string[];
  fallback: { wide: WallFallbackVideo; narrow: WallFallbackVideo } | null;
}

export interface ResolvedMediaWall {
  client: WallClientConfig;
  /** Origen del bucket (para `preconnect`), o `null` si hay varios. */
  origin: string | null;
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

function resolveItem(base: string | undefined | null, item: MediaWallItemConfig): ResolvedWallItem | null {
  const jpg = resolveMediaUrl(base, item.image.jpg);
  if (!jpg || item.width <= 0 || item.height <= 0) return null;
  const mp4 = item.video ? resolveMediaUrl(base, item.video.mp4) : null;
  if (item.kind === 'video' && !mp4) return null;
  return {
    id: item.id,
    kind: item.kind,
    title: item.title,
    caption: (item.caption ?? item.title).trim(),
    image: { jpg, avif: item.image.avif ? resolveMediaUrl(base, item.image.avif) : null },
    video: item.kind === 'video' && mp4 ? { mp4, av1: item.video?.av1 ? resolveMediaUrl(base, item.video.av1) : null } : null,
    aspect: item.width / item.height,
    focusX: clamp01(item.focusX ?? 0.5),
    focusY: clamp01(item.focusY ?? 0.5),
    filter: item.filter ? WALL_FILTERS.indexOf(item.filter) : -1,
  };
}

function resolveFallback(base: string | undefined | null, video: WallFallbackVideo): WallFallbackVideo | null {
  const mp4 = resolveMediaUrl(base, video.mp4);
  const poster = resolveMediaUrl(base, video.poster);
  return mp4 && poster ? { ...video, mp4, poster } : null;
}

/** `2026-06-28` → `28.06.26`. */
export function shortDate(iso: string): string {
  const [y = '', m = '', d = ''] = iso.split('-');
  return `${d}.${m}.${y.slice(-2)}`;
}

/**
 * Rótulos con los bolos del archivo: los `count` más recientes, sin repetir
 * fiesta. «INSULTO CLUB · SIROCO, MADRID · 28.06.26».
 */
export function wallTags(gigs: readonly Gig[], count: number): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const sorted = [...gigs].sort((a, b) => b.eventDate.localeCompare(a.eventDate));
  for (const gig of sorted) {
    if (out.length >= count) break;
    const party = gig.partyName?.trim();
    const key = (party || `${gig.venue} ${gig.city}`).toLocaleUpperCase('es-ES');
    if (seen.has(key)) continue;
    seen.add(key);
    const place = [gig.venue, gig.city].filter(Boolean).join(', ');
    out.push([party, place, shortDate(gig.eventDate)].filter(Boolean).join(' · ').toLocaleUpperCase('es-ES'));
  }
  return out;
}

/**
 * Todo lo que necesita la página, o `null` si no hay ninguna pieza que se
 * pueda mostrar (p. ej., rutas relativas sin `PUBLIC_MEDIA_BASE_URL`).
 */
export function resolveMediaWall(
  config: MediaWallConfig,
  base: string | undefined | null,
  gigs: readonly Gig[] = [],
): ResolvedMediaWall | null {
  if (!config.enabled) return null;
  const items = config.items.map((item) => resolveItem(base, item)).filter((i): i is ResolvedWallItem => i !== null);
  if (items.length === 0) return null;
  const wide = config.fallback ? resolveFallback(base, config.fallback.wide) : null;
  const narrow = config.fallback ? resolveFallback(base, config.fallback.narrow) : null;
  const urls = items.flatMap((i) => [i.image.jpg, i.video?.mp4].filter((u): u is string => Boolean(u)));
  const origins = new Set(urls.map((u) => new URL(u).origin));
  return {
    client: {
      crossSeconds: config.crossSeconds,
      lanes: { ...config.lanes },
      laneSpeeds: config.laneSpeeds.length ? [...config.laneSpeeds] : [1],
      gap: [config.gap[0], config.gap[1]],
      tagChance: clamp01(config.tagChance),
      maxVideos: { ...config.maxVideos },
      rest: WALL_FILTERS.map((name: WallFilter) => clamp01(config.filters[name].rest)),
      items,
      tags: config.tagCount > 0 ? wallTags(gigs, config.tagCount) : [],
      fallback: wide && narrow ? { wide, narrow } : null,
    },
    origin: origins.size === 1 ? ([...origins][0] ?? null) : null,
  };
}

// ---------------------------------------------------------------------------
// Curvas
// ---------------------------------------------------------------------------

export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

/**
 * Recorrido de una pieza por el panel: 0 cuando su borde inferior asoma por
 * arriba, 1 cuando su borde superior se va por abajo.
 */
export function pieceProgress(y: number, h: number, viewH: number): number {
  return clamp01((y + h) / (viewH + h));
}

/**
 * Cuánto filtro de «transición» lleva una pieza según su recorrido: 1 en los
 * bordes (entra y sale filtrada), 0 en el tercio central (nítida).
 */
export function edgeEnvelope(progress: number): number {
  const d = Math.abs(progress * 2 - 1);
  return smoothstep(0.3, 0.94, d);
}

/** Mezcla de estilo: lo que conserva en el centro (`rest`) hasta 1 en los bordes; el ratón la limpia. */
export function styleAmount(edge: number, rest: number, hover: number): number {
  return (rest + (1 - rest) * edge) * (1 - hover);
}

/** UV de `object-fit: cover` con punto focal: escala y desplazamiento. */
export function coverUv(texW: number, texH: number, boxW: number, boxH: number, focusX: number, focusY: number): [number, number, number, number] {
  const tex = texW / Math.max(1, texH);
  const box = boxW / Math.max(1, boxH);
  if (tex > box) {
    const sx = box / tex;
    return [sx, 1, (1 - sx) * focusX, 0];
  }
  const sy = tex / box;
  return [1, sy, 0, (1 - sy) * focusY];
}

/** Carriles según el ancho del panel. */
export function laneCount(width: number, lanes: WallClientConfig['lanes']): number {
  return Math.max(1, width >= lanes.wideFrom ? lanes.wide : lanes.narrow);
}

/** Separación entre carriles y bordes: proporcional, entre 10 y 28 px. */
export function laneGutter(width: number): number {
  return Math.round(Math.min(28, Math.max(10, width * 0.028)));
}

export interface LaneGeometry {
  x: number;
  width: number;
  /** Velocidad constante del carril, en px/s. */
  speed: number;
}

export function layoutLanes(width: number, height: number, config: Pick<WallClientConfig, 'lanes' | 'laneSpeeds' | 'crossSeconds'>): LaneGeometry[] {
  const n = laneCount(width, config.lanes);
  const gutter = laneGutter(width);
  const laneW = Math.max(1, (width - gutter * (n + 1)) / n);
  const base = height / Math.max(1, config.crossSeconds);
  return Array.from({ length: n }, (_, i) => ({
    x: gutter + i * (laneW + gutter),
    width: laneW,
    speed: base * (config.laneSpeeds[i % config.laneSpeeds.length] ?? 1),
  }));
}

// ---------------------------------------------------------------------------
// Simulación
// ---------------------------------------------------------------------------

export interface WallPiece {
  /** Único y creciente: sirve de clave para texturas y vídeos. */
  id: number;
  lane: number;
  kind: 'item' | 'tag';
  /** Índice en `items` o en `tags`. */
  ref: number;
  x: number;
  y: number;
  w: number;
  /** Alto total (imagen + rótulo). */
  h: number;
  /** Alto de la imagen (sin el rótulo de debajo). */
  mediaH: number;
  /** Índice en `WALL_FILTERS` (en los rótulos, −1). */
  filter: number;
  /** Aleatorio fijo de la pieza [0, 1): varía las ráfagas y los patrones. */
  seed: number;
  /** 0–1, sube mientras el puntero está encima o la pieza tiene el foco. */
  hover: number;
}

export interface WallMetrics {
  /** Alto del rótulo bajo cada pieza (texto + margen), en px. */
  captionH: number;
  /** Alto de los rótulos de bolos, en px. */
  tagH: number;
}

interface LaneState {
  geometry: LaneGeometry;
  pieces: WallPiece[];
  /** Hueco que dejará la próxima pieza sobre la de arriba. */
  nextGap: number;
  lastFilter: number;
  /** ¿La última pieza que entró fue un rótulo? (nunca dos seguidos). */
  lastWasTag: boolean;
}

/** Ancho de pieza, en px, a partir del cual se ve el rótulo de debajo. */
const MIN_CAPTION_WIDTH = 96;
/** Proporciones extremas: las piezas se recortan a este rango (cover). */
const MIN_ASPECT = 9 / 16;
const MAX_ASPECT = 4 / 3;

export class WallSimulation {
  readonly items: readonly ResolvedWallItem[];
  readonly tags: readonly string[];
  width = 0;
  height = 0;
  #config: WallClientConfig;
  #metrics: WallMetrics;
  #random: RandomSource;
  #lanes: LaneState[] = [];
  #nextId = 1;
  #queue: number[] = [];
  #tagQueue: number[] = [];
  #lastItem = -1;
  #pointer: { x: number; y: number } | null = null;
  #focusedItem: number | null = null;

  constructor(config: WallClientConfig, metrics: WallMetrics, random: RandomSource = seededRandom(Date.now() >>> 0)) {
    this.#config = config;
    this.items = config.items;
    this.tags = config.tags;
    this.#metrics = metrics;
    this.#random = random;
  }

  /** Todas las piezas, carril a carril (de arriba abajo en cada uno). */
  get pieces(): WallPiece[] {
    return this.#lanes.flatMap((lane) => lane.pieces);
  }

  get lanes(): readonly LaneGeometry[] {
    return this.#lanes.map((lane) => lane.geometry);
  }

  /** Nuevo tamaño del panel: se recoloca todo y se vuelve a llenar. */
  resize(width: number, height: number): void {
    if (width === this.width && height === this.height && this.#lanes.length) return;
    const previous = this.#lanes;
    this.width = width;
    this.height = height;
    const geometry = layoutLanes(width, height, this.#config);
    // Si solo cambia el alto (barra del navegador en móvil), se conservan las piezas.
    if (previous.length === geometry.length && previous.every((lane, i) => lane.geometry.width === geometry[i]?.width)) {
      previous.forEach((lane, i) => (lane.geometry = geometry[i] as LaneGeometry));
      this.#fill();
      return;
    }
    this.#lanes = geometry.map((g) => ({ geometry: g, pieces: [], nextGap: 0, lastFilter: -1, lastWasTag: true }));
    for (const lane of this.#lanes) {
      // Cada carril arranca desfasado: la primera pieza asoma ya por abajo.
      this.#spawnAbove(lane, height + this.#random() * lane.geometry.width * 0.9);
    }
    this.#fill();
  }

  /**
   * Avanza `dt` segundos. Velocidad constante por carril; las piezas que salen
   * por abajo se quitan y entran otras por arriba.
   */
  step(dt: number): void {
    if (!this.#lanes.length || dt <= 0) return;
    const ease = 1 - Math.exp(-dt * 7);
    for (const lane of this.#lanes) {
      const dy = lane.geometry.speed * dt;
      for (const piece of lane.pieces) {
        piece.y += dy;
        const target = this.#isHovered(piece) ? 1 : 0;
        piece.hover += (target - piece.hover) * ease;
        if (Math.abs(target - piece.hover) < 0.001) piece.hover = target;
      }
      while (lane.pieces.length && (lane.pieces[lane.pieces.length - 1] as WallPiece).y > this.height) lane.pieces.pop();
    }
    this.#fill();
  }

  /** Puntero sobre el panel (px CSS), o `null` al salir. */
  setPointer(point: { x: number; y: number } | null): void {
    this.#pointer = point;
  }

  /** Pieza con el foco del teclado (índice en `items`), o `null`. */
  setFocusedItem(index: number | null): void {
    this.#focusedItem = index;
  }

  /** La pieza (de imagen) que hay en ese punto, si hay. */
  pieceAt(x: number, y: number): WallPiece | null {
    for (const lane of this.#lanes) {
      const g = lane.geometry;
      if (x < g.x || x > g.x + g.width) continue;
      for (const piece of lane.pieces) {
        if (piece.kind === 'item' && y >= piece.y && y <= piece.y + piece.mediaH) return piece;
      }
    }
    return null;
  }

  /** Recorrido (0–1) de una pieza: ver `pieceProgress`. */
  progress(piece: WallPiece): number {
    return pieceProgress(piece.y, piece.h, this.height);
  }

  #isHovered(piece: WallPiece): boolean {
    if (piece.kind !== 'item') return false;
    if (this.#focusedItem !== null && piece.ref === this.#focusedItem) return true;
    const p = this.#pointer;
    return p !== null && p.x >= piece.x && p.x <= piece.x + piece.w && p.y >= piece.y && p.y <= piece.y + piece.mediaH;
  }

  /** Mientras quede hueco arriba de algún carril, entra una pieza nueva. */
  #fill(): void {
    for (const lane of this.#lanes) {
      let guard = 0;
      while (guard++ < 64) {
        const top = lane.pieces[0];
        const limit = top ? top.y - lane.nextGap : this.height;
        if (limit <= 0) break;
        this.#spawnAbove(lane, limit);
      }
    }
  }

  /** Pone una pieza nueva con su borde inferior en `bottom`. */
  #spawnAbove(lane: LaneState, bottom: number): void {
    const { x, width } = lane.geometry;
    const useTag = this.tags.length > 0 && !lane.lastWasTag && this.#random() < this.#config.tagChance;
    let piece: WallPiece;
    if (useTag) {
      const h = this.#metrics.tagH;
      piece = {
        id: this.#nextId++,
        lane: this.#lanes.indexOf(lane),
        kind: 'tag',
        ref: this.#nextTag(),
        x,
        y: bottom - h,
        w: width,
        h,
        mediaH: h,
        filter: -1,
        seed: this.#random(),
        hover: 0,
      };
      lane.lastWasTag = true;
    } else {
      const ref = this.#nextItem();
      const item = this.items[ref] as ResolvedWallItem;
      const aspect = Math.min(MAX_ASPECT, Math.max(MIN_ASPECT, item.aspect));
      const mediaH = width / aspect;
      const caption = width >= MIN_CAPTION_WIDTH ? this.#metrics.captionH : 0;
      const filter = this.#pickFilter(item, lane.lastFilter);
      lane.lastFilter = filter;
      piece = {
        id: this.#nextId++,
        lane: this.#lanes.indexOf(lane),
        kind: 'item',
        ref,
        x,
        y: bottom - mediaH - caption,
        w: width,
        h: mediaH + caption,
        mediaH,
        filter,
        seed: this.#random(),
        hover: 0,
      };
      lane.lastWasTag = false;
    }
    lane.pieces.unshift(piece);
    const [min, max] = this.#config.gap;
    lane.nextGap = width * (min + (max - min) * this.#random());
  }

  /**
   * Siguiente pieza: se baraja la lista y se recorre entera antes de repetir.
   * Si la elegida ya está a la vista en otro carril, se prueba con la siguiente.
   */
  #nextItem(): number {
    const visible = new Set(this.pieces.filter((p) => p.kind === 'item' && p.y < this.height).map((p) => p.ref));
    for (let attempt = 0; attempt < this.items.length; attempt++) {
      if (!this.#queue.length) this.#queue = this.#shuffled(this.items.length, this.#lastItem);
      const candidate = this.#queue[0] as number;
      if (!visible.has(candidate) || attempt === this.items.length - 1) {
        this.#queue.shift();
        this.#lastItem = candidate;
        return candidate;
      }
      // Se queda para más tarde.
      this.#queue.push(this.#queue.shift() as number);
    }
    return 0;
  }

  #nextTag(): number {
    if (!this.#tagQueue.length) this.#tagQueue = this.#shuffled(this.tags.length, -1);
    return this.#tagQueue.shift() as number;
  }

  #shuffled(n: number, avoidFirst: number): number[] {
    const out = Array.from({ length: n }, (_, i) => i);
    for (let i = n - 1; i > 0; i--) {
      const j = Math.floor(this.#random() * (i + 1));
      [out[i], out[j]] = [out[j] as number, out[i] as number];
    }
    if (n > 1 && out[0] === avoidFirst) [out[0], out[1]] = [out[1] as number, out[0] as number];
    return out;
  }

  /** El filtro fijo de la pieza o uno distinto del anterior del carril y de los vecinos. */
  #pickFilter(item: ResolvedWallItem, previous: number): number {
    if (item.filter >= 0) return item.filter;
    const neighbours = new Set(this.#lanes.map((lane) => lane.pieces[0]?.filter ?? -1));
    const options = WALL_FILTERS.map((_, i) => i).filter((i) => i !== previous && !neighbours.has(i));
    const pool = options.length ? options : WALL_FILTERS.map((_, i) => i).filter((i) => i !== previous);
    return pool[Math.floor(this.#random() * pool.length)] ?? 0;
  }
}
