/**
 * Fuentes de imagen del muro (D65): fotos, bucles de vídeo y rótulos.
 *
 * - Fotos: con CORS (`crossOrigin = 'anonymous'`), porque WebGL no deja usar
 *   como textura una imagen de otro origen sin él. AVIF si el navegador lo
 *   decodifica; si no, JPG. Se reducen al ancho que ocupan en pantalla
 *   (`createImageBitmap`) para no gastar memoria de GPU de más.
 * - Vídeos: un `<video>` mudo por pieza activa, como mucho `maxVideos` a la
 *   vez. AV1 si el navegador lo decodifica (pesa menos); si no, H.264. Van
 *   dentro del componente, tapados por el canvas: Safari pausa los vídeos que
 *   no están en el documento o no se ven.
 * - Rótulos: se dibujan una vez con Canvas 2D como máscara (rojo = caja,
 *   verde = texto) y el shader los colorea con los tokens.
 */
import type { ResolvedWallItem } from '../../lib/media-wall';

// AVIF de 2×2 (hecho con ffmpeg): si se decodifica, el navegador entiende AVIF.
const AVIF_PROBE =
  'data:image/avif;base64,AAAAIGZ0eXBhdmlmAAAAAGF2aWZtaWYxbWlhZk1BMUIAAAD5bWV0YQAAAAAAAAAvaGRscgAAAAAAAAAAcGljdAAAAAAAAAAAAAAAAFBpY3R1cmVIYW5kbGVyAAAAAA5waXRtAAAAAAABAAAAHmlsb2MAAAAARAAAAQABAAAAAQAAASEAAAAVAAAAKGlpbmYAAAAAAAEAAAAaaW5mZQIAAAAAAQAAYXYwMUNvbG9yAAAAAGppcHJwAAAAS2lwY28AAAAUaXNwZQAAAAAAAAACAAAAAgAAABBwaXhpAAAAAAMICAgAAAAMYXYxQ4EADAAAAAATY29scm5jbHgAAgACAAIAAAAAF2lwbWEAAAAAAAAAAQABBAECgwQAAAAdbWRhdAoFGAA2wCAyDByAAABYAABAA1LtBA==';

let avifSupport: Promise<boolean> | undefined;

export function supportsAvif(): Promise<boolean> {
  avifSupport ??= new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img.width > 0);
    img.onerror = () => resolve(false);
    img.src = AVIF_PROBE;
  });
  return avifSupport;
}

export type TextureSource = ImageBitmap | HTMLImageElement | HTMLCanvasElement | HTMLVideoElement;

/** Carga la foto de una pieza, reducida a `maxWidth` px si el navegador sabe hacerlo. */
export async function loadItemImage(item: ResolvedWallItem, maxWidth: number, signal: AbortSignal): Promise<TextureSource> {
  const src = item.image.avif && (await supportsAvif()) ? item.image.avif : item.image.jpg;
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.decoding = 'async';
  img.src = src;
  await img.decode();
  if (signal.aborted) throw new DOMException('Cancelado', 'AbortError');
  const width = Math.round(maxWidth);
  if (typeof createImageBitmap === 'function' && img.naturalWidth > width * 1.15) {
    try {
      const height = Math.round((img.naturalHeight / img.naturalWidth) * width);
      return await createImageBitmap(img, { resizeWidth: width, resizeHeight: height, resizeQuality: 'high' });
    } catch {
      // Safari antiguo: sin opciones de tamaño. Se usa la imagen tal cual.
    }
  }
  return img;
}

let av1Support: boolean | undefined;

/** ¿Decodifica AV1 este navegador? (en Safari, solo con hardware). */
export function prefersAv1(): boolean {
  if (av1Support !== undefined) return av1Support;
  const probe = document.createElement('video');
  const type = 'video/mp4; codecs="av01.0.05M.08"';
  const mse = 'MediaSource' in window && MediaSource.isTypeSupported(type);
  av1Support = mse || probe.canPlayType(type) === 'probably';
  return av1Support;
}

export function videoSource(item: ResolvedWallItem): string | null {
  if (!item.video) return null;
  return item.video.av1 && prefersAv1() ? item.video.av1 : item.video.mp4;
}

/**
 * Un bucle de vídeo para una pieza. `fresh` se pone a `true` cuando hay un
 * fotograma nuevo que subir a la GPU (con `requestVideoFrameCallback` si
 * existe; si no, cuando avanza `currentTime`).
 */
export class VideoPlayer {
  readonly video: HTMLVideoElement;
  fresh = false;
  /** Último momento (ms) en que alguna pieza lo necesitó. */
  lastWanted = 0;
  #lastTime = -1;
  #frameHandle = 0;
  #disposed = false;

