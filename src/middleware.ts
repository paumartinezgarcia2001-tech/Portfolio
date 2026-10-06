/**
 * Middleware de la web.
 *
 * Web pública:
 * - Carga el texto de la barra de noticias, los colores elegidos en el panel
 *   y los mixes del reproductor, que salen en todas las páginas.
 * - Fija la caché de las secciones públicas (src/config/cache.ts), solo en
 *   GET y HEAD. Si algún dato falla, esa respuesta no se cachea.
 * - Añade las cabeceras de seguridad (src/lib/security-headers.ts) a
 *   todo lo que responde el Worker.
 *
 * Panel oculto (C19), rutas `src/pages/[admin]/…`:
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
import { ADMIN_PATH, R2_ACCOUNT_ID } from 'astro:env/server';
import { PUBLIC_CACHE } from './config/cache';
import { matchesAdminPath } from './lib/admin/access';
import { openAdminContext } from './lib/admin/context';
import { r2Endpoint } from './lib/admin/r2';
import { getLayoutData, getPublishedMixes } from './lib/data';
import { publicVar } from './lib/public-env';
import { buildSecurityHeaders, withSecurityHeaders } from './lib/security-headers';

/** Rutas públicas con la columna izquierda. */
const PUBLIC_SECTION_ROUTES = new Set(['/', '/next-dates', '/media', '/archive', '/contact']);

/** Rutas del panel: `src/pages/[admin]/…`. */
const ADMIN_ROUTE = /^\/\[admin\](\/|$)/;

/**
 * Las URL de R2 y Supabase pueden llegar al compilar o desde el Worker
 * (src/lib/public-env.ts), así que las cabeceras se montan en la primera
 * petición y se reutilizan.
 */
let securityHeaders: Record<string, string> | undefined;
function getSecurityHeaders(): Record<string, string> {
  securityHeaders ??= buildSecurityHeaders({
    mediaBaseUrl: publicVar('PUBLIC_MEDIA_BASE_URL'),
    supabaseUrl: publicVar('PUBLIC_SUPABASE_URL'),
  });
  return securityHeaders;
}

const NO_STORE = { 'X-Robots-Tag': 'noindex, nofollow', 'Cache-Control': 'no-store' };

/** El panel sube los mixes al endpoint S3 de R2: hace falta en `connect-src`. */
let adminSecurityHeaders: Record<string, string> | undefined;
function getAdminSecurityHeaders(): Record<string, string> {
  adminSecurityHeaders ??= {
    ...buildSecurityHeaders({
      mediaBaseUrl: publicVar('PUBLIC_MEDIA_BASE_URL'),
      supabaseUrl: publicVar('PUBLIC_SUPABASE_URL'),
      connectSources: R2_ACCOUNT_ID ? [r2Endpoint(R2_ACCOUNT_ID)] : [],
    }),
    // Que el nombre del panel no salga en el Referer de ningún enlace a otra web.
    // (`no-referrer` no sirve: el navegador mandaría `Origin: null` en los POST
    // y la protección CSRF de Astro los rechazaría.)
    'Referrer-Policy': 'same-origin',
    ...NO_STORE,
  };
  return adminSecurityHeaders;
}

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
    const headers: Record<string, string> = import.meta.env.DEV ? { ...NO_STORE } : { ...getAdminSecurityHeaders() };
    // Cabeceras que pide @supabase/ssr al renovar la sesión (no-store…).
    responseHeaders.forEach((value, name) => {
      headers[name] = value;
    });
    return withSecurityHeaders(await next(), headers);
  }

  const isRead = context.request.method === 'GET' || context.request.method === 'HEAD';
  const isSection = PUBLIC_SECTION_ROUTES.has(route);

  if (isSection || route === '/404') {
    const [{ ticker, theme }, mixes] = await Promise.all([getLayoutData(), getPublishedMixes()]);
    context.locals.tickerText = ticker.data;
    context.locals.theme = theme;
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
  const headers = getSecurityHeaders();
  return withSecurityHeaders(response, isAdminAction ? { ...headers, ...NO_STORE } : headers);
});
