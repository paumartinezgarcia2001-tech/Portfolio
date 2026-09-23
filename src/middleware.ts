/**
 * Middleware de la web pública.
 * - Carga el texto de la barra de noticias y los mixes del reproductor (fase
 *   4), que viven en la columna izquierda de todas las páginas. También en
 *   los POST: el formulario de contacto sin JavaScript (fase 5) vuelve a
 *   pintar la página con los errores.
 * - Fija la caché de las secciones públicas (src/config/cache.ts), solo en
 *   GET y HEAD. Si algún dato falla, esa respuesta no se cachea.
 * - Añade las cabeceras de seguridad de §11 (src/lib/security-headers.ts) a
 *   todo lo que responde el Worker (fase 5: la CSP deja cargar Turnstile).
 * La fase 6 añadirá aquí la sesión del panel.
 */
import { defineMiddleware } from 'astro:middleware';
import { PUBLIC_MEDIA_BASE_URL, PUBLIC_SUPABASE_URL } from 'astro:env/client';
import { PUBLIC_CACHE } from './config/cache';
import { getPublishedMixes, getTickerText } from './lib/data';
import { buildSecurityHeaders, withSecurityHeaders } from './lib/security-headers';

/** Rutas públicas con la columna izquierda. */
const PUBLIC_SECTION_ROUTES = new Set(['/', '/next-dates', '/media', '/archive', '/contact']);

const SECURITY_HEADERS = buildSecurityHeaders({
  mediaBaseUrl: PUBLIC_MEDIA_BASE_URL,
  supabaseUrl: PUBLIC_SUPABASE_URL,
});

export const onRequest = defineMiddleware(async (context, next) => {
  const isRead = context.request.method === 'GET' || context.request.method === 'HEAD';
  const route = context.routePattern;
  const isSection = PUBLIC_SECTION_ROUTES.has(route);

  if (isSection || route === '/404') {
    const [ticker, mixes] = await Promise.all([getTickerText(), getPublishedMixes()]);
    context.locals.tickerText = ticker.data;
    context.locals.mixes = mixes.data;
    if (isSection && isRead && context.cache.enabled) {
      if (ticker.ok && mixes.ok) context.cache.set(PUBLIC_CACHE);
      else context.cache.set(false);
    }
  }

  const response = await next();
  // Al prerenderizar no hay cabeceras que valgan (van en `_headers`), y en
  // `astro dev` la CSP estorbaría al servidor de Vite.
  if (context.isPrerendered || import.meta.env.DEV) return response;
  return withSecurityHeaders(response, SECURITY_HEADERS);
});
