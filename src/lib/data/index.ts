/**
 * Capa de datos de la web pública (fase 2).
 * Cada consulta tiene un tiempo máximo y una alternativa: si Supabase no
 * responde, la web se sigue viendo con listas vacías y un aviso discreto.
 *
 * Excepción: con `DATA_STRICT` (build estático de GitHub Pages, ver
 * astro.config.pages.mjs) un fallo detiene la compilación. En una web
 * estática el aviso se quedaría publicado hasta el siguiente build; así sigue
 * en línea la última versión buena.
 */
import { PUBLIC_MEDIA_BASE_URL } from 'astro:env/client';
import { DATA_SOURCE, DATA_STRICT } from 'astro:env/server';
import { MEDIA_VIDEO, type MediaVideoConfig } from '../../config/media';
import { SITE } from '../../config/site';
import { getCutoffDate } from '../dates';
import { parseStoredVideo } from '../admin/video';
import { resolveMediaVideo, type ResolvedMediaVideo } from '../media';
import { createSupabasePublicClient, isSupabaseConfigured } from '../supabase/server';
import {
  DEFAULT_SETTINGS,
  GIG_COLUMNS,
  MIX_COLUMNS,
  QUERY_TIMEOUT_MS,
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
}

const useFixtures = DATA_SOURCE === 'fixtures';
let warnedNotConfigured = false;

/**
 * Tiempo máximo de cada consulta. Al compilar la web estática no hay nadie
 * esperando, así que se da más margen (p. ej., si Supabase tarda en despertar).
 */
const timeoutMs = DATA_STRICT ? 10_000 : QUERY_TIMEOUT_MS;

/** En modo estricto, un resultado fallido detiene el build (ver arriba). */
function checked<T>(result: DataResult<T>, label: string): DataResult<T> {
  if (DATA_STRICT && !result.ok) {
    throw new Error(
      `[datos] ${label}: la consulta a Supabase ha fallado y DATA_STRICT está activo. ` +
        'Se detiene el build para no publicar la web sin datos.',
    );
  }
  return result;
}

function notConfigured<T>(fallback: T): DataResult<T> {
  if (DATA_STRICT) {
    throw new Error(
      '[datos] Faltan PUBLIC_SUPABASE_URL y PUBLIC_SUPABASE_PUBLISHABLE_KEY, y DATA_STRICT está activo. ' +
        'En GitHub van en Settings → Secrets and variables → Actions → Variables.',
    );
  }
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
    { label: 'próximas fechas', timeoutMs },
  );
  return checked({ data: sortUpcoming(result.data.map(toGig)), ok: result.ok }, 'próximas fechas');
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
    { label: 'archivo', timeoutMs },
  );
  return checked({ data: sortPast(result.data.map(toGig)), ok: result.ok }, 'archivo');
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
    { label: 'próxima fecha', timeoutMs },
  );
  const first = result.data[0];
  return checked({ data: first ? toGig(first) : null, ok: result.ok }, 'próxima fecha');
}

/** Ajustes de la web (fila única de `site_settings`). */
export async function getSettings(): Promise<DataResult<SiteSettings>> {
  if (useFixtures) return { data: FIXTURE_SETTINGS, ok: true };
  if (!isSupabaseConfigured()) return notConfigured(DEFAULT_SETTINGS);

  const supabase = createSupabasePublicClient();
  const result = await runQuery<SettingsRow | null>(
    (signal) =>
      supabase
        .from('site_settings')
        .select('ticker_text, ticker_append_next_gig')
        .eq('id', 1)
        .abortSignal(signal)
        .maybeSingle(),
    null,
    { label: 'ajustes', timeoutMs },
  );
  if (!result.data) return checked({ data: DEFAULT_SETTINGS, ok: false }, 'ajustes');
  return checked(
    {
      data: { tickerText: result.data.ticker_text, tickerAppendNextGig: result.data.ticker_append_next_gig },
      ok: result.ok,
    },
    'ajustes',
  );
}

/** Texto de la barra de noticias: ajustes + próxima fecha (C04). */
export async function getTickerText(now: Date = new Date()): Promise<DataResult<string>> {
  const [settings, nextGig] = await Promise.all([getSettings(), getNextGig(now)]);
  const ok = settings.ok && nextGig.ok;
  const base = settings.ok ? settings.data : { ...settings.data, tickerText: SITE.tickerText };
  return { data: buildTickerText(base, nextGig.data, SITE.tickerText), ok };
}

/**
 * Mixes publicados del reproductor (C06), en su orden (`sort_order`); el
 * barajado se hace en el navegador. Los que no se pueden reproducir (ruta
 * relativa sin `PUBLIC_MEDIA_BASE_URL`) no salen: sin ninguno, la fila dice
 * «reproductor — próximamente».
 */
export async function getPublishedMixes(): Promise<DataResult<Mix[]>> {
  if (useFixtures) return { data: toMixes(FIXTURE_MIXES, PUBLIC_MEDIA_BASE_URL), ok: true };
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
    { label: 'mixes', timeoutMs },
  );
  return checked({ data: toMixes(result.data, PUBLIC_MEDIA_BASE_URL), ok: result.ok }, 'mixes');
}

/** Consulta mínima para /api/health (keep-alive de Supabase). */
export async function checkDatabase(): Promise<DataResult<boolean>> {
  if (useFixtures) return { data: true, ok: true };
  if (!isSupabaseConfigured()) return notConfigured(false);

  const supabase = createSupabasePublicClient();
  const result = await runQuery<{ id: number }[]>(
    (signal) => supabase.from('site_settings').select('id').limit(1).abortSignal(signal),
    [],
    { label: 'health', timeoutMs },
  );
  return checked({ data: result.ok, ok: result.ok }, 'health');
}

/**
 * Texto de Info guardado desde el panel (P2, fase 6), o `null` si no hay
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
    { label: 'texto de info', timeoutMs },
  );
  const text = result.data?.info_markdown?.trim();
  return checked({ data: text ? text : null, ok: result.ok }, 'texto de info');
}

/**
 * Vídeo de Media (C15) con las URLs completas, o `null` si falta
 * `PUBLIC_MEDIA_BASE_URL`. Sale de `site_settings.video` si se ha guardado
 * desde el panel (P2, fase 6) y es válido; si no, de `src/config/media.ts`.
 */
export async function getMediaVideo(): Promise<ResolvedMediaVideo | null> {
  if (useFixtures) return resolveMediaVideo(FIXTURE_VIDEO, PUBLIC_MEDIA_BASE_URL);
  const stored = await getStoredVideo();
  return resolveMediaVideo(stored.data ?? MEDIA_VIDEO, PUBLIC_MEDIA_BASE_URL);
}

/** El vídeo guardado desde el panel, o `null` (se usa el del código). */
export async function getStoredVideo(): Promise<DataResult<MediaVideoConfig | null>> {
  if (useFixtures) return { data: null, ok: true };
  if (!isSupabaseConfigured()) return notConfigured<MediaVideoConfig | null>(null);

  const supabase = createSupabasePublicClient();
  const result = await runQuery<{ video: unknown } | null>(
    (signal) => supabase.from('site_settings').select('video').eq('id', 1).abortSignal(signal).maybeSingle(),
    null,
    { label: 'vídeo', timeoutMs },
  );
  return checked({ data: parseStoredVideo(result.data?.video), ok: result.ok }, 'vídeo');
}
