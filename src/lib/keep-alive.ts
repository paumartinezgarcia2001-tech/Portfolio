/**
 * Keep-alive de Supabase (lo llama el `scheduled` de src/worker.ts).
 *
 * El plan gratuito de Supabase pausa el proyecto tras una semana sin
 * actividad. Un Cron Trigger (wrangler.jsonc) despierta el Worker cada día y
 * este pide `/api/health` —una consulta mínima a `site_settings`— a la propia
 * web, dentro del Worker: la petición no sale a internet.
 */

/** Ruta que consulta Supabase (src/pages/api/health.ts). */
export const KEEP_ALIVE_PATH = '/api/health';

export type FetchHandler<E> = (request: Request, env: E, ctx: ExecutionContext) => Promise<Response>;

/** Pide `/api/health` y falla (queda en los logs del Worker) si Supabase no responde. */
export async function keepAlive<E>(fetchHandler: FetchHandler<E>, env: E, ctx: ExecutionContext): Promise<void> {
  // El dominio da igual: la petición no sale del Worker.
  const request = new Request(new URL(KEEP_ALIVE_PATH, 'https://keep-alive.internal'), {
    headers: { 'User-Agent': 'travest15m0-keep-alive' },
  });
  const response = await fetchHandler(request, env, ctx);
  const body = await response.text();
  if (!response.ok) {
    throw new Error(`[keep-alive] Supabase no ha respondido (${response.status}): ${body.slice(0, 200)}`);
  }
  console.log(`[keep-alive] Supabase OK (${response.status})`);
}
