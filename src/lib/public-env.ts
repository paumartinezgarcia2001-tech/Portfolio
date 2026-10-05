/**
 * Variables `PUBLIC_*` con respaldo en tiempo de ejecución (fase 7).
 *
 * `astro:env/client` escribe estas variables en el código **al compilar**: en
 * Cloudflare tienen que estar en *Settings → Build → Variables and secrets*
 * del Worker antes del build. Si alguien las pone solo en *Settings →
 * Variables and Secrets* (las de ejecución), la web compilaba sin ellas y
 * salía sin datos aunque el panel de Cloudflare las mostrara.
 *
 * Aquí se aceptan los dos sitios: manda el valor del build y, si no lo hay,
 * se lee el del Worker en cada petición (`cloudflare:workers`). Solo para
 * código de servidor; en el build estático de GitHub Pages `env` está vacío
 * (astro.config.pages.mjs) y se queda el valor del build.
 */
import {
  PUBLIC_MEDIA_BASE_URL,
  PUBLIC_SITE_URL,
  PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  PUBLIC_SUPABASE_URL,
  PUBLIC_TURNSTILE_SITE_KEY,
} from 'astro:env/client';
import { env } from 'cloudflare:workers';
import { normalizeUrlVar, readWorkerVar } from './env-values';

const BUILD_VALUES = {
  PUBLIC_SITE_URL,
  PUBLIC_SUPABASE_URL,
  PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  PUBLIC_MEDIA_BASE_URL,
  PUBLIC_TURNSTILE_SITE_KEY,
} as const;

export type PublicVarName = keyof typeof BUILD_VALUES;

/** Las que tienen que ser una URL (astro:env lo comprueba al compilar; aquí, al leerlas). */
const URL_VARS: ReadonlySet<PublicVarName> = new Set(['PUBLIC_SITE_URL', 'PUBLIC_SUPABASE_URL', 'PUBLIC_MEDIA_BASE_URL']);

/** Valor de una variable `PUBLIC_*`: el del build o, si falta, el del Worker. */
export function publicVar(name: PublicVarName): string | undefined {
  const built = BUILD_VALUES[name];
  if (built) return built;
  let runtime: unknown;
  try {
    runtime = env;
  } catch {
    runtime = undefined;
  }
  const value = readWorkerVar(runtime, name);
  return URL_VARS.has(name) ? normalizeUrlVar(name, value) : value;
}
