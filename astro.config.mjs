// @ts-check
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { defineConfig, envField } from 'astro/config';
import cloudflare from '@astrojs/cloudflare';
import { cacheCloudflare } from '@astrojs/cloudflare/cache';
import { loadEnv } from 'vite';
import { buildHeadersFileBlock, buildSecurityHeaders } from './src/lib/security-headers.ts';

// Dominio público (Q03, pendiente). Workers Builds lo pasa como variable de
// entorno al compilar; en local se puede dejar vacío.
const site = process.env.PUBLIC_SITE_URL || undefined;

export default defineConfig({
  site,
  output: 'server',
  adapter: cloudflare({
    // Sin transformación de imágenes: la web no usa astro:assets y así no
    // hace falta el binding de Cloudflare Images.
    imageService: 'passthrough',
  }),
  // Sin sesiones de Astro: el panel (fase 6) usa las cookies de Supabase.
  // Evita tener que crear un KV «SESSION» en Cloudflare.
  session: false,
  prefetch: {
    prefetchAll: true,
    defaultStrategy: 'hover',
  },
  security: {
    // Protección CSRF para formularios y Actions (fases 5 y 6).
    checkOrigin: true,
    // La CSP de Astro (`csp`) no es compatible con el ClientRouter: la CSP y
    // el resto de cabeceras de §11 las pone src/middleware.ts (y `_headers`,
    // abajo, para los archivos estáticos).
  },
  integrations: [staticSecurityHeaders()],
  vite: {
    build: {
      // Los scripts nunca van en línea: así la CSP puede ser `script-src 'self'`
      // sin 'unsafe-inline' ni hashes por página (§11). Los estilos y las
      // imágenes pequeñas siguen incrustándose (el límite normal de 4 kB).
      assetsInlineLimit: (filePath) => (/\.m?js$/.test(filePath) ? false : undefined),
    },
  },
  // Caché de rutas de Astro 7 en la red de Cloudflare (§6). Las páginas
  // públicas fijan su duración y etiquetas en src/middleware.ts; el panel
  // (fase 6) purga por etiqueta al guardar.
  cache: {
    provider: cacheCloudflare(),
  },
  env: {
    schema: {
      // --- Públicas ---
      // `fixtures` sirve datos de prueba sin Supabase (tests e2e). Se fija al compilar.
      DATA_SOURCE: envField.enum({
        context: 'server',
        access: 'public',
        values: ['supabase', 'fixtures'],
        default: 'supabase',
      }),
      // `true` = si una consulta a Supabase falla al compilar, el build se
      // detiene en vez de publicar listas vacías. Lo activa el build estático
      // provisional (astro.config.pages.mjs). Se fija al compilar.
      DATA_STRICT: envField.boolean({ context: 'server', access: 'public', default: false }),
      // `true` = noindex en todas las páginas (despliegue provisional en
      // GitHub Pages, astro.config.pages.mjs). Se fija al compilar.
      SITE_NOINDEX: envField.boolean({ context: 'server', access: 'public', default: false }),
      // `true` = web estática sin servidor (GitHub Pages, astro.config.pages.mjs):
      // no hay Actions, así que /contact no muestra el formulario. Se fija al compilar.
      STATIC_BUILD: envField.boolean({ context: 'server', access: 'public', default: false }),
      // Solo para los tests e2e (fase 5): servidores que simulan Turnstile y
      // Resend (tests/e2e/mock-services.mjs). En producción, vacías: se usan
      // las APIs de verdad. Se fijan al compilar.
      TURNSTILE_VERIFY_URL: envField.string({ context: 'server', access: 'public', optional: true, url: true }),
      RESEND_API_URL: envField.string({ context: 'server', access: 'public', optional: true, url: true }),
      PUBLIC_SITE_URL: envField.string({ context: 'client', access: 'public', optional: true, url: true }),
      PUBLIC_SUPABASE_URL: envField.string({ context: 'client', access: 'public', optional: true, url: true }),
      PUBLIC_SUPABASE_PUBLISHABLE_KEY: envField.string({ context: 'client', access: 'public', optional: true }),
      PUBLIC_MEDIA_BASE_URL: envField.string({ context: 'client', access: 'public', optional: true, url: true }),
      PUBLIC_TURNSTILE_SITE_KEY: envField.string({ context: 'client', access: 'public', optional: true }),
      // --- Secretas (solo servidor; secrets de Cloudflare) ---
      ADMIN_PATH: envField.string({ context: 'server', access: 'secret', optional: true }),
      // Alias para entrar en el panel sin escribir el email (fase 6, opcional):
      // ADMIN_USERNAME → ADMIN_EMAIL (la cuenta de Supabase Auth). Solo servidor.
      ADMIN_USERNAME: envField.string({ context: 'server', access: 'secret', optional: true }),
      ADMIN_EMAIL: envField.string({ context: 'server', access: 'secret', optional: true }),
      RESEND_API_KEY: envField.string({ context: 'server', access: 'secret', optional: true }),
      CONTACT_TO_EMAIL: envField.string({ context: 'server', access: 'secret', optional: true }),
      CONTACT_FROM_EMAIL: envField.string({ context: 'server', access: 'secret', optional: true }),
      TURNSTILE_SECRET_KEY: envField.string({ context: 'server', access: 'secret', optional: true }),
      R2_ACCOUNT_ID: envField.string({ context: 'server', access: 'secret', optional: true }),
      R2_ACCESS_KEY_ID: envField.string({ context: 'server', access: 'secret', optional: true }),
      R2_SECRET_ACCESS_KEY: envField.string({ context: 'server', access: 'secret', optional: true }),
      R2_BUCKET: envField.string({ context: 'server', access: 'secret', optional: true }),
      // SUPABASE_SECRET_KEY no va aquí: solo la usan los scripts locales.
    },
  },
});