  constructor(src: string, holder: HTMLElement) {
    const video = document.createElement('video');
    video.crossOrigin = 'anonymous';
    video.muted = true;
    video.defaultMuted = true;
    video.loop = true;
    video.playsInline = true;
    video.preload = 'auto';
    video.setAttribute('playsinline', '');
    video.setAttribute('muted', '');
    video.setAttribute('aria-hidden', 'true');
    video.tabIndex = -1;
    video.src = src;
    this.video = video;
    holder.appendChild(video);
    this.#watchFrames();
  }

  /** ¿Tiene ya imagen que enseñar? */
  get ready(): boolean {
    return this.video.readyState >= 2 && this.video.videoWidth > 0;
  }

  play(): void {
    if (this.#disposed) return;
    this.video.play().catch(() => {
      // Ahorro de batería (iOS) o similar: se queda la foto, sin error.
    });
  }

  pause(): void {
    if (!this.video.paused) this.video.pause();
  }

  /** Comprueba si hay fotograma nuevo cuando no existe requestVideoFrameCallback. */
  poll(): void {
    if (this.#frameHandle || !this.ready) return;
    const t = this.video.currentTime;
    if (t !== this.#lastTime) {
      this.#lastTime = t;
      this.fresh = true;
    }
  }

  /**
   * Para la exportación: va al instante `t` (s) del bucle y espera al
   * fotograma. Si el vídeo no carga (códec, red), sigue a los 5 s con la foto.
   */
  async seek(t: number): Promise<void> {
    const video = this.video;
    const wait = (event: string) =>
      new Promise<void>((resolve) => {
        const done = () => {
          clearTimeout(timer);
          video.removeEventListener(event, done);
          video.removeEventListener('error', done);
          resolve();
        };
        const timer = setTimeout(done, 5000);
        video.addEventListener(event, done, { once: true });
        video.addEventListener('error', done, { once: true });
      });
    if (video.readyState < 1) await wait('loadedmetadata');
    if (video.error || !video.duration) return;
    const target = t % video.duration;
    if (Math.abs(video.currentTime - target) < 0.004 && video.readyState >= 2) return;
    const seeked = wait('seeked');
    video.currentTime = target;
    await seeked;
    this.fresh = true;
  }

  dispose(): void {
    this.#disposed = true;
    const video = this.video;
    if (this.#frameHandle && 'cancelVideoFrameCallback' in video) video.cancelVideoFrameCallback(this.#frameHandle);
    this.#frameHandle = 0;
    video.pause();
    video.removeAttribute('src');
    video.load();
    video.remove();
  }

  #watchFrames(): void {
    const video = this.video;
    if (!('requestVideoFrameCallback' in video)) return;
    const onFrame = () => {
      if (this.#disposed) return;
      this.fresh = true;
      this.#frameHandle = video.requestVideoFrameCallback(onFrame);
    };
    this.#frameHandle = video.requestVideoFrameCallback(onFrame);
  }
}

export interface MaskStyle {
  fontFamily: string;
  /** px CSS */
  fontSize: number;
  /** 700 en los rótulos de bolos (nombres de fiesta, D16); 400 en el resto. */
  fontWeight: number;
  dpr: number;
}

/**
 * Máscara de un rótulo para el shader: caja en rojo (solo `boxed`) y texto en
 * verde, en px de dispositivo. Corta con «…» si no cabe en `maxWidth` px CSS.
 */
export function drawTextMask(
  text: string,
  maxWidth: number,
  height: number,
  style: MaskStyle,
  boxed: boolean,
): { canvas: HTMLCanvasElement; width: number } {
  const { dpr } = style;
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  const padX = boxed ? Math.round(style.fontSize * 0.5) : 0;
  const font = `${style.fontWeight} ${style.fontSize * dpr}px ${style.fontFamily}`;
  let label = text;
  let textWidth = 0;
  if (ctx) {
    ctx.font = font;
    const limit = (maxWidth - padX * 2) * dpr;
    textWidth = ctx.measureText(label).width;
    while (label.length > 1 && textWidth > limit) {
      label = `${label.slice(0, -2).trimEnd()}…`;
      textWidth = ctx.measureText(label).width;
    }
  }
  const width = Math.min(maxWidth, Math.ceil(textWidth / dpr + padX * 2));
  canvas.width = Math.max(1, Math.round(width * dpr));
  canvas.height = Math.max(1, Math.round(height * dpr));
  if (ctx) {
    ctx.font = font;
    ctx.textBaseline = 'middle';
    if (boxed) {
      ctx.fillStyle = '#f00';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
    ctx.fillStyle = '#0f0';
    ctx.fillText(label, padX * dpr, canvas.height / 2 + dpr * 0.5);
  }
  return { canvas, width };
}
