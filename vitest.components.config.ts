import { fileURLToPath } from 'node:url';
import { getViteConfig } from 'astro/config';

/**
 * Componentes .astro renderizados a HTML con la API de contenedor de Astro
 * (`experimental_AstroContainer`), sin navegador. Lo incluye `npm test`
 * (vitest.config.ts).
 */
export default getViteConfig({
  resolve: {
    // Solo existe dentro del Worker (src/lib/public-env.ts lo importa).
    alias: { 'cloudflare:workers': fileURLToPath(new URL('./tests/stubs/cloudflare-workers.ts', import.meta.url)) },
  },
  test: {
    name: 'components',
    include: ['tests/components/**/*.test.ts'],
    environment: 'node',
    env: { TZ: 'UTC' },
  },
});
