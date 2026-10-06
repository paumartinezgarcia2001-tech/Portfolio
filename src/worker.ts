/**
 * Punto de entrada del Worker (`main` en wrangler.jsonc).
 *
 * - `fetch`: la web de Astro, tal cual (el handler del adaptador de Cloudflare).
 * - `scheduled`: keep-alive de Supabase con el Cron Trigger de wrangler.jsonc
 *   (src/lib/keep-alive.ts).
 */
import { handle } from '@astrojs/cloudflare/handler';
import { keepAlive } from './lib/keep-alive';

export default {
  fetch: handle,
  async scheduled(_controller, env, ctx) {
    await keepAlive(handle, env, ctx);
  },
} satisfies ExportedHandler<Env>;
