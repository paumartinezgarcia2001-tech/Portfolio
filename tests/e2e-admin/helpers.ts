import { test as base, expect, type APIRequestContext, type Page } from '@playwright/test';

/**
 * Ayudas de los e2e del panel. Ver playwright.admin.config.ts.
 */

export const ADMIN_PATH = process.env.E2E_ADMIN_PATH ?? 'panel-e2e';
export const SUPABASE_URL = `http://127.0.0.1:${process.env.E2E_SUPABASE_PORT ?? 4324}`;

export const PAU = { email: 'pau@e2e.test', alias: 'pau', password: 'contraseña-e2e-123' };
export const INTRUDER = { email: 'intrusa@e2e.test', password: 'contraseña-e2e-456' };
export const R2_URL = `http://127.0.0.1:${process.env.E2E_R2_PORT ?? 4325}`;

export interface R2State {
  objects: Record<string, { size: number; type: string; head: string | null }>;
  log: Array<{ method: string; key: string; type?: string; size?: number; signedHeaders?: string }>;
}

/** R2 simulado como al principio (un vídeo y un mix: 450 MB). */
export async function resetR2(request: APIRequestContext): Promise<void> {
  expect((await request.post(`${R2_URL}/__r2/reset`)).ok()).toBe(true);
}

/** Añade un objeto «virtual» de `bytes` (para probar el límite sin escribir nada). */
export async function fillR2(request: APIRequestContext, bytes: number): Promise<void> {
  expect((await request.post(`${R2_URL}/__r2/fill?bytes=${bytes}`)).ok()).toBe(true);
}

export async function r2State(request: APIRequestContext): Promise<R2State> {
  return (await (await request.get(`${R2_URL}/__r2/state`)).json()) as R2State;
}

let ipCounter = 0;

/**
 * `test` de los e2e del panel: cada test entra desde una IP distinta
 * (`CF-Connecting-IP`, que el preview local respeta), para que el límite de
 * 5 intentos de login por minuto y por IP (src/lib/admin/login-guard.ts) no
 * se pise entre tests. El test que prueba el límite fija la suya.
 */
export const test = base.extend<{ clientIp: string }>({
  clientIp: [
    async ({ context }, use, testInfo) => {
      ipCounter += 1;
      const ip = `10.${testInfo.workerIndex % 250}.${Math.floor(ipCounter / 250) % 250}.${(ipCounter % 250) + 1}`;
      await context.setExtraHTTPHeaders({ 'CF-Connecting-IP': ip });
      await use(ip);
    },
    { auto: true },
  ],
});

export function adminUrl(path = ''): string {
  return path ? `/${ADMIN_PATH}/${path.replace(/^\/+/, '')}` : `/${ADMIN_PATH}`;
}

/** Vuelve a dejar el Supabase simulado como al principio. */
export async function resetSupabase(request: APIRequestContext): Promise<void> {
  const response = await request.post(`${SUPABASE_URL}/__e2e/reset`);
  expect(response.ok()).toBe(true);
  // Y R2, que el panel mide en todas las páginas (D64).
  await resetR2(request);
}

export interface MockState {
  tables: {
    gigs: Array<Record<string, unknown> & { id: string; event_date: string; party_name: string | null; venue: string }>;
    site_settings: Array<Record<string, unknown>>;
    mixes: Array<Record<string, unknown> & { id: string; title: string; audio_url: string }>;
  };
}

export async function mockState(request: APIRequestContext): Promise<MockState> {
  const response = await request.get(`${SUPABASE_URL}/__e2e/state`);
  return (await response.json()) as MockState;
}

/** Abre el panel y entra con usuario (email o alias) y contraseña. */
export async function signIn(page: Page, user: { email: string; password: string } = PAU, path = ''): Promise<void> {
  await page.goto(adminUrl(path));
  await waitReady(page);
  await page.getByLabel('usuario').fill(user.email);
  await page.getByLabel('contraseña').fill(user.password);
  await page.getByRole('button', { name: 'entrar' }).click();
}

export async function signInAsPau(page: Page, path = ''): Promise<void> {
  await signIn(page, PAU, path);
  await expect(page.getByRole('button', { name: 'cerrar sesión' })).toBeVisible();
  await waitReady(page);
}

/** Espera a que el script del panel esté listo (antes, los formularios no hacen nada útil). */
export async function waitReady(page: Page): Promise<void> {
  await expect(page.locator('html')).toHaveAttribute('data-admin-ready', '');
}

/** Abre una página del panel y espera a su script. */
export async function openAdmin(page: Page, path = ''): Promise<void> {
  await page.goto(adminUrl(path));
  await waitReady(page);
}

/** El aviso flotante («Guardado.»). */
export function toast(page: Page) {
  return page.locator('[data-admin-toast]');
}
