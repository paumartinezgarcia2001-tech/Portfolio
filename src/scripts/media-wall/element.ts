/**
 * `<media-wall>` — muro animado de Media (D65).
 *
 * Fotos, bucles de vídeo y rótulos con bolos del archivo bajan a velocidad
 * constante por todo el panel; entran filtrados por arriba, se aclaran en el
 * centro y se vuelven a filtrar al salir por abajo (src/lib/media-wall.ts tiene
 * la simulación; shaders.ts, los filtros).
 *
 * Siempre se anima, en todos los dispositivos (Luna, 13-10-2026):
 * 1. WebGL (2 o 1): todo en un canvas, filtros en la GPU.
 * 2. Sin WebGL: el bucle pre-renderizado (`MEDIA_WALL.fallback`).
 * 3. Sin WebGL ni bucle: piezas `<img>` con filtros CSS (dom.ts).
 * Sin JavaScript queda la rejilla del HTML (MediaWall.astro).
 *
 * Calidad: el movimiento va por tiempo (px/s), no por fotogramas: si un
 * dispositivo pinta menos, las piezas caen a la misma velocidad. Un gobernador
 * baja la resolución interna (y después los vídeos simultáneos) si no llega a
 * ~50 fps, y la vuelve a subir cuando sobra; si el límite es de la pantalla
 * (iOS en ahorro de batería pinta a 30), no toca nada.
 *
 * Se para fuera de la vista, con la pestaña oculta, con el menú móvil abierto,
 * con el visor abierto y con «pausa» (WCAG 2.2.2). Todo se libera al cambiar
 * de página (`astro:before-swap`). Se monta en una microtarea, como
 * `<media-video>`: el ClientRouter recrea los <video> justo después de conectar.
 *
 * Exportación (`?wall-render`): no anima solo; `window.__mediaWall.frame(t)`
 * pinta el instante `t` (paso fijo, semilla `?wall-seed=`) y devuelve el PNG.
 * Lo usa `scripts/media-wall-render.mjs`.
 */
import { DESKTOP_MEDIA_QUERY } from '../../config/site';
import {
  WallSimulation,
  coverUv,
  edgeEnvelope,
  styleAmount,
  type ResolvedWallItem,
  type WallClientConfig,
  type WallPiece,
} from '../../lib/media-wall';
import { cryptoRandom, seededRandom } from '../../lib/shuffle';
import { WallDom } from './dom';
import { WallGL, type Palette } from './gl';
import { MODE } from './shaders';
import { VideoPlayer, drawTextMask, loadItemImage, videoSource, type TextureSource } from './sources';

type Mode = 'gl' | 'video' | 'dom';

interface ItemTexture {
  texture: WebGLTexture | null;
  width: number;
  height: number;
  /** Fuente, para volver a subirla si se pierde el contexto. */
  source: TextureSource | null;
  loading: Promise<void> | null;
  lastUsed: number;
}

interface MaskTexture {
  texture: WebGLTexture | null;
  canvas: HTMLCanvasElement;
  /** Ancho en px CSS. */
  width: number;
  lastUsed: number;
}

/** Alturas de los rótulos, en px CSS (las usa también la simulación). */
const CAPTION_FONT = 11;
const CAPTION_H = 22;
const TAG_FONT = 12;
const TAG_H = 24;

/** Por debajo de ~50 fps se baja la resolución; por encima de ~75, se sube. */
const SLOW_MS = 20;
const FAST_MS = 13.5;
const MIN_SCALE = 0.5;
/** Límite de píxeles del canvas (≈ 2 Mpx más la mitad): de sobra para un panel. */
const MAX_PIXELS = 3_200_000;

const LABEL_PAUSE = 'pausa';
const LABEL_RESUME = 'reanudar';

const desktop = window.matchMedia(DESKTOP_MEDIA_QUERY);

function renderParams(): { render: boolean; seed: number | null } {
  const params = new URLSearchParams(location.search);
  const seed = Number(params.get('wall-seed'));
  return { render: params.has('wall-render'), seed: Number.isFinite(seed) && params.has('wall-seed') ? seed : null };
}

