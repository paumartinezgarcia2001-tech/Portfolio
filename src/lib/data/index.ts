/**
 * Capa de datos de la web pública.
 * Cada consulta tiene un tiempo máximo y una alternativa: si Supabase no
 * responde, la web se sigue viendo con listas vacías y un aviso discreto.
 */
import { publicVar } from '../public-env';
import { DATA_SOURCE } from 'astro:env/server';
import { MEDIA_VIDEO, type MediaVideoConfig } from '../../config/media';
import { SITE } from '../../config/site';
import { getCutoffDate } from '../dates';
import { parseStoredVideo } from '../admin/video';
import { parseStoredTheme } from '../theme';
import type { Theme } from '../../config/theme';
import { resolveMediaVideo, type ResolvedMediaVideo } from '../media';
import { createSupabasePublicClient, isSupabaseConfigured } from '../supabase/server';
import {
  DEFAULT_SETTINGS,
  GIG_COLUMNS,
  MIX_COLUMNS,
  buildTickerText,
  runQuery,
  sortPast,
  sortUpcoming,
  splitByCutoff,
  toGig,
  toMixes,
  type DataResult,
  type Gig,
  type GigRow,
  type Mix,
  type MixRow,
  type SiteSettings,
} from './core';
import { FIXTURE_GIGS, FIXTURE_MIXES, FIXTURE_SETTINGS, FIXTURE_VIDEO } from './fixtures';

export type { DataResult, Gig, Mix, SiteSettings } from './core';

interface SettingsRow {
  ticker_text: string;
  ticker_append_next_gig: boolean;
  /** Colores del panel (migración 0007). Puede no existir si aún no se ha aplicado. */
  theme?: unknown;
}

const useFixtures = DATA_SOURCE === 'fixtures';
let warnedNotConfigured = false;

function notConfigured<T>(fallback: T): DataResult<T> {
  if (!warnedNotConfigured) {
    console.warn('[datos] Supabase no está configurado (PUBLIC_SUPABASE_URL / PUBLIC_SUPABASE_PUBLISHABLE_KEY).');
    warnedNotConfigured = true;
  }
  return { data: fallback, ok: false };
}

/** Bolos publicados con fecha efectiva igual o posterior a hoy, en orden ascendente (C14). */
export async function getUpcomingGigs(now: Date = new Date()): Promise<DataResult<Gig[]>> {
  const cutoff = getCutoffDate(now);
  if (useFixtures) return { data: splitByCutoff(FIXTURE_GIGS, cutoff).upcoming, ok: true };
  if (!isSupabaseConfigured()) return notConfigured<Gig[]>([]);

  const supabase = createSupabasePublicClient();
  const result = await runQuery<GigRow[]>(
    (signal) =>
      supabase
        .from('gigs')
        .select(GIG_COLUMNS)
        .eq('published', true)
        .gte('event_date', cutoff)
        .order('event_date', { ascending: true })
        .order('created_at', { ascending: true })
        .abortSignal(signal),
    [],
    { label: 'próximas fechas' },
  );
  return { data: sortUpcoming(result.data.map(toGig)), ok: result.ok };
}

