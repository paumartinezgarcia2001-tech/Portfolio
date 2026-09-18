/**
 * Rutas internas y `base` de Astro.
 *
 * En Cloudflare (hosting definitivo) la web vive en la raíz del dominio y el
 * `base` es «/», así que estas funciones no cambian nada. En el despliegue
 * provisional de GitHub Pages vive en https://<usuario>.github.io/Portfolio/
 * (astro.config.pages.mjs) y las rutas internas llevan delante «/Portfolio».
 *
 * Todo `href` o `src` interno que empiece por «/» pasa por `withBase()`.
 */

/** `base` sin barra final: '' en la raíz, '/Portfolio' en GitHub Pages. */
export const BASE_PATH = normalizeBase(import.meta.env.BASE_URL);

export function normalizeBase(base: string | undefined): string {
  return (base ?? '').replace(/\/+$/, '');
}

/**
 * `joinBase('/Portfolio', '/next-dates')` → `/Portfolio/next-dates`;
 * `joinBase('/Portfolio', '/')` → `/Portfolio/`. Lo externo (`https://…`,
 * `//…`), lo relativo y los anclas (`#…`) no se tocan.
 */
export function joinBase(base: string, path: string): string {
  const prefix = normalizeBase(base);
  if (!prefix || !path.startsWith('/') || path.startsWith('//')) return path;
  if (path === prefix || path.startsWith(`${prefix}/`)) return path;
  return `${prefix}${path}`;
}

/** `joinBase('/Portfolio', '/Portfolio/next-dates')` al revés → `/next-dates`. */
export function stripBase(base: string, pathname: string): string {
  const prefix = normalizeBase(base);
  if (!prefix) return pathname;
  if (pathname === prefix) return '/';
  return pathname.startsWith(`${prefix}/`) ? pathname.slice(prefix.length) : pathname;
}

/**
 * Ruta «limpia» para canonical y og:url. Con `build.format: 'file'` (GitHub
 * Pages) `Astro.url.pathname` acaba en `.html`: `/Portfolio/index.html` →
 * `/Portfolio/`, `/Portfolio/next-dates.html` → `/Portfolio/next-dates`.
 */
export function cleanPathname(pathname: string): string {
  return pathname.replace(/\/index\.html$/, '/').replace(/\.html$/, '');
}

/** Ruta interna con el `base` de esta compilación. */
export function withBase(path: string): string {
  return joinBase(BASE_PATH, path);
}

/** Ruta sin el `base` de esta compilación. */
export function withoutBase(pathname: string): string {
  return stripBase(BASE_PATH, pathname);
}
