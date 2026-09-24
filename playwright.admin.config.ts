import { defineConfig, devices } from '@playwright/test';

/**
 * E2E del panel oculto (C19, fase 6): `npm run test:e2e:admin`.
 *
 * Va aparte de playwright.config.ts porque necesita otra compilación: la web
 * lee de Supabase (DATA_SOURCE=supabase) para comprobar que lo que se guarda
 * en el panel aparece en la web pública. Supabase está simulado
 * (tests/e2e-admin/mock-supabase.mjs, puerto 4324) con las mismas reglas que
 * las políticas RLS; Turnstile se simula en el navegador como en contacto.
 *
 * - El nombre del panel en los tests es `E2E_ADMIN_PATH` (por defecto
 *   `panel-e2e`): el de verdad no se escribe en ningún archivo del repo.
 * - Un solo worker: todos los tests comparten el Supabase simulado, que se
 *   reinicia antes de cada uno.
 * - Compila en `dist/` como los otros e2e: no ejecutes los dos a la vez.
 */

const PORT = Number(process.env.E2E_ADMIN_PORT ?? 4331);
const SUPABASE_PORT = Number(process.env.E2E_SUPABASE_PORT ?? 4324);
const baseURL = `http://localhost:${PORT}`;
const supabaseURL = `http://127.0.0.1:${SUPABASE_PORT}`;
const chromiumExecutable = process.env.PW_CHROMIUM_EXECUTABLE || undefined;
process.env.E2E_ADMIN_PATH ??= 'panel-e2e';

// `--lang`: los campos de fecha salen en formato español (dd/mm/aaaa), como en el móvil de Pau.
const launch = {
  launchOptions: { args: ['--lang=es-ES'], ...(chromiumExecutable ? { executablePath: chromiumExecutable } : {}) },
};

export default defineConfig({
  testDir: './tests/e2e-admin',
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never', outputFolder: 'playwright-report-admin' }]] : 'list',
  timeout: 45_000,
  expect: { timeout: 7_000 },
  use: {
    baseURL,
    locale: 'es-ES',
    timezoneId: 'Europe/Madrid',
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'admin-desktop', use: { ...devices['Desktop Chrome'], ...launch, viewport: { width: 1280, height: 900 } } },
    {
      name: 'admin-mobile',
      use: {
        ...devices['Desktop Chrome'],
        ...launch,
        viewport: { width: 375, height: 812 },
        deviceScaleFactor: 2,
        isMobile: true,
        hasTouch: true,
      },
    },
  ],
  webServer: [
    {
      command: `node tests/e2e-admin/mock-supabase.mjs --port ${SUPABASE_PORT}`,
      url: `${supabaseURL}/__e2e/health`,
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
    },
    {
      command: `npm run build && node tests/e2e-admin/dev-vars.mjs && npx astro preview --port ${PORT} --ignore-lock`,
      url: `${baseURL}/next-dates`,
      reuseExistingServer: !process.env.CI,
      timeout: 180_000,
      env: {
        DATA_SOURCE: 'supabase',
        PUBLIC_SUPABASE_URL: supabaseURL,
        PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_e2e_0000000000000000',
        PUBLIC_TURNSTILE_SITE_KEY: '1x00000000000000000000AA',
        PUBLIC_MEDIA_BASE_URL: 'http://localhost:4322',
      },
    },
  ],
});
