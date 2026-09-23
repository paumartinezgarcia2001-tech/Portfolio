// @ts-check
/**
 * Build PROVISIONAL para GitHub Pages (web estática).
 *
 * El hosting definitivo es Cloudflare Workers (astro.config.mjs; prompt
 * maestro §3 y §12). Mientras tanto, lo construido (fases 1 y 2) se publica en
 * https://paumartinezgarcia2001-tech.github.io/Portfolio/ con este archivo y
 * .github/workflows/deploy-pages.yml. Al pasar a Cloudflare se borran los dos.
 *
 * Qué cambia respecto a astro.config.mjs:
 * - `output: 'static'`, sin adaptador ni caché de Cloudflare: todo se compila
 *   a HTML. Los bolos y la barra de noticias se leen de Supabase AL COMPILAR,
 *   y el workflow recompila cada mañana para respetar el corte de las 08:00
 *   (§7.3).
 * - `base`: la web vive en la subcarpeta /Portfolio del dominio de GitHub. Las
 *   rutas internas pasan por withBase() (src/lib/url.ts) y los enlaces de los
 *   Markdown, por markdownBaseLinks() (abajo).
 * - `build.format: 'file'`: /next-dates → next-dates.html, que GitHub Pages
 *   sirve tal cual, sin redirigir a /next-dates/.
 * - DATA_STRICT: si Supabase falla, el build se detiene y sigue publicada la
 *   versión anterior, en vez de una web con las listas vacías.
 * - SITE_NOINDEX: la versión provisional no aparece en los buscadores.
 * - Sin /api/health: es un endpoint de servidor (keep-alive en Cloudflare).
 *   Aquí la propia compilación diaria mantiene despierto a Supabase.
 * - Sin Actions (fase 5): el formulario de contacto necesita servidor, así que
 *   STATIC_BUILD hace que /contact muestre «formulario — próximamente» (con
 *   las redes y el pie legal), y withoutActions() quita las Actions del build.
 *   `cloudflare:workers` (bindings del Worker) se sustituye por un módulo
 *   vacío. El panel de la fase 6 tampoco funcionará aquí.
 *
 * En local: `npm run build:pages` y `npm run preview:pages`
 * (http://localhost:4321/Portfolio/).
 */
import { rm } from 'node:fs/promises';
import sharedConfig from './astro.config.mjs';

// Valores por defecto de las variables de astro:env para este build (se
// pueden sobrescribir desde fuera, p. ej. SITE_NOINDEX=false).
process.env.DATA_STRICT ??= 'true';
process.env.SITE_NOINDEX ??= 'true';
process.env.STATIC_BUILD ??= 'true';

// El workflow pasa la dirección real que da actions/configure-pages (si algún
// día se usa un dominio propio, el base pasa a ser '' sin tocar nada).
const site = process.env.PAGES_ORIGIN || 'https://paumartinezgarcia2001-tech.github.io';
const base = process.env.PAGES_BASE_PATH ?? '/Portfolio';

// Lo que solo tiene sentido con servidor se queda fuera.
const {
  adapter: _adapter,
  cache: _cache,
  session: _session,
  security: _security,
  ...shared
} = sharedConfig;

/** @type {import('astro').AstroUserConfig} */
const config = {
  ...shared,
  site,
  base,
  output: 'static',
  build: { ...shared.build, format: 'file' },
  integrations: [...(shared.integrations ?? []), markdownBaseLinks(base), withoutServerEndpoints(), withoutActions()],
  vite: { ...shared.vite, plugins: [...(shared.vite?.plugins ?? []), cloudflareWorkersStub()] },
};

export default config;

/**
 * Añade el `base` a los enlaces internos de los Markdown (src/content/*.md):
 * `[contact](/contact)` → `/Portfolio/contact`. Es un plugin de HAST para
 * Sätteri, el procesador de Markdown por defecto de Astro 7.
 * @param {string} base
 * @returns {import('astro').AstroIntegration}
 */
function markdownBaseLinks(base) {
  const prefix = base.replace(/\/+$/, '');
  const plugin = {
    name: 'base-links',
    element: {
      filter: ['a'],
      /** @param {any} node @param {any} ctx */
      visit(node, ctx) {
        const href = node.properties?.href;
        const internal = typeof href === 'string' && href.startsWith('/') && !href.startsWith('//');
        if (internal && href !== prefix && !href.startsWith(`${prefix}/`)) {
          ctx.setProperty(node, 'href', `${prefix}${href}`);
        }
      },
    },
  };
  return {
    name: 'github-pages:markdown-base-links',
    hooks: {
      'astro:config:setup': ({ config, logger }) => {
        if (!prefix) return;
        const processor = /** @type {any} */ (config.markdown).processor;
        if (processor?.name === 'satteri') {
          processor.options.hastPlugins.push(plugin);
        } else {
          logger.warn(`Procesador de Markdown «${processor?.name}»: los enlaces internos de los .md no llevarán ${prefix}.`);
        }
      },
    },
  };
}

/**
 * Borra de la salida los endpoints de servidor (src/pages/api/), que en una
 * web estática quedarían como archivos sueltos sin sentido.
 * @returns {import('astro').AstroIntegration}
 */
function withoutServerEndpoints() {
  return {
    name: 'github-pages:without-server-endpoints',
    hooks: {
      'astro:build:done': async ({ dir, logger }) => {
        await rm(new URL('api/', dir), { recursive: true, force: true });
        logger.info('Quitado /api (solo tiene sentido con servidor).');
      },
    },
  };
}

/**
 * Quita las Actions (src/actions/, fase 5) de este build: Astro no deja
 * compilar una web estática sin adaptador si hay Actions, y aquí no hay
 * servidor que las atienda. La integración `astro:actions` la añade Astro al
 * final de la lista, así que esta se ejecuta antes y la saca.
 * @returns {import('astro').AstroIntegration}
 */
function withoutActions() {
  return {
    name: 'github-pages:without-actions',
    hooks: {
      'astro:config:setup': ({ config, logger }) => {
        const index = config.integrations.findIndex((integration) => integration.name === 'astro:actions');
        if (index === -1) return;
        config.integrations.splice(index, 1);
        logger.info('Sin Actions: el formulario de contacto necesita servidor (Cloudflare).');
      },
    },
  };
}

/**
 * `cloudflare:workers` solo existe dentro del Worker. En este build (Node) se
 * sustituye por un módulo con `env` vacío: sin bindings, el formulario no se
 * usa aquí.
 * @returns {import('vite').Plugin}
 */
function cloudflareWorkersStub() {
  const id = '\0github-pages:cloudflare-workers';
  return {
    name: 'github-pages:cloudflare-workers-stub',
    enforce: 'pre',
    resolveId: (source) => (source === 'cloudflare:workers' ? id : undefined),
    load: (source) => (source === id ? 'export const env = {};' : undefined),
  };
}
