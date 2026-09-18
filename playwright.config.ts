import { defineConfig, devices, type PlaywrightTestProject } from '@playwright/test';

/**
 * E2E con Playwright.
 * - Por defecto: Chromium en escritorio (1440×900) y móvil (375×812).
 * - `PW_ALL_BROWSERS=1`: añade Firefox y WebKit (instálalos antes con
 *   `npx playwright install`).
 * - `PW_CHROMIUM_EXECUTABLE=/ruta/a/chrome`: usa un Chromium ya instalado.
 * - `E2E_BASE_URL=https://…`: prueba contra un servidor que ya esté en marcha
 *   (por ejemplo, un preview de Cloudflare) en lugar de levantar uno.
 *
 * La web se compila con `DATA_SOURCE=fixtures`: los bolos salen de
 * `src/lib/data/fixtures.ts`, así que los tests no dependen de Supabase.
 * Ojo: esa compilación deja `dist/` con datos de prueba; vuelve a compilar
 * con `npm run build` antes de un `npm run preview` normal.
 *
 * Media (fase 3): `tests/e2e/global-setup.ts` genera un vídeo de prueba con
 * ffmpeg en `.media/` y `scripts/serve-media.mjs` lo sirve en el puerto 4322
 * como si fuera R2. Sin ffmpeg, esos tests se saltan.
 */

const PORT = Number(process.env.E2E_PORT ?? 4321);
const MEDIA_PORT = Number(process.env.E2E_MEDIA_PORT ?? 4322);
const mediaBaseURL = `http://localhost:${MEDIA_PORT}`;
const externalBaseURL = process.env.E2E_BASE_URL;
const baseURL = externalBaseURL ?? `http://localhost:${PORT}`;
const chromiumExecutable = process.env.PW_CHROMIUM_EXECUTABLE || undefined;
const allBrowsers = process.env.PW_ALL_BROWSERS === '1';

const DESKTOP_VIEWPORT = { width: 1440, height: 900 };
const MOBILE_VIEWPORT = { width: 375, height: 812 };

const chromiumLaunch = chromiumExecutable ? { launchOptions: { executablePath: chromiumExecutable } } : {};

const projects: PlaywrightTestProject[] = [
  {
    name: 'chromium-desktop',
    use: { ...devices['Desktop Chrome'], ...chromiumLaunch, viewport: DESKTOP_VIEWPORT },
  },
  {
    name: 'chromium-mobile',
    use: {
      ...devices['Desktop Chrome'],
      ...chromiumLaunch,
      viewport: MOBILE_VIEWPORT,
      deviceScaleFactor: 2,
      isMobile: true,
      hasTouch: true,
    },
  },
];

if (allBrowsers) {
  projects.push(
    { name: 'firefox-desktop', use: { ...devices['Desktop Firefox'], viewport: DESKTOP_VIEWPORT } },
    // Firefox no admite `isMobile`: basta con el ancho para la vista móvil.
    { name: 'firefox-mobile', use: { ...devices['Desktop Firefox'], viewport: MOBILE_VIEWPORT, hasTouch: true } },
    { name: 'webkit-desktop', use: { ...devices['Desktop Safari'], viewport: DESKTOP_VIEWPORT } },
    {
      name: 'webkit-mobile',
      use: { ...devices['iPhone 13 Mini'], viewport: MOBILE_VIEWPORT },
    },
  );
}

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  timeout: 30_000,
  expect: { timeout: 5_000 },
  globalSetup: './tests/e2e/global-setup.ts',
  use: {
    baseURL,
    locale: 'es-ES',
    timezoneId: 'Europe/Madrid',
    trace: 'retain-on-failure',
  },
  projects,
  webServer: externalBaseURL
    ? undefined
    : [
        {
          // `--ignore-lock`: Astro 7 lanza el preview en segundo plano si detecta un
          // agente (p. ej. una sesión de Claude) y Playwright lo daría por caído.
          command: `npm run build && npx astro preview --port ${PORT} --ignore-lock`,
          url: baseURL,
          reuseExistingServer: !process.env.CI,
          timeout: 180_000,
          env: { DATA_SOURCE: 'fixtures', PUBLIC_MEDIA_BASE_URL: mediaBaseURL },
        },
        {
          // Hace de R2 para el vídeo de prueba (CORS, Range y Content-Type).
          command: `node scripts/serve-media.mjs --port ${MEDIA_PORT}`,
          url: `${mediaBaseURL}/`,
          reuseExistingServer: !process.env.CI,
          timeout: 30_000,
        },
      ],
});
