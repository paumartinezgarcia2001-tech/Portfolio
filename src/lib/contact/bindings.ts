/**
 * Bindings de Cloudflare que usa el formulario de contacto. Solo se importa
 * desde la Action (src/actions/index.ts), que corre en el Worker.
 *
 * `CONTACT_RATE_LIMIT` es el namespace de KV del límite de envíos
 * (wrangler.jsonc). En el build estático de GitHub Pages no hay Worker:
 * astro.config.pages.mjs sustituye `cloudflare:workers` por un módulo vacío.
 */
import { env } from 'cloudflare:workers';
import type { RateLimitStore } from './rate-limit';

export function getRateLimitStore(): RateLimitStore | undefined {
  return (env as { CONTACT_RATE_LIMIT?: RateLimitStore }).CONTACT_RATE_LIMIT;
}
