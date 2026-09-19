import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          include: ['tests/unit/**/*.test.ts'],
          environment: 'node',
          // Zona horaria fija: los tests no dependen del reloj de la máquina.
          env: { TZ: 'UTC' },
        },
      },
      // Componentes .astro renderizados con la API de contenedor de Astro.
      './vitest.components.config.ts',
    ],
  },
});
