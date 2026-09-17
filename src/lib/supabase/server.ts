/**
 * Clientes de Supabase para el servidor (Worker).
 *
 * - `createSupabasePublicClient()`: páginas públicas. Solo la clave publicable,
 *   sin sesión ni cookies, para que el HTML se pueda cachear.
 * - `createSupabaseServerClient()`: panel (fase 6). Sesión en cookies de Astro
 *   con el patrón getAll/setAll de @supabase/ssr.
 *
 * La clave secreta (sb_secret_…) nunca se usa aquí.
 */
import { createServerClient, parseCookieHeader } from '@supabase/ssr';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { AstroCookies } from 'astro';
import { PUBLIC_SUPABASE_PUBLISHABLE_KEY, PUBLIC_SUPABASE_URL } from 'astro:env/client';
import type { Database } from './types';

export type TypedSupabaseClient = SupabaseClient<Database>;

export function isSupabaseConfigured(): boolean {
  return Boolean(PUBLIC_SUPABASE_URL && PUBLIC_SUPABASE_PUBLISHABLE_KEY);
}

function requireConfig(): { url: string; key: string } {
  if (!PUBLIC_SUPABASE_URL || !PUBLIC_SUPABASE_PUBLISHABLE_KEY) {
    throw new Error('Faltan PUBLIC_SUPABASE_URL o PUBLIC_SUPABASE_PUBLISHABLE_KEY.');
  }
  return { url: PUBLIC_SUPABASE_URL, key: PUBLIC_SUPABASE_PUBLISHABLE_KEY };
}

export function createSupabasePublicClient(): TypedSupabaseClient {
  const { url, key } = requireConfig();
  return createClient<Database>(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

interface ServerClientContext {
  request: Request;
  cookies: AstroCookies;
}

/**
 * Cliente con sesión para el panel. Devuelve también las cabeceras que
 * @supabase/ssr pide añadir cuando escribe cookies (no-store): quien lo use
 * debe copiarlas a la respuesta.
 */
export function createSupabaseServerClient(context: ServerClientContext): {
  supabase: TypedSupabaseClient;
  responseHeaders: Headers;
} {
  const { url, key } = requireConfig();
  const responseHeaders = new Headers();
  const supabase = createServerClient<Database>(url, key, {
    cookies: {
      getAll() {
        return parseCookieHeader(context.request.headers.get('Cookie') ?? '').map(({ name, value }) => ({
          name,
          value: value ?? '',
        }));
      },
      setAll(cookiesToSet, headers) {
        for (const { name, value, options } of cookiesToSet) {
          context.cookies.set(name, value, {
            ...options,
            path: options.path ?? '/',
            httpOnly: true,
            secure: true,
            sameSite: 'lax',
          });
        }
        for (const [header, value] of Object.entries(headers)) responseHeaders.set(header, value);
      },
    },
  });
  return { supabase, responseHeaders };
}
