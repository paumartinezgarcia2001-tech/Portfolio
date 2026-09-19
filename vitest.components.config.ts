import { getViteConfig } from 'astro/config';

/**
 * Componentes .astro renderizados a HTML con la API de contenedor de Astro
 * (`experimental_AstroContainer`), sin navegador. Lo incluye `npm test`
 * (vitest.config.ts).
 */
export default getViteConfig({
  test: {
    name: 'components',
    include: ['tests/components/**/*.test.ts'],
    environment: 'node',
    env: { TZ: 'UTC' },
  },
});
