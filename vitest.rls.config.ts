import { loadEnv } from 'vite';
import { defineConfig } from 'vitest/config';

/**
 * Tests de RLS contra el Supabase real (fase 2). Necesitan `.env` con
 * PUBLIC_SUPABASE_URL y PUBLIC_SUPABASE_PUBLISHABLE_KEY; sin eso, se saltan.
 */
export default defineConfig({
  test: {
    include: ['tests/rls/**/*.test.ts'],
    environment: 'node',
    env: loadEnv('test', process.cwd(), ''),
  },
});
