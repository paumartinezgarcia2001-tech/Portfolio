import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/unit/**/*.test.ts'],
    environment: 'node',
    // Zona horaria fija: los tests no dependen del reloj de la máquina.
    env: { TZ: 'UTC' },
  },
});
