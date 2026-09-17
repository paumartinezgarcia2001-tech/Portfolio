/**
 * GET /api/health — keep-alive (§12): una consulta mínima a Supabase para que
 * el proyecto gratuito no se pause. Nunca se cachea.
 */
import type { APIRoute } from 'astro';
import { checkDatabase } from '../../lib/data';

export const GET: APIRoute = async (context) => {
  if (context.cache.enabled) context.cache.set(false);
  const { ok } = await checkDatabase();
  return new Response(JSON.stringify({ ok, time: new Date().toISOString() }), {
    status: ok ? 200 : 503,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Robots-Tag': 'noindex',
    },
  });
};
