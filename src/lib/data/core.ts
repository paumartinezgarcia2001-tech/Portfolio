/**
 * Lógica pura de la capa de datos (sin módulos de Astro, para poder probarla).
 */
import { formatEventDate } from '../dates';
import { resolveMediaUrl } from '../media';
import { TICKER_SEPARATOR, normalizeTickerText } from '../ticker';

export interface Gig {
  id: string;
  /** AAAA-MM-DD */
  eventDate: string;
  partyName: string | null;
  venue: string;
  city: string;
  lineup: string[];
  ticketUrl: string | null;
}

export interface SiteSettings {
  tickerText: string;
  tickerAppendNextGig: boolean;
}

/**
 * Resultado de una consulta. Si `ok` es `false`, `data` es la alternativa
 * (lista vacía, ajustes por defecto…) y la web avisa con discreción.
 */
export interface DataResult<T> {
  data: T;
  ok: boolean;
}

export interface GigRow {
  id: string;
  event_date: string;
  party_name: string | null;
  venue: string;
  city: string;
  lineup: string[] | null;
  ticket_url: string | null;
}

export const GIG_COLUMNS = 'id, event_date, party_name, venue, city, lineup, ticket_url';

/** Un mix del reproductor (C06), con las URLs ya completas. */
export interface Mix {
  id: string;
  title: string;
  subtitle: string | null;
  /** URL del audio. */
  src: string;
  durationSeconds: number | null;
  /** Carátula cuadrada, si la hay. */
  artwork: string | null;
}

export interface MixRow {
  id: string;
  title: string;
  subtitle: string | null;
  /** Ruta dentro del bucket (`mixes/<slug>-<hash>.mp3`) o URL completa (D46). */
  audio_url: string;
  duration_seconds: number | null;
  artwork_url: string | null;
}

export const MIX_COLUMNS = 'id, title, subtitle, audio_url, duration_seconds, artwork_url';

/**
 * Fila de `mixes` → mix para la web. Las rutas relativas se completan con la
 * base del bucket (`PUBLIC_MEDIA_BASE_URL`); sin base, el mix no se puede
 * reproducir y se descarta (`null`).
 */
export function toMix(row: MixRow, base: string | undefined | null): Mix | null {
  const src = resolveMediaUrl(base, row.audio_url);
  if (!src) return null;
  return {
    id: row.id,
    title: row.title,
    subtitle: row.subtitle,
    src,
    durationSeconds: row.duration_seconds,
    artwork: row.artwork_url ? resolveMediaUrl(base, row.artwork_url) : null,
  };
}

/** Las filas que se pueden reproducir, en su orden. */
export function toMixes(rows: MixRow[], base: string | undefined | null): Mix[] {
  return rows.map((row) => toMix(row, base)).filter((mix): mix is Mix => mix !== null);
}

/** Tiempo máximo de cada consulta (fase 2). */
export const QUERY_TIMEOUT_MS = 2500;

export const DEFAULT_SETTINGS: SiteSettings = {
  tickerText: '',
  tickerAppendNextGig: true,
};

export function toGig(row: GigRow): Gig {
  return {
    id: row.id,
    eventDate: row.event_date,
    partyName: row.party_name,
    venue: row.venue,
    city: row.city,
    lineup: row.lineup ?? [],
    ticketUrl: row.ticket_url,
  };
}

/** Próximas: ascendente. Mismo día: por orden de alta. */
export function sortUpcoming(gigs: Gig[]): Gig[] {
  return [...gigs].sort((a, b) => a.eventDate.localeCompare(b.eventDate));
}

/** Archivo: descendente (el más reciente arriba). */
export function sortPast(gigs: Gig[]): Gig[] {
  return [...gigs].sort((a, b) => b.eventDate.localeCompare(a.eventDate));
}

/** Reparte los bolos según la fecha de corte (§7.3). */
export function splitByCutoff(gigs: Gig[], cutoff: string): { upcoming: Gig[]; past: Gig[] } {
  return {
    upcoming: sortUpcoming(gigs.filter((g) => g.eventDate >= cutoff)),
    past: sortPast(gigs.filter((g) => g.eventDate < cutoff)),
  };
}

/** `PRÓXIMA FECHA: 25 SEPTIEMBRE 2026 · LA2, Sevilla` (C04). */
export function formatNextGig(gig: Gig): string {
  return `PRÓXIMA FECHA: ${formatEventDate(gig.eventDate)} · ${gig.venue}, ${gig.city}`;
}

/**
 * Texto completo de la barra de noticias: el de los ajustes y, si toca, la
 * próxima fecha. Si no queda nada, se usa `fallback`.
 */
export function buildTickerText(settings: SiteSettings, nextGig: Gig | null, fallback: string): string {
  const parts: string[] = [];
  const base = normalizeTickerText(settings.tickerText);
  if (base) parts.push(base);
  if (settings.tickerAppendNextGig && nextGig) parts.push(formatNextGig(nextGig));
  return parts.length > 0 ? parts.join(TICKER_SEPARATOR) : fallback;
}

interface QueryResponse<T> {
  data: T | null;
  error: { message: string } | null;
}

interface RunQueryOptions {
  label: string;
  timeoutMs?: number;
  log?: (message: string) => void;
}

/**
 * Ejecuta una consulta con tiempo máximo. Nunca lanza: si falla, se agota el
 * tiempo o no hay datos, devuelve `fallback` con `ok: false` y deja un aviso
 * en la consola.
 */
export async function runQuery<T>(
  run: (signal: AbortSignal) => PromiseLike<QueryResponse<T>>,
  fallback: T,
  { label, timeoutMs = QUERY_TIMEOUT_MS, log = console.warn }: RunQueryOptions,
): Promise<DataResult<T>> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      const error = new Error(`tiempo agotado (${timeoutMs} ms)`);
      controller.abort(error);
      reject(error);
    }, timeoutMs);
  });

  try {
    const response = await Promise.race([Promise.resolve(run(controller.signal)), timeout]);
    if (response.error) {
      log(`[datos] ${label}: ${response.error.message}`);
      return { data: fallback, ok: false };
    }
    return { data: response.data ?? fallback, ok: true };
  } catch (error) {
    log(`[datos] ${label}: ${error instanceof Error ? error.message : String(error)}`);
    return { data: fallback, ok: false };
  } finally {
    clearTimeout(timer);
  }
}
