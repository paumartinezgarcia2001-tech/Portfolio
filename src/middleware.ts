/**
 * Middleware de la web.
 *
 * Web pública:
 * - Carga el texto de la barra de noticias y los mixes del reproductor (fase
 *   4), que viven en la columna izquierda de todas las páginas. También en
 *   los POST: el formulario de contacto sin JavaScript (fase 5) vuelve a
 *   pintar la página con los errores.
 * - Fija la caché de las secciones públicas (src/config/cache.ts), solo en
 *   GET y HEAD. Si algún dato falla, esa respuesta no se cachea.
 * - Añade las cabeceras de seguridad de §11 (src/lib/security-headers.ts) a
 *   todo lo que responde el Worker (fase 5: la CSP deja cargar Turnstile).
 *
 * Panel oculto (C19, fase 6), rutas `src/pages/[admin]/…`:
 * - si el primer tramo de la URL no es el secreto `ADMIN_PATH` → 404 de verdad
 *   (la misma página 404 que cualquier otra ruta);
 * - cliente de Supabase con la sesión de las cookies: `getClaims()` y la fila
 *   de `admins` (src/lib/admin/session.ts). Las páginas enseñan el login si no
 *   es una administradora;
 * - nunca se cachea (`no-store`), `X-Robots-Tag: noindex, nofollow`, sin
 *   Referer hacia otras webs y con su propia CSP (no usa el ClientRouter, así
 *   que puede).
 */
import { defineMiddleware } from 'astro:middleware';
import { PUBLIC_MEDIA_BASE_URL, PUBLIC_SUPABASE_URL } from 'astro:env/client';
import { ADMIN_PATH, R2_ACCOUNT_ID } from 'astro:env/server';
import { PUBLIC_CACHE } from './config/cache';
import { matchesAdminPath } from './lib/admin/access';
import { openAdminContext } from './lib/admin/context';
import { r2Endpoint } from './lib/admin/r2';
import { getPublishedMixes, getTickerText } from './lib/data';
import { buildSecurityHeaders, withSecurityHeaders } from './lib/security-headers';

/** Rutas públicas con la columna izquierda. */
const PUBLIC_SECTION_ROUTES = new Set(['/', '/next-dates', '/media', '/archive', '/contact']);

/** Rutas del panel: `src/pages/[admin]/…`. */
const ADMIN_ROUTE = /^\/\[admin\](\/|$)/;

const SECURITY_HEADERS = buildSecurityHeaders({
  mediaBaseUrl: PUBLIC_MEDIA_BASE_URL,
  supabaseUrl: PUBLIC_SUPABASE_URL,
});

const NO_STORE = { 'X-Robots-Tag': 'noindex, nofollow', 'Cache-Control': 'no-store' };

/** El panel sube los mixes al endpoint S3 de R2 (P2): hace falta en `connect-src`. */
const ADMIN_SECURITY_HEADERS = {
  ...buildSecurityHeaders({
    mediaBaseUrl: PUBLIC_MEDIA_BASE_URL,
    supabaseUrl: PUBLIC_SUPABASE_URL,
    connectSources: R2_ACCOUNT_ID ? [r2Endpoint(R2_ACCOUNT_ID)] : [],
  }),
  // Que el nombre del panel no salga en el Referer de ningún enlace a otra web.
  // (`no-referrer` no sirve: el navegador mandaría `Origin: null` en los POST
  // y la protección CSRF de Astro los rechazaría.)
  'Referrer-Policy': 'same-origin',
  ...NO_STORE,
};

export const onRequest = defineMiddleware(async (context, next) => {
  const route = context.routePattern;

  if (ADMIN_ROUTE.test(route)) {
    if (!matchesAdminPath(context.params.admin, ADMIN_PATH)) {
      // 404 de verdad: la misma página y el mismo código que cualquier otra ruta.
      return context.rewrite('/404');
    }
    if (context.cache.enabled) context.cache.set(false);
    const { supabase, state, responseHeaders } = await openAdminContext(context);
    context.locals.admin = { slug: context.params.admin!, supabase, state };
    // En `astro dev` la CSP estorbaría al servidor de Vite: solo noindex y no-store.
    const headers: Record<string, string> = import.meta.env.DEV ? { ...NO_STORE } : { ...ADMIN_SECURITY_HEADERS };
    // Cabeceras que pide @supabase/ssr al renovar la sesión (no-store…).
    responseHeaders.forEach((value, name) => {
      headers[name] = value;
    });
    return withSecurityHeaders(await next(), headers);
  }

  const isRead = context.request.method === 'GET' || context.request.method === 'HEAD';
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
  // Respuestas de las Actions del panel: nunca en caché ni en buscadores.
  const isAdminAction = context.url.pathname.startsWith('/_actions/admin.');
  return withSecurityHeaders(response, isAdminAction ? { ...SECURITY_HEADERS, ...NO_STORE } : SECURITY_HEADERS);
});