/** `#27272b` / `rgb(…)` → [0–1, 0–1, 0–1], con un canvas para normalizar el formato. */
const colorProbe = document.createElement('canvas').getContext('2d');
function parseColor(value: string, fallback: readonly [number, number, number]): [number, number, number] {
  if (!colorProbe || !value.trim()) return [...fallback] as [number, number, number];
  colorProbe.fillStyle = '#000';
  colorProbe.fillStyle = value.trim();
  const normalized = String(colorProbe.fillStyle);
  const hex = /^#([0-9a-f]{6})$/i.exec(normalized);
  if (hex?.[1]) {
    const n = parseInt(hex[1], 16);
    return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
  }
  const rgb = /rgba?\(([^)]+)\)/.exec(normalized);
  if (rgb?.[1]) {
    const [r = 0, g = 0, b = 0] = rgb[1].split(',').map((v) => Number(v.trim()) / 255);
    return [r, g, b];
  }
  return [...fallback] as [number, number, number];
}

export class MediaWallElement extends HTMLElement {
  static readonly #live = new Set<MediaWallElement>();

  /**
   * Para los e2e: instancias, modo, fotogramas pintados, vídeos vivos (los que
   * dejan de hacer falta tardan 3 s en soltarse) y vídeos reproduciéndose.
   */
  static get stats(): { elements: number; videos: number; playing: number; mode: string | null; frames: number } {
    let videos = 0;
    let playing = 0;
    let frames = 0;
    let mode: string | null = null;
    for (const el of MediaWallElement.#live) {
      videos += el.#players.size;
      for (const player of el.#players.values()) if (!player.video.paused) playing++;
      frames += el.#frames;
      mode = el.#mode;
    }
    return { elements: MediaWallElement.#live.size, videos, playing, mode, frames };
  }

  static teardownAll(): void {
    for (const element of [...MediaWallElement.#live]) element.teardown();
  }

  #abort: AbortController | null = null;
  #config: WallClientConfig | null = null;
  #sim: WallSimulation | null = null;
  #mode: Mode | null = null;
  #gl: WallGL | null = null;
  #dom: WallDom | null = null;
  #fallbackVideo: HTMLVideoElement | null = null;
  #canvas: HTMLCanvasElement | null = null;
  #videoHolder: HTMLElement | null = null;
  #resize: ResizeObserver | null = null;
  #intersection: IntersectionObserver | null = null;
  #viewObserver: MutationObserver | null = null;

  #textures = new Map<number, ItemTexture>();
  #videoTextures = new Map<number, ItemTexture>();
  #players = new Map<number, VideoPlayer>();
  #masks = new Map<string, MaskTexture>();
  #imageWidth = 480;

  #raf = 0;
  #last = 0;
  #time = 0;
  #frames = 0;
  #manageAt = 0;
  #palette: Palette = { dark: [0.153, 0.153, 0.169], accent: [1, 1, 0], light: [0.773, 0.78, 0.839] };
  #paletteAt = -Infinity;
  #fontFamily = 'Helvetica, Arial, sans-serif';

  #userPaused = false;
  #inView = true;
  #viewerOpen = false;
  #viewerTrigger: HTMLElement | null = null;
  #renderMode = false;

  #quality = { scale: 1, max: 1, ema: 16.7, checkAt: 0, fastChecks: 0, videoCap: Infinity, locked: false, before: 0 };

  connectedCallback(): void {
    queueMicrotask(() => {
      if (this.isConnected) this.#setup();
    });
  }

  disconnectedCallback(): void {
    this.teardown();
  }

  // -------------------------------------------------------------------------
  // Montaje
  // -------------------------------------------------------------------------

  #setup(): void {
    if (this.#abort) return;
    const raw = this.querySelector('script[data-wall-config]')?.textContent;
    const canvas = this.querySelector<HTMLCanvasElement>('canvas[data-wall-canvas]');
    const holder = this.querySelector<HTMLElement>('[data-wall-videos]');
    if (!raw || !canvas || !holder) return;
    let config: WallClientConfig;
    try {
      config = JSON.parse(raw) as WallClientConfig;
    } catch {
      return;
    }
    if (!config.items.length) return;

    this.#abort = new AbortController();
    const { signal } = this.#abort;
    MediaWallElement.#live.add(this);
    this.#config = config;
    this.#canvas = canvas;
    this.#videoHolder = holder;
    this.#userPaused = false;
    this.#viewerOpen = false;
    this.#inView = true;
    this.#time = 0;
    this.#frames = 0;
    this.#fontFamily = getComputedStyle(this).fontFamily || this.#fontFamily;

    const { render, seed } = renderParams();
    this.#renderMode = render;
    const random = seed !== null ? seededRandom(seed) : seededRandom(Math.floor(cryptoRandom() * 2 ** 32));
    this.#sim = new WallSimulation(config, { captionH: CAPTION_H, tagH: TAG_H }, random);

    // Modo: WebGL → bucle pre-renderizado → DOM.
    this.#gl = WallGL.create(canvas, { preserveDrawingBuffer: render });
    // WebGL sin GPU (pintado por CPU): si hay bucle pre-renderizado, mejor ese.
    if (this.#gl?.software && config.fallback && !render) {
      this.#gl.destroy();
      this.#gl = null;
    }
    if (this.#gl) {
      this.#mode = 'gl';
      canvas.addEventListener('webglcontextlost', (event) => this.#onContextLost(event), { signal });
      canvas.addEventListener('webglcontextrestored', () => this.#onContextRestored(), { signal });
    } else if (config.fallback && !render) {
      this.#mode = 'video';
      this.#mountFallbackVideo();
    } else {
      this.#mode = 'dom';
      this.#dom = new WallDom(this, (ref) => config.items[ref]?.image.jpg ?? '');
    }
    this.dataset.mode = this.#mode;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.#quality = {
      scale: this.#gl?.software ? Math.min(1, dpr * 0.6) : dpr,
      max: dpr,
      ema: 16.7,
      checkAt: 0,
      fastChecks: 0,
      videoCap: Infinity,
      locked: false,
      before: 0,
    };

    this.#resize = new ResizeObserver(() => this.#onResize());
    this.#resize.observe(this);
    this.#onResize();

    this.#intersection = new IntersectionObserver((entries) => {
      const entry = entries[entries.length - 1];
      if (!entry) return;
      this.#inView = entry.isIntersecting;
      this.#sync();
    });
    this.#intersection.observe(this);
    this.#viewObserver = new MutationObserver(() => this.#sync());
    this.#viewObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-view'] });
    document.addEventListener('visibilitychange', () => this.#sync(), { signal });

    // Puntero: limpia la pieza que hay debajo; clic o toque: la abre en el visor.
    this.addEventListener(
      'pointermove',
      (event) => {
        if (event.pointerType === 'touch') return;
        const point = this.#localPoint(event);
        this.#sim?.setPointer(point);
        this.toggleAttribute('data-over-piece', Boolean(point && this.#sim?.pieceAt(point.x, point.y)));
      },
      { signal },
    );
    this.addEventListener('pointerleave', () => this.#sim?.setPointer(null), { signal });
    this.addEventListener('click', (event) => this.#onClick(event), { signal });
    this.addEventListener('keydown', (event) => this.#onKeydown(event), { signal });
    this.addEventListener('focusin', (event) => this.#onFocus(event), { signal });
    this.addEventListener('focusout', () => this.#sim?.setFocusedItem(null), { signal });

    this.#syncToggleButton();
    if (render) this.#exposeRenderHooks();
    else this.#sync();
  }

  /** Libera GPU, vídeos y listeners. Se puede llamar varias veces. */
  teardown(): void {
    if (!this.#abort) return;
    this.#abort.abort();
    this.#abort = null;
    cancelAnimationFrame(this.#raf);
    this.#raf = 0;
    this.#resize?.disconnect();
    this.#intersection?.disconnect();
    this.#viewObserver?.disconnect();
    this.#resize = this.#intersection = this.#viewObserver = null;
    for (const player of this.#players.values()) player.dispose();
    this.#players.clear();
    for (const entry of [...this.#textures.values(), ...this.#videoTextures.values()]) {
      this.#gl?.deleteTexture(entry.texture);
      if (entry.source instanceof ImageBitmap) entry.source.close();
    }
    for (const mask of this.#masks.values()) this.#gl?.deleteTexture(mask.texture);
    this.#textures.clear();
    this.#videoTextures.clear();
    this.#masks.clear();
    this.#gl?.destroy();
    this.#gl = null;
    this.#dom?.destroy();
    this.#dom = null;
    if (this.#fallbackVideo) {
      this.#fallbackVideo.pause();
      this.#fallbackVideo.removeAttribute('src');
      this.#fallbackVideo.load();
      this.#fallbackVideo.remove();
      this.#fallbackVideo = null;
    }
    this.#closeViewer(false);
    this.#sim = null;
    MediaWallElement.#live.delete(this);
  }

  // -------------------------------------------------------------------------
  // Bucle
  // -------------------------------------------------------------------------

  /** ¿Debería estar moviéndose ahora? */
  #shouldRun(): boolean {
    const menuOpen = !desktop.matches && document.documentElement.dataset.view === 'menu';
    return !this.#userPaused && !this.#viewerOpen && this.#inView && !menuOpen && document.visibilityState === 'visible';
  }

  #sync(): void {
    if (!this.#abort || this.#renderMode) return;
    const run = this.#shouldRun();
    this.dataset.state = this.#userPaused ? 'paused' : run ? 'playing' : 'idle';
    if (this.#mode === 'video') {
      const video = this.#fallbackVideo;
      if (video) {
        if (run && video.paused) video.play().catch(() => undefined);
        else if (!run && !video.paused) video.pause();
      }
      return;
    }
    for (const player of this.#players.values()) {
      if (run) player.play();
      else player.pause();
    }
    if (run && !this.#raf) {
      this.#last = performance.now();
      this.#raf = requestAnimationFrame((now) => this.#frame(now));
    } else if (!run && this.#raf) {
      cancelAnimationFrame(this.#raf);
      this.#raf = 0;
    }
  }

  #frame(now: number): void {
    this.#raf = 0;
    if (!this.#abort || !this.#shouldRun()) return;
    const elapsed = now - this.#last;
    this.#last = now;
    // Tras un parón (pestaña oculta, depurador…), sin saltos: como mucho 100 ms.
    const dt = Math.min(0.1, Math.max(0, elapsed / 1000));
    this.#time += dt;
    this.#sim?.step(dt);
    if (now >= this.#manageAt) {
      this.#manageAt = now + 200;
      this.#manage(now);
    }
    this.#draw(now);
    this.#govern(now, elapsed);
    this.#raf = requestAnimationFrame((t) => this.#frame(t));
  }

  #draw(now: number): void {
    const sim = this.#sim;
    if (!sim) return;
    if (this.#mode === 'dom') {
      this.#dom?.render(sim);
      this.#frames++;
      return;
    }
    const gl = this.#gl;
    if (this.#mode !== 'gl' || !gl || gl.lost) return;
    this.#refreshPalette(now);
    gl.begin(this.#palette, this.#time);
    const rest = this.#config?.rest ?? [];
    let drawn = 0;
    for (const piece of sim.pieces) {
      if (piece.y > sim.height || piece.y + piece.h < 0) continue;
      const progress = sim.progress(piece);
      const edge = edgeEnvelope(progress);
      const dir = progress < 0.5 ? -1 : 1;
      if (piece.kind === 'tag') {
        const mask = this.#mask(`t${piece.ref}:${Math.round(piece.w)}`, sim.tags[piece.ref] ?? '', piece.w, TAG_H, TAG_FONT, true, now);
        if (mask?.texture) {
          gl.draw(mask.texture, { x: piece.x, y: piece.y, w: mask.width, h: TAG_H, cover: [1, 1, 0, 0], mode: MODE.tag, edge, style: 1, dir, seed: piece.seed, alpha: 1 });
        }
        continue;
      }
      const item = sim.items[piece.ref] as ResolvedWallItem;
      const source = this.#textureFor(piece, now);
      if (source?.texture) {
        gl.draw(source.texture, {
          x: piece.x,
          y: piece.y,
          w: piece.w,
          h: piece.mediaH,
          cover: coverUv(source.width, source.height, piece.w, piece.mediaH, item.focusX, item.focusY),
          mode: piece.filter + 1,
          edge: edge * (1 - piece.hover),
          style: styleAmount(edge, rest[piece.filter] ?? 0.5, piece.hover),
          dir,
          seed: piece.seed,
          alpha: 1,
        });
        drawn++;
      }
      if (piece.h > piece.mediaH) {
        const mask = this.#mask(`c${piece.ref}:${Math.round(piece.w)}`, item.caption, piece.w, CAPTION_H - 8, CAPTION_FONT, false, now);
        if (mask?.texture) {
          gl.draw(mask.texture, { x: piece.x, y: piece.y + piece.mediaH + 6, w: mask.width, h: CAPTION_H - 8, cover: [1, 1, 0, 0], mode: MODE.caption, edge, style: 1, dir, seed: piece.seed, alpha: 1 });
        }
      }
    }
    this.#frames++;
    if (drawn > 0 && !this.hasAttribute('data-ready')) this.toggleAttribute('data-ready', true);
  }

  /** Textura de la pieza: el fotograma del vídeo si ya lo hay; si no, su foto. */
  #textureFor(piece: WallPiece, now: number): ItemTexture | null {
    const gl = this.#gl;
    if (!gl) return null;
    const player = this.#players.get(piece.ref);
    if (player?.ready) {
      player.poll();
      let entry = this.#videoTextures.get(piece.ref);
      if (!entry) {
        entry = { texture: gl.createTexture(), width: 0, height: 0, source: player.video, loading: null, lastUsed: now };
        this.#videoTextures.set(piece.ref, entry);
        player.fresh = true;
      }
      if (player.fresh && entry.texture) {
        player.fresh = false;
        if (gl.upload(entry.texture, player.video)) {
          entry.width = player.video.videoWidth;
          entry.height = player.video.videoHeight;
        }
      }
      entry.lastUsed = now;
      if (entry.width > 0) return entry;
    }
    const image = this.#textures.get(piece.ref);
    if (image) image.lastUsed = now;
    return image?.texture && image.width > 0 ? image : null;
  }

  #mask(key: string, text: string, maxWidth: number, height: number, font: number, boxed: boolean, now: number): MaskTexture | null {
    const gl = this.#gl;
    if (!gl || !text) return null;
    let mask = this.#masks.get(key);
    if (!mask) {
      const { canvas, width } = drawTextMask(text, maxWidth, height, { fontFamily: this.#fontFamily, fontSize: font, fontWeight: boxed ? 700 : 400, dpr: this.#quality.max }, boxed);
      const texture = gl.createTexture();
      if (texture) gl.upload(texture, canvas);
      mask = { texture, canvas, width, lastUsed: now };
      this.#masks.set(key, mask);
    }
    mask.lastUsed = now;
    return mask;
  }

  // -------------------------------------------------------------------------
  // Recursos: fotos, vídeos y memoria
  // -------------------------------------------------------------------------

  /** Cada 200 ms: qué fotos cargar, qué vídeos reproducir y qué soltar. */
  #manage(now: number): void {
    const sim = this.#sim;
    const config = this.#config;
    if (!sim || !config || this.#mode !== 'gl') return;
    const H = sim.height;
    const soon = sim.pieces.filter((p) => p.kind === 'item' && p.y < H && p.y + p.h > -H * 0.9);
    // Fotos: primero las que ya están a la vista.
    soon.sort((a, b) => b.y - a.y);
    for (const piece of soon) this.#ensureImage(piece.ref);

    // Vídeos: las piezas con más superficie a la vista, sin pasar del límite.
    const cap = Math.min(this.#quality.videoCap, sim.width >= config.lanes.wideFrom ? config.maxVideos.wide : config.maxVideos.narrow);
    const wanted: number[] = [];
    const visible = soon
      .filter((p) => sim.items[p.ref]?.video && p.y < H && p.y + p.mediaH > -H * 0.15)
      .map((p) => ({ ref: p.ref, area: Math.min(H, p.y + p.mediaH) - Math.max(-H * 0.15, p.y) }))
      .sort((a, b) => b.area - a.area);
    for (const { ref } of visible) {
      if (wanted.length >= cap) break;
      if (!wanted.includes(ref)) wanted.push(ref);
    }
    const running = this.#shouldRun();
    for (const ref of wanted) {
      let player = this.#players.get(ref);
      const src = videoSource(sim.items[ref] as ResolvedWallItem);
      if (!player && src && this.#videoHolder) {
        player = new VideoPlayer(src, this.#videoHolder);
        this.#players.set(ref, player);
      }
      if (!player) continue;
      player.lastWanted = now;
      if (running) player.play();
    }
    for (const [ref, player] of this.#players) {
      if (wanted.includes(ref)) continue;
      player.pause();
      // Margen de 3 s: si vuelve a hacer falta enseguida, no se recarga.
      if (now - player.lastWanted > 3000) {
        player.dispose();
        this.#players.delete(ref);
        const entry = this.#videoTextures.get(ref);
        this.#gl?.deleteTexture(entry?.texture ?? null);
        this.#videoTextures.delete(ref);
      }
    }

    // Memoria: suelta fotos y rótulos que llevan rato sin verse.
    if (this.#textures.size > 10) {
      const needed = new Set(soon.map((p) => p.ref));
      for (const [ref, entry] of this.#textures) {
        if (!needed.has(ref) && !entry.loading && now - entry.lastUsed > 15_000) {
          this.#gl?.deleteTexture(entry.texture);
          if (entry.source instanceof ImageBitmap) entry.source.close();
          this.#textures.delete(ref);
        }
      }
    }
    if (this.#masks.size > 60) {
      for (const [key, mask] of this.#masks) {
        if (now - mask.lastUsed > 15_000) {
          this.#gl?.deleteTexture(mask.texture);
          this.#masks.delete(key);
        }
      }
    }
  }

  #ensureImage(ref: number): Promise<void> {
    const existing = this.#textures.get(ref);
    if (existing) return existing.loading ?? Promise.resolve();
    const item = this.#config?.items[ref];
    const signal = this.#abort?.signal;
    if (!item || !signal) return Promise.resolve();
    const entry: ItemTexture = { texture: null, width: 0, height: 0, source: null, loading: null, lastUsed: performance.now() };
    entry.loading = loadItemImage(item, this.#imageWidth, signal)
      .then((source) => {
        const gl = this.#gl;
        if (!gl || signal.aborted || this.#textures.get(ref) !== entry) return;
        entry.source = source;
        entry.texture = gl.createTexture();
        if (entry.texture && gl.upload(entry.texture, source)) {
          entry.width = source instanceof HTMLImageElement ? source.naturalWidth : source.width;
          entry.height = source instanceof HTMLImageElement ? source.naturalHeight : source.height;
        }
      })
      .catch((error: unknown) => {
        if ((error as { name?: string } | null)?.name !== 'AbortError') console.warn(`[media-wall] No se ha podido cargar «${item.title}».`, error);
      })
      .finally(() => {
        entry.loading = null;
      });
    this.#textures.set(ref, entry);
    return entry.loading;
  }

  // -------------------------------------------------------------------------
  // Tamaño, colores y calidad
  // -------------------------------------------------------------------------

  #onResize(): void {
    const width = this.clientWidth;
    const height = this.clientHeight;
    if (!width || !height || !this.#sim) return;
    this.#sim.resize(width, height);
    const lane = this.#sim.lanes[0]?.width ?? width;
    // Ancho de las fotos en la GPU: el del carril a la densidad máxima.
    this.#imageWidth = Math.min(1080, Math.ceil(lane * this.#quality.max));
    this.#applyScale();
    if (!this.#raf && this.#abort && !this.#renderMode) this.#draw(performance.now());
  }

  #applyScale(): void {
    const sim = this.#sim;
    if (!sim || !this.#gl) return;
    const cap = Math.sqrt(MAX_PIXELS / Math.max(1, sim.width * sim.height));
    this.#gl.resize(sim.width, sim.height, Math.min(this.#quality.scale, cap));
  }

  /** Lee los tokens de color (cambian con la sección y con el panel de colores). */
  #refreshPalette(now: number): void {
    if (now - this.#paletteAt < 1000) return;
    this.#paletteAt = now;
    const style = getComputedStyle(this);
    this.#palette = {
      dark: parseColor(style.getPropertyValue('--c-menu-bg'), this.#palette.dark),
      accent: parseColor(style.getPropertyValue('--c-media'), this.#palette.accent),
      light: parseColor(style.getPropertyValue('--c-menu-fg'), this.#palette.light),
    };
  }

  /**
   * Gobernador de calidad: cada segundo mira el tiempo medio por fotograma.
   * Lento → menos resolución (hasta ×0,5) y, al tope, un vídeo menos. Si bajar
   * la resolución no mejora nada, el límite es de la pantalla: se deshace y se
   * deja de tocar.
   */
  #govern(now: number, elapsed: number): void {
    const q = this.#quality;
    if (elapsed > 0 && elapsed < 250) q.ema = q.ema * 0.92 + elapsed * 0.08;
    if (now < q.checkAt || this.#mode !== 'gl') return;
    q.checkAt = now + 1000;
    if (q.locked) return;
    if (q.before > 0) {
      // ¿Sirvió la última bajada?
      if (q.ema > q.before * 0.92) {
        q.scale = Math.min(q.max, q.scale / 0.8);
        q.locked = true;
        this.#applyScale();
        return;
      }
      q.before = 0;
    }
    if (q.ema > SLOW_MS) {
      q.fastChecks = 0;
      if (q.scale > MIN_SCALE + 0.01) {
        q.before = q.ema;
        q.scale = Math.max(MIN_SCALE, q.scale * 0.8);
        this.#applyScale();
      } else if (q.videoCap > 1) {
        q.videoCap = Math.max(1, Math.min(q.videoCap, this.#players.size) - 1);
      } else if (this.#config?.fallback && !this.#renderMode) {
        // Ni con lo mínimo llega: el bucle pre-renderizado se ve mejor.
        this.#switchToVideo();
      }
    } else if (q.ema < FAST_MS && q.scale < q.max) {
      if (++q.fastChecks >= 4) {
        q.fastChecks = 0;
        q.scale = Math.min(q.max, q.scale * 1.12);
        this.#applyScale();
      }
    } else {
      q.fastChecks = 0;
    }
    this.dataset.quality = q.scale.toFixed(2);
  }

  #onContextLost(event: Event): void {
    event.preventDefault();
    cancelAnimationFrame(this.#raf);
    this.#raf = 0;
  }

  /** El contexto vuelve vacío: programa nuevo y se vuelven a subir las texturas. */
  #onContextRestored(): void {
    const gl = this.#gl;
    if (!gl) return;
    try {
      gl.setup();
    } catch (error) {
      console.warn('[media-wall] No se ha podido recuperar WebGL.', error);
      return;
    }
    for (const entry of this.#textures.values()) {
      entry.texture = gl.createTexture();
      if (entry.texture && entry.source) gl.upload(entry.texture, entry.source);
    }
    this.#videoTextures.clear();
    this.#masks.clear();
    this.#applyScale();
    this.#sync();
  }

  /** Del modo WebGL al bucle pre-renderizado, sin recargar (gobernador). */
  #switchToVideo(): void {
    cancelAnimationFrame(this.#raf);
    this.#raf = 0;
    for (const player of this.#players.values()) player.dispose();
    this.#players.clear();
    for (const entry of [...this.#textures.values(), ...this.#videoTextures.values()]) {
      if (entry.source instanceof ImageBitmap) entry.source.close();
    }
    this.#textures.clear();
    this.#videoTextures.clear();
    this.#masks.clear();
    this.#gl?.destroy();
    this.#gl = null;
    this.#mode = 'video';
    this.dataset.mode = 'video';
    this.removeAttribute('data-ready');
    this.#mountFallbackVideo();
    this.#sync();
  }

  #mountFallbackVideo(): void {
    const fallback = this.#config?.fallback;
    if (!fallback) return;
    const narrow = this.clientWidth / Math.max(1, this.clientHeight) < Math.sqrt((4 / 5) * (9 / 16));
    const choice = narrow ? fallback.narrow : fallback.wide;
    const video = document.createElement('video');
    video.className = 'media-wall__fallback';
    video.muted = true;
    video.loop = true;
    video.playsInline = true;
    video.setAttribute('playsinline', '');
    video.setAttribute('aria-hidden', 'true');
    video.poster = choice.poster;
    video.src = choice.mp4;
    video.addEventListener('loadeddata', () => this.toggleAttribute('data-ready', true), { once: true });
    // insertBefore: los tipos de Workers redefinen `after`.
    this.#canvas?.parentNode?.insertBefore(video, this.#canvas.nextSibling);
    this.#fallbackVideo = video;
  }

  // -------------------------------------------------------------------------
  // Interacción: pausa, visor y teclado
  // -------------------------------------------------------------------------

  #localPoint(event: MouseEvent): { x: number; y: number } | null {
    const rect = this.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    return x >= 0 && y >= 0 && x <= rect.width && y <= rect.height ? { x, y } : null;
  }

  #onClick(event: MouseEvent): void {
    const target = event.target instanceof Element ? event.target : null;
    const action = target?.closest<HTMLElement>('[data-action]');
    if (action) {
      if (action.dataset.action === 'toggle') {
        this.#userPaused = !this.#userPaused;
        this.#syncToggleButton();
        this.#sync();
      } else if (action.dataset.action === 'close') {
        this.#closeViewer(true);
      }
      return;
    }
    // Enlace de la lista (teclado o sin animación): se abre en el visor.
    const link = target?.closest<HTMLAnchorElement>('a[data-wall-item]');
    if (link) {
      event.preventDefault();
      this.#openViewer(Number(link.dataset.wallItem), link);
      return;
    }
    if (target?.closest('[data-wall-viewer]')) {
      // Clic fuera de la imagen, en el fondo del visor: se cierra.
      if (!target.closest('figure')) this.#closeViewer(true);
      return;
    }
    if (this.#mode === 'video' || !this.#sim) return;
    const point = this.#localPoint(event);
    const piece = point ? this.#sim.pieceAt(point.x, point.y) : null;
    if (piece) this.#openViewer(piece.ref, null);
  }

  #onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape' && this.#viewerOpen) {
      event.preventDefault();
      this.#closeViewer(true);
    }
  }

  #onFocus(event: FocusEvent): void {
    const link = event.target instanceof Element ? event.target.closest<HTMLElement>('a[data-wall-item]') : null;
    this.#sim?.setFocusedItem(link ? Number(link.dataset.wallItem) : null);
  }

  #openViewer(index: number, trigger: HTMLElement | null): void {
    const item = this.#config?.items[index];
    const viewer = this.querySelector<HTMLElement>('[data-wall-viewer]');
    const slot = viewer?.querySelector<HTMLElement>('[data-viewer-media]');
    const caption = viewer?.querySelector<HTMLElement>('[data-viewer-caption]');
    if (!item || !viewer || !slot || !caption) return;
    slot.replaceChildren();
    if (item.video) {
      const video = document.createElement('video');
      video.muted = true;
      video.loop = true;
      video.playsInline = true;
      video.autoplay = true;
      video.setAttribute('playsinline', '');
      video.poster = item.image.avif ?? item.image.jpg;
      video.src = videoSource(item) ?? item.video.mp4;
      video.setAttribute('aria-label', item.title);
      slot.appendChild(video);
      video.play().catch(() => undefined);
    } else {
      const picture = document.createElement('picture');
      if (item.image.avif) {
        const avif = document.createElement('source');
        avif.type = 'image/avif';
        avif.srcset = item.image.avif;
        picture.appendChild(avif);
      }
      const img = document.createElement('img');
      img.src = item.image.jpg;
      img.alt = item.title;
      picture.appendChild(img);
      slot.appendChild(picture);
    }
    caption.textContent = item.title;
    viewer.hidden = false;
    this.#viewerOpen = true;
    this.#viewerTrigger = trigger;
    this.#sync();
    viewer.querySelector<HTMLElement>('[data-action="close"]')?.focus();
  }

  #closeViewer(restoreFocus: boolean): void {
    const viewer = this.querySelector<HTMLElement>('[data-wall-viewer]');
    if (!viewer || viewer.hidden) return;
    const video = viewer.querySelector('video');
    if (video) {
      video.pause();
      video.removeAttribute('src');
      video.load();
    }
    viewer.querySelector('[data-viewer-media]')?.replaceChildren();
    viewer.hidden = true;
    this.#viewerOpen = false;
    const trigger = this.#viewerTrigger;
    this.#viewerTrigger = null;
    if (restoreFocus) (trigger ?? this.querySelector<HTMLElement>('[data-action="toggle"]'))?.focus();
    this.#sync();
  }

  #syncToggleButton(): void {
    const button = this.querySelector<HTMLButtonElement>('[data-action="toggle"]');
    if (!button) return;
    button.textContent = this.#userPaused ? LABEL_RESUME : LABEL_PAUSE;
    button.setAttribute('aria-pressed', String(this.#userPaused));
  }

  // -------------------------------------------------------------------------
  // Exportación a vídeo
  // -------------------------------------------------------------------------

  #exposeRenderHooks(): void {
    const hooks = {
      /** Carga todas las fotos (y prepara los vídeos) antes del primer fotograma. */
      ready: async () => {
        const config = this.#config;
        if (!config) return false;
        await Promise.all(config.items.map((_, i) => this.#ensureImage(i)));
        return this.#mode === 'gl';
      },
      /** Pinta el instante `t` (s) y devuelve el fotograma en PNG (data URL). */
      frame: async (t: number) => {
        const sim = this.#sim;
        const gl = this.#gl;
        if (!sim || !gl) return null;
        const step = 1 / 120;
        while (this.#time + step <= t + 1e-9) {
          sim.step(step);
          this.#time += step;
        }
        const now = t * 1000;
        // Todos los vídeos a la vista, en el instante exacto de su bucle.
        const visible = new Set(
          sim.pieces.filter((p) => p.kind === 'item' && sim.items[p.ref]?.video && p.y < sim.height && p.y + p.mediaH > 0).map((p) => p.ref),
        );
        for (const ref of visible) {
          if (!this.#players.has(ref) && this.#videoHolder) {
            const src = videoSource(sim.items[ref] as ResolvedWallItem);
            if (src) this.#players.set(ref, new VideoPlayer(src, this.#videoHolder));
          }
        }
        for (const [ref, player] of this.#players) {
          if (!visible.has(ref)) {
            player.dispose();
            this.#players.delete(ref);
            this.#gl?.deleteTexture(this.#videoTextures.get(ref)?.texture ?? null);
            this.#videoTextures.delete(ref);
          }
        }
        await Promise.all([...visible].map((ref) => this.#players.get(ref)?.seek(t) ?? Promise.resolve()));
        this.#draw(now);
        return gl.canvas.toDataURL('image/png');
      },
    };
    (window as unknown as { __mediaWall?: typeof hooks }).__mediaWall = hooks;
    this.dataset.state = 'render';
  }
}

if (!customElements.get('media-wall')) customElements.define('media-wall', MediaWallElement);

document.addEventListener('astro:before-swap', () => MediaWallElement.teardownAll());

declare global {
  interface HTMLElementTagNameMap {
    'media-wall': MediaWallElement;
  }
}
