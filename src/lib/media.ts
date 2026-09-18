/**
 * Vídeo de Media (C15): funciones puras para pasar la configuración
 * (`src/config/media.ts`) a URLs completas y a lo que necesita la página.
 */
import type { MediaVideoConfig, VideoRendition } from '../config/media';
import { DESKTOP_MIN_WIDTH } from '../config/site';

export interface ResolvedRendition {
  hls: string;
  mp4: string;
  posterJpg: string;
  posterAvif: string | null;
  width: number;
  height: number;
}

export interface ResolvedMediaVideo {
  slug: string;
  title: string;
  audio: boolean;
  /** Versión principal (escritorio, 4:5). */
  main: ResolvedRendition;
  /** Versión estrecha (9:16), si la hay. */
  narrow: ResolvedRendition | null;
  /** Media query en la que se usa la versión estrecha (póster y vídeo), o `null`. */
  narrowQuery: string | null;
  /** `object-position` del punto focal, p. ej. «50% 40%». */
  objectPosition: string;
  fullSet: { href: string; label: string } | null;
  /** Origen del bucket (para `preconnect`), o `null` si las URLs son de varios sitios. */
  origin: string | null;
}

/**
 * URL completa de un archivo del bucket. Las URLs absolutas se respetan; las
 * relativas necesitan la base (`PUBLIC_MEDIA_BASE_URL`), si no → `null`.
 */
export function resolveMediaUrl(base: string | undefined | null, path: string): string | null {
  if (/^https?:\/\//i.test(path)) return path;
  if (!base) return null;
  return `${base.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;
}

function resolveRendition(base: string | undefined | null, rendition: VideoRendition): ResolvedRendition | null {
  const hls = resolveMediaUrl(base, rendition.hls);
  const mp4 = resolveMediaUrl(base, rendition.mp4);
  const posterJpg = resolveMediaUrl(base, rendition.poster.jpg);
  if (!hls || !mp4 || !posterJpg) return null;
  return {
    hls,
    mp4,
    posterJpg,
    posterAvif: rendition.poster.avif ? resolveMediaUrl(base, rendition.poster.avif) : null,
    width: rendition.width,
    height: rendition.height,
  };
}

/** Proporción como fracción de enteros, que entienden todos los navegadores en `aspect-ratio`. */
function ratioText(value: number): string {
  return `${Math.round(value * 10_000)}/10000`;
}

/**
 * Media query en la que el panel se parece más a la versión estrecha que a la
 * principal. El umbral es la media geométrica de las dos proporciones (ancho ÷
 * alto): en móvil (<1024 px) el panel ocupa toda la ventana; en escritorio,
 * la mitad.
 *
 * `narrowQuery(4/5, 9/16)` → se usa 9:16 cuando el panel es más estrecho que ≈0,67.
 */
export function narrowQuery(mainAspect: number, narrowAspect: number, breakpoint = DESKTOP_MIN_WIDTH): string {
  const threshold = Math.sqrt(mainAspect * narrowAspect);
  return (
    `(max-width: ${breakpoint - 0.02}px) and (max-aspect-ratio: ${ratioText(threshold)}), ` +
    `(min-width: ${breakpoint}px) and (max-aspect-ratio: ${ratioText(threshold * 2)})`
  );
}

/** Punto focal (0–1) → `object-position`. */
export function objectPosition(focusX: number, focusY: number): string {
  const pct = (v: number) => `${Math.round(Math.min(1, Math.max(0, v)) * 1000) / 10}%`;
  return `${pct(focusX)} ${pct(focusY)}`;
}

/** Todo lo que necesita la página, o `null` si falta la base de R2. */
export function resolveMediaVideo(config: MediaVideoConfig, base: string | undefined | null): ResolvedMediaVideo | null {
  const main = resolveRendition(base, config);
  if (!main) return null;
  const narrow = config.mobile ? resolveRendition(base, config.mobile) : null;
  const origins = new Set(
    [main.hls, main.posterJpg, narrow?.hls, narrow?.posterJpg].filter(Boolean).map((u) => new URL(u as string).origin),
  );
  return {
    slug: config.slug,
    title: config.title,
    audio: config.audio,
    main,
    narrow,
    narrowQuery: narrow ? narrowQuery(main.width / main.height, narrow.width / narrow.height) : null,
    objectPosition: objectPosition(config.focusX, config.focusY),
    fullSet: config.fullSet ?? null,
    origin: origins.size === 1 ? ([...origins][0] ?? null) : null,
  };
}
