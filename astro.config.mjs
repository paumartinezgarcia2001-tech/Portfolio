// @ts-check
import { defineConfig, envField } from 'astro/config';
import cloudflare from '@astrojs/cloudflare';
import { cacheCloudflare } from '@astrojs/cloudflare/cache';

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
      PUBLIC_SITE_URL: envField.string({ context: 'client', access: 'public', optional: true, url: true }),
      PUBLIC_SUPABASE_URL: envField.string({ context: 'client', access: 'public', optional: true, url: true }),
      PUBLIC_SUPABASE_PUBLISHABLE_KEY: envField.string({ context: 'client', access: 'public', optional: true }),
      PUBLIC_MEDIA_BASE_URL: envField.string({ context: 'client', access: 'public', optional: true, url: true }),
      PUBLIC_TURNSTILE_SITE_KEY: envField.string({ context: 'client', access: 'public', optional: true }),
      // --- Secretas (solo servidor; secrets de Cloudflare) ---
      ADMIN_PATH: envField.string({ context: 'server', access: 'secret', optional: true }),
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