/** Bolos publicados anteriores a hoy, del más reciente al más antiguo (C16). */
export async function getPastGigs(now: Date = new Date()): Promise<DataResult<Gig[]>> {
  const cutoff = getCutoffDate(now);
  if (useFixtures) return { data: splitByCutoff(FIXTURE_GIGS, cutoff).past, ok: true };
  if (!isSupabaseConfigured()) return notConfigured<Gig[]>([]);

  const supabase = createSupabasePublicClient();
  const result = await runQuery<GigRow[]>(
    (signal) =>
      supabase
        .from('gigs')
        .select(GIG_COLUMNS)
        .eq('published', true)
        .lt('event_date', cutoff)
        .order('event_date', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(5000)
        .abortSignal(signal),
    [],
    { label: 'archivo' },
  );
  return { data: sortPast(result.data.map(toGig)), ok: result.ok };
}

/** El próximo bolo, o `null` si no hay ninguno anunciado. */
export async function getNextGig(now: Date = new Date()): Promise<DataResult<Gig | null>> {
  const cutoff = getCutoffDate(now);
  if (useFixtures) return { data: splitByCutoff(FIXTURE_GIGS, cutoff).upcoming[0] ?? null, ok: true };
  if (!isSupabaseConfigured()) return notConfigured<Gig | null>(null);

  const supabase = createSupabasePublicClient();
  const result = await runQuery<GigRow[]>(
    (signal) =>
      supabase
        .from('gigs')
        .select(GIG_COLUMNS)
        .eq('published', true)
        .gte('event_date', cutoff)
        .order('event_date', { ascending: true })
        .order('created_at', { ascending: true })
        .limit(1)
        .abortSignal(signal),
    [],
    { label: 'próxima fecha' },
  );
  const first = result.data[0];
  return { data: first ? toGig(first) : null, ok: result.ok };
}

/**
 * Fila de `site_settings`. Con `*` y no columna a columna: así, si la
 * migración de los colores (0007) aún no se ha aplicado, no falla.
 */
async function getSettingsRow(): Promise<DataResult<SettingsRow | null>> {
  const supabase = createSupabasePublicClient();
  const result = await runQuery<SettingsRow | null>(
    (signal) => supabase.from('site_settings').select('*').eq('id', 1).abortSignal(signal).maybeSingle(),
    null,
    { label: 'ajustes' },
  );
  return result.data ? result : { data: null, ok: false };
}

function toSettings(row: SettingsRow): SiteSettings {
  return { tickerText: row.ticker_text, tickerAppendNextGig: row.ticker_append_next_gig };
}

/** Ajustes de la web (fila única de `site_settings`). */
export async function getSettings(): Promise<DataResult<SiteSettings>> {
  if (useFixtures) return { data: FIXTURE_SETTINGS, ok: true };
  if (!isSupabaseConfigured()) return notConfigured(DEFAULT_SETTINGS);
  const row = await getSettingsRow();
  if (!row.data) return { data: DEFAULT_SETTINGS, ok: false };
  return { data: toSettings(row.data), ok: row.ok };
}

function tickerFrom(settings: DataResult<SiteSettings>, nextGig: DataResult<Gig | null>): DataResult<string> {
  const ok = settings.ok && nextGig.ok;
  const base = settings.ok ? settings.data : { ...settings.data, tickerText: SITE.tickerText };
  return { data: buildTickerText(base, nextGig.data, SITE.tickerText), ok };
}

/** Texto de la barra de noticias: ajustes + próxima fecha (C04). */
export async function getTickerText(now: Date = new Date()): Promise<DataResult<string>> {
  const [settings, nextGig] = await Promise.all([getSettings(), getNextGig(now)]);
  return tickerFrom(settings, nextGig);
}

export interface LayoutData {
  /** Texto de la barra de noticias (C04). */
  ticker: DataResult<string>;
  /** Colores elegidos en el panel, o `null` (los del código). */
  theme: Theme | null;
}

/**
 * Lo que necesita el layout de todas las páginas públicas con una sola
 * lectura de `site_settings`: la barra de noticias y los colores del panel.
 */
export async function getLayoutData(now: Date = new Date()): Promise<LayoutData> {
  if (useFixtures || !isSupabaseConfigured()) {
    return { ticker: await getTickerText(now), theme: null };
  }
  const [row, nextGig] = await Promise.all([getSettingsRow(), getNextGig(now)]);
  const settings = row.data
    ? { data: toSettings(row.data), ok: row.ok }
    : { data: DEFAULT_SETTINGS, ok: false };
  return { ticker: tickerFrom(settings, nextGig), theme: parseStoredTheme(row.data?.theme) };
}

/** Solo los colores del panel (páginas que no pasan por el middleware de las secciones). */
export async function getSiteTheme(): Promise<Theme | null> {
  if (useFixtures || !isSupabaseConfigured()) return null;
  const row = await getSettingsRow();
  return parseStoredTheme(row.data?.theme);
}

/**
 * Mixes publicados del reproductor (C06), en su orden (`sort_order`); el
 * barajado se hace en el navegador. Los que no se pueden reproducir (ruta
 * relativa sin `PUBLIC_MEDIA_BASE_URL`) no salen: sin ninguno, la fila dice
 * «reproductor — próximamente».
 */
export async function getPublishedMixes(): Promise<DataResult<Mix[]>> {
  if (useFixtures) return { data: toMixes(FIXTURE_MIXES, publicVar('PUBLIC_MEDIA_BASE_URL')), ok: true };
  if (!isSupabaseConfigured()) return notConfigured<Mix[]>([]);

  const supabase = createSupabasePublicClient();
  const result = await runQuery<MixRow[]>(
    (signal) =>
      supabase
        .from('mixes')
        .select(MIX_COLUMNS)
        .eq('published', true)
        .order('sort_order', { ascending: true })
        .order('created_at', { ascending: true })
        .limit(500)
        .abortSignal(signal),
    [],
    { label: 'mixes' },
  );
  return { data: toMixes(result.data, publicVar('PUBLIC_MEDIA_BASE_URL')), ok: result.ok };
}

/** Consulta mínima para /api/health (keep-alive de Supabase). */
export async function checkDatabase(): Promise<DataResult<boolean>> {
  if (useFixtures) return { data: true, ok: true };
  if (!isSupabaseConfigured()) return notConfigured(false);

  const supabase = createSupabasePublicClient();
  const result = await runQuery<{ id: number }[]>(
    (signal) => supabase.from('site_settings').select('id').limit(1).abortSignal(signal),
    [],
    { label: 'health' },
  );
  return { data: result.ok, ok: result.ok };
}

/**
 * Texto de Info guardado desde el panel, o `null` si no hay
 * (entonces la página usa src/content/info.md). Si la consulta falla, también
 * `null`: mejor el texto del repo que una página vacía.
 */
export async function getInfoMarkdown(): Promise<DataResult<string | null>> {
  if (useFixtures) return { data: null, ok: true };
  if (!isSupabaseConfigured()) return notConfigured<string | null>(null);

  const supabase = createSupabasePublicClient();
  const result = await runQuery<{ info_markdown: string | null } | null>(
    (signal) => supabase.from('site_settings').select('info_markdown').eq('id', 1).abortSignal(signal).maybeSingle(),
    null,
    { label: 'texto de info' },
  );
  const text = result.data?.info_markdown?.trim();
  return { data: text ? text : null, ok: result.ok };
}

/**
 * Vídeo de Media (C15) con las URLs completas, o `null` si falta
 * `PUBLIC_MEDIA_BASE_URL`. Sale de `site_settings.video` si se ha guardado
 * desde el panel y es válido; si no, de `src/config/media.ts`.
 */
export async function getMediaVideo(): Promise<ResolvedMediaVideo | null> {
  if (useFixtures) return resolveMediaVideo(FIXTURE_VIDEO, publicVar('PUBLIC_MEDIA_BASE_URL'));
  const stored = await getStoredVideo();
  return resolveMediaVideo(stored.data ?? MEDIA_VIDEO, publicVar('PUBLIC_MEDIA_BASE_URL'));
}

/** El vídeo guardado desde el panel, o `null` (se usa el del código). */
export async function getStoredVideo(): Promise<DataResult<MediaVideoConfig | null>> {
  if (useFixtures) return { data: null, ok: true };
  if (!isSupabaseConfigured()) return notConfigured<MediaVideoConfig | null>(null);

  const supabase = createSupabasePublicClient();
  const result = await runQuery<{ video: unknown } | null>(
    (signal) => supabase.from('site_settings').select('video').eq('id', 1).abortSignal(signal).maybeSingle(),
    null,
    { label: 'vídeo' },
  );
  return { data: parseStoredVideo(result.data?.video), ok: result.ok };
}