/**
 * Cabeceras de seguridad (§11) para los archivos estáticos: páginas
 * prerenderizadas (aviso legal, privacidad) y assets. Cloudflare no pasa esas
 * peticiones por el Worker, así que no las toca src/middleware.ts: se añade
 * al principio de `dist/client/_headers` un bloque `/*` con las mismas
 * cabeceras (src/lib/security-headers.ts). Solo en el build de Cloudflare.
 * @returns {import('astro').AstroIntegration}
 */
function staticSecurityHeaders() {
  /** @type {URL | undefined} */
  let root;
  let serverBuild = false;
  return {
    name: 'travest15m0:static-security-headers',
    hooks: {
      'astro:config:done': ({ config }) => {
        root = config.root;
        serverBuild = config.output === 'server' && Boolean(config.adapter);
      },
      'astro:build:done': async ({ dir, logger }) => {
        if (!serverBuild || !root) return;
        // Los mismos valores que astro:env (.env + variables del entorno).
        const fileEnv = loadEnv('production', fileURLToPath(root), 'PUBLIC_');
        const headers = buildSecurityHeaders({
          mediaBaseUrl: process.env.PUBLIC_MEDIA_BASE_URL ?? fileEnv.PUBLIC_MEDIA_BASE_URL,
          supabaseUrl: process.env.PUBLIC_SUPABASE_URL ?? fileEnv.PUBLIC_SUPABASE_URL,
        });
        const file = new URL('./_headers', dir);
        const current = await readFile(file, 'utf8').catch(() => '');
        if (current.includes('Content-Security-Policy:')) {
          logger.info('_headers ya trae una CSP: no se añade la de §11.');
          return;
        }
        await writeFile(file, `${buildHeadersFileBlock(headers)}${current ? `\n${current}` : ''}`);
        logger.info('Cabeceras de seguridad (§11) añadidas a _headers para los archivos estáticos.');
      },
    },
  };
}
