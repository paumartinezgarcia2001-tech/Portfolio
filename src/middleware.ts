/**
 * Middleware de la web pública (fase 2).
 * - Carga el texto de la barra de noticias y los mixes del reproductor (fase
 *   4), que viven en la columna izquierda de todas las páginas.
 * - Fija la caché de las secciones públicas (src/config/cache.ts). Si algún
 *   dato falla, esa respuesta no se cachea.
 * La fase 6 añadirá aquí la sesión del panel y las cabeceras de seguridad.
 */
import { defineMiddleware } from 'astro:middleware';
import { PUBLIC_CACHE } from './config/cache';
import { getPublishedMixes, getTickerText } from './lib/data';

/** Rutas públicas con la columna izquierda. */
const PUBLIC_SECTION_ROUTES = new Set(['/', '/next-dates', '/media', '/archive', '/contact']);

export const onRequest = defineMiddleware(async (context, next) => {
  const isRead = context.request.method === 'GET' || context.request.method === 'HEAD';
  const route = context.routePattern;
  const isSection = isRead && PUBLIC_SECTION_ROUTES.has(route);

  if (isSection || route === '/404') {
    const [ticker, mixes] = await Promise.all([getTickerText(), getPublishedMixes()]);
    context.locals.tickerText = ticker.data;
    context.locals.mixes = mixes.data;
    if (isSection && context.cache.enabled) {
      if (ticker.ok && mixes.ok) context.cache.set(PUBLIC_CACHE);
      else context.cache.set(false);
    }
  }

  return next();
});
