/**
 * Lecturas del panel (C19), con la sesión de la administradora: a diferencia
 * de la web pública, ve también los bolos y mixes sin publicar (RLS, §7.2).
 * Solo se llaman cuando el middleware ya ha comprobado la sesión.
 */
import { ARCHIVE_PAGE_SIZE } from '../../config/admin';
import { getCutoffDate } from '../dates';
import type { TypedSupabaseClient } from '../supabase/server';

export interface AdminGig {
  id: string;
  event_date: string;
  party_name: string | null;
  venue: string;
  city: string;
  lineup: string[];
  ticket_url: string | null;
  published: boolean;
  updated_at: string;
}

export interface AdminSettings {
  ticker_text: string;
  ticker_append_next_gig: boolean;
  info_markdown: string | null;
  video: unknown;
  updated_at: string;
}

export interface AdminMix {
  id: string;
  title: string;
  subtitle: string | null;
  audio_url: string;
  artwork_url: string | null;
  duration_seconds: number | null;
  published: boolean;
  sort_order: number;
}

export interface Loaded<T> {
  data: T;
  ok: boolean;
}

const GIG_COLUMNS = 'id, event_date, party_name, venue, city, lineup, ticket_url, published, updated_at';

function warn(label: string, error: { message: string } | null): void {
  if (error) console.warn(`[panel] ${label}: ${error.message}`);
}

export async function getAdminSettings(supabase: TypedSupabaseClient): Promise<Loaded<AdminSettings | null>> {
  const { data, error } = await supabase
    .from('site_settings')
    .select('ticker_text, ticker_append_next_gig, info_markdown, video, updated_at')
    .eq('id', 1)
    .maybeSingle();
  warn('ajustes', error);
  return { data: data ?? null, ok: !error };
}

/** Próximos bolos (§7.3), publicados o no, en orden ascendente. */
export async function getAdminUpcoming(supabase: TypedSupabaseClient, now: Date = new Date()): Promise<Loaded<AdminGig[]>> {
  const { data, error } = await supabase
    .from('gigs')
    .select(GIG_COLUMNS)
    .gte('event_date', getCutoffDate(now))
    .order('event_date', { ascending: true })
    .order('created_at', { ascending: true })
    .limit(500);
  warn('próximos bolos', error);
  return { data: data ?? [], ok: !error };
}

export interface ArchivePage {
  gigs: AdminGig[];
  total: number;
  page: number;
  pages: number;
}

/** Archivo en páginas de 50 (C19), del más reciente al más antiguo. */
export async function getAdminArchive(
  supabase: TypedSupabaseClient,
  page: number,
  now: Date = new Date(),
): Promise<Loaded<ArchivePage>> {
  const current = Math.max(1, Math.floor(page) || 1);
  const from = (current - 1) * ARCHIVE_PAGE_SIZE;
  const { data, error, count } = await supabase
    .from('gigs')
    .select(GIG_COLUMNS, { count: 'exact' })
    .lt('event_date', getCutoffDate(now))
    .order('event_date', { ascending: false })
    .order('created_at', { ascending: false })
    .range(from, from + ARCHIVE_PAGE_SIZE - 1);
  warn('archivo', error);
  const total = count ?? 0;
  return {
    data: { gigs: data ?? [], total, page: current, pages: Math.max(1, Math.ceil(total / ARCHIVE_PAGE_SIZE)) },
    ok: !error,
  };
}

export async function getAdminGig(supabase: TypedSupabaseClient, id: string): Promise<Loaded<AdminGig | null>> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return { data: null, ok: true };
  const { data, error } = await supabase.from('gigs').select(GIG_COLUMNS).eq('id', id).maybeSingle();
  warn('bolo', error);
  return { data: data ?? null, ok: !error };
}

export async function getAdminMixes(supabase: TypedSupabaseClient): Promise<Loaded<AdminMix[]>> {
  const { data, error } = await supabase
    .from('mixes')
    .select('id, title, subtitle, audio_url, artwork_url, duration_seconds, published, sort_order')
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true })
    .limit(500);
  warn('mixes', error);
  return { data: data ?? [], ok: !error };
}
