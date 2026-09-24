/**
 * Contexto del panel (C19) en el servidor: lo prepara src/middleware.ts para
 * las páginas y lo usan las Actions `admin.*` (src/actions/admin.ts).
 */
import type { AstroCookies } from 'astro';
import type { CacheTag } from '../../config/cache';
import { createSupabaseServerClient, isSupabaseConfigured, type TypedSupabaseClient } from '../supabase/server';
import { readSessionState, type SessionState } from './session';

export interface AdminLocals {
  /** Parámetro de la URL (el nombre del panel), ya comparado con `ADMIN_PATH`. */
  slug: string;
  /** `null` si Supabase no está configurado. */
  supabase: TypedSupabaseClient | null;
  state: SessionState;
}

interface RequestContext {
  request: Request;
  cookies: AstroCookies;
}

/** Cliente con la sesión de las cookies y su estado. */
export async function openAdminContext(context: RequestContext): Promise<{
  supabase: TypedSupabaseClient | null;
  state: SessionState;
  responseHeaders: Headers;
}> {
  if (!isSupabaseConfigured()) return { supabase: null, state: { kind: 'anonymous' }, responseHeaders: new Headers() };
  const { supabase, responseHeaders } = createSupabaseServerClient(context);
  return { supabase, state: await readSessionState(supabase), responseHeaders };
}

interface CacheContext {
  cache: { enabled: boolean; invalidate(options: { tags: string[] }): Promise<void> };
}

/**
 * Purga la caché de la web pública (§6) tras guardar. Si falla (p. ej. en
 * local, sin la caché de Cloudflare), no pasa nada: las páginas caducan solas
 * en 60 s.
 */
export async function invalidatePublicCache(context: CacheContext, tags: CacheTag[]): Promise<void> {
  if (!context.cache.enabled) return;
  try {
    await context.cache.invalidate({ tags });
  } catch (error) {
    console.warn(`[panel] No se ha podido purgar la caché (${tags.join(', ')}): ${error instanceof Error ? error.message : String(error)}`);
  }
}
