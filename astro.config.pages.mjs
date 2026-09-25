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
 * - Sin Actions (fase 5): withoutActions() las quita del build y
 *   `cloudflare:workers` (bindings del Worker) se sustituye por un módulo
 *   vacío. El formulario de contacto sigue funcionando: con STATIC_BUILD envía
 *   a la API de Web3Forms en vez de a la Action (D58, ver
 *   src/lib/contact/web3forms.ts). Necesita PUBLIC_WEB3FORMS_KEY; sin esa
 *   clave, /contact muestra «formulario — próximamente».
 * - Sin panel (fase 6): sus páginas (src/pages/[admin]/) necesitan servidor.
 *   withoutAdminPanel() las compila como estáticas sin ninguna ruta, así que
 *   no generan nada.
 *
 * En local: `npm run build:pages` y `npm run preview:pages`
 * (http://localhost:4321/Portfolio/).
 */
import { readFile, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
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
  integrations: [...(shared.integrations ?? []), markdownBaseLinks(base), withoutServerEndpoints(), withoutActions(), withoutAdminPanel()],
  vite: { ...shared.vite, plugins: [...(shared.vite?.plugins ?? []), cloudflareWorkersStub(), adminPagesWithoutPaths()] },
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

/** Páginas del panel oculto (fase 6): src/pages/[admin]/… */
const ADMIN_PAGES_DIR = /[\\/]src[\\/]pages[\\/]\[admin\][\\/]/;

/**
 * El panel (fase 6) solo funciona con servidor. En una web estática sin
 * adaptador, Astro no deja compilar páginas bajo demanda, así que aquí se
 * marcan como prerenderizadas y (con adminPagesWithoutPaths) sin ninguna ruta
 * que generar: no sale ningún archivo del panel en la web de GitHub Pages.
 * @returns {import('astro').AstroIntegration}
 */
function withoutAdminPanel() {
  return {
    name: 'github-pages:without-admin-panel',
    hooks: {
      'astro:route:setup': ({ route }) => {
        if (ADMIN_PAGES_DIR.test(`/${route.component}`)) route.prerender = true;
      },
      // Vite compila igualmente el script y los estilos del panel, aunque
      // ninguna página los use: se borran los archivos de _astro/ a los que no
      // apunta nada, para que la web estática no lleve ni rastro del panel.
      'astro:build:done': async ({ dir, logger }) => {
        const removed = await removeUnreferencedAssets(dir);
        if (removed.length > 0) logger.info(`Quitados ${removed.length} archivos sin usar (panel): ${removed.join(', ')}`);
      },
    },
  };
}

/**
 * Borra de `_astro/` los archivos que no nombra ningún otro archivo de la
 * salida (HTML, JS o CSS), hasta que no queda ninguno.
 * @param {URL} dir
 * @returns {Promise<string[]>}
 */
async function removeUnreferencedAssets(dir) {
  const root = fileURLToPath(dir);
  const assetsDir = path.join(root, '_astro');
  /** @type {string[]} */
  const removed = [];
  const walk = async (/** @type {string} */ folder) => {
    const entries = await readdir(folder, { withFileTypes: true });
    /** @type {string[]} */
    const files = [];
    for (const entry of entries) {
      const full = path.join(folder, entry.name);
      if (entry.isDirectory()) files.push(...(await walk(full)));
      else if (/\.(html|js|mjs|css|json|xml|txt)$/.test(entry.name)) files.push(full);
    }
    return files;
  };
  for (;;) {
    const texts = new Map();
    for (const file of await walk(root)) texts.set(file, await readFile(file, 'utf8'));
    const assets = (await readdir(assetsDir).catch(() => [])).filter((name) => /\.(js|css)$/.test(name));
    const unused = assets.filter((name) => {
      const full = path.join(assetsDir, name);
      for (const [file, text] of texts) if (file !== full && text.includes(name)) return false;
      return true;
    });
    if (unused.length === 0) return removed;
    for (const name of unused) {
      await rm(path.join(assetsDir, name));
      removed.push(name);
    }
  }
}

/**
 * Añade `getStaticPaths()` vacío a las páginas del panel en este build (ver
 * withoutAdminPanel): una ruta dinámica prerenderizada lo necesita.
 * @returns {import('vite').Plugin}
 */
function adminPagesWithoutPaths() {
  return {
    name: 'github-pages:admin-pages-without-paths',
    enforce: 'post',
    transform(code, id) {
      if (!ADMIN_PAGES_DIR.test(id) || !id.endsWith('.astro')) return undefined;
      return { code: `${code}\nexport const getStaticPaths = () => [];\n`, map: null };
    },
  };
}
