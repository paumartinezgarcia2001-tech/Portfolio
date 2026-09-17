/**
 * Capa de datos de la web pública (fase 2).
 * Cada consulta tiene un tiempo máximo y una alternativa: si Supabase no
 * responde, la web se sigue viendo con listas vacías y un aviso discreto.
 */
import { DATA_SOURCE } from 'astro:env/server';
import { SITE } from '../../config/site';
import { getCutoffDate } from '../dates';
import { createSupabasePublicClient, isSupabaseConfigured } from '../supabase/server';
import {
  DEFAULT_SETTINGS,
  GIG_COLUMNS,
  buildTickerText,
  runQuery,
  sortPast,
  sortUpcoming,
  splitByCutoff,
  toGig,
  type DataResult,
  type Gig,
  type GigRow,
  type SiteSettings,
} from './core';
import { FIXTURE_GIGS, FIXTURE_SETTINGS } from './fixtures';

export type { DataResult, Gig, SiteSettings } from './core';

interface SettingsRow {
  ticker_text: string;
  ticker_append_next_gig: boolean;
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
    { label: 'ajustes' },
  );
  if (!result.data) return { data: DEFAULT_SETTINGS, ok: false };
  return {
    data: { tickerText: result.data.ticker_text, tickerAppendNextGig: result.data.ticker_append_next_gig },
    ok: result.ok,
  };
}

/** Texto de la barra de noticias: ajustes + próxima fecha (C04). */
export async function getTickerText(now: Date = new Date()): Promise<DataResult<string>> {
  const [settings, nextGig] = await Promise.all([getSettings(), getNextGig(now)]);
  const ok = settings.ok && nextGig.ok;
  const base = settings.ok ? settings.data : { ...settings.data, tickerText: SITE.tickerText };
  return { data: buildTickerText(base, nextGig.data, SITE.tickerText), ok };
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
