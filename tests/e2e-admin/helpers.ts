import { expect, type APIRequestContext, type Page } from '@playwright/test';
import { mockTurnstile } from '../e2e/contact-helpers';

/**
 * Ayudas de los e2e del panel (fase 6). Ver playwright.admin.config.ts.
 */

export const ADMIN_PATH = process.env.E2E_ADMIN_PATH ?? 'panel-e2e';
export const SUPABASE_URL = `http://127.0.0.1:${process.env.E2E_SUPABASE_PORT ?? 4324}`;

export const PAU = { email: 'pau@e2e.test', alias: 'pau', password: 'contraseña-e2e-123' };
export const INTRUDER = { email: 'intrusa@e2e.test', password: 'contraseña-e2e-456' };
export const TOTP_CODE = '123456';
export const R2_ORIGIN = 'https://e2e-account.r2.cloudflarestorage.com';

export function adminUrl(path = ''): string {
  return path ? `/${ADMIN_PATH}/${path.replace(/^\/+/, '')}` : `/${ADMIN_PATH}`;
}

/** Vuelve a dejar el Supabase simulado como al principio. */
export async function resetSupabase(request: APIRequestContext): Promise<void> {
  const response = await request.post(`${SUPABASE_URL}/__e2e/reset`);
  expect(response.ok()).toBe(true);
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

/** Abre el panel (con Turnstile simulado) y entra. */
export async function signIn(page: Page, user: { email: string; password: string } = PAU, path = ''): Promise<void> {
  await mockTurnstile(page);
  await page.goto(adminUrl(path));
  await page.getByLabel('usuario').fill(user.email);
  await page.getByLabel('contraseña').fill(user.password);
  await expect(page.getByRole('button', { name: 'entrar' })).toBeEnabled();
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
