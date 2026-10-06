import { expect, test, type Page } from '@playwright/test';
import { mockState, openAdmin, resetSupabase, signInAsPau, toast } from './helpers';

/**
 * Colores de la web desde el panel (Luna, 06-10-2026): secciones, fondos y
 * reproductor (color propio o el de cada sección).
 */

test.beforeEach(async ({ request }) => {
  await resetSupabase(request);
});

const isMobile = (page: Page) => (page.viewportSize()?.width ?? 1280) < 1024;

/** Valor calculado de una variable CSS en <html>. */
function cssVar(page: Page, name: string): Promise<string> {
  return page.evaluate((n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim(), name);
}

async function setColor(page: Page, label: string, value: string): Promise<void> {
  const input = page.getByLabel(label, { exact: true });
  await input.fill(value);
  await input.blur();
}

test('cambiar colores → vista previa al momento, avisos de contraste y se ven en la web', async ({ page, request }) => {
  await signInAsPau(page, 'colores');
  await expect(page.getByRole('heading', { level: 1, name: 'colores' })).toBeVisible();
  await expect(page.locator('[data-contrast]')).toContainText('Todos los textos se leen bien.');

  // Vista previa: next dates en naranja.
  await setColor(page, 'next dates', '#FF8800');
  const preview = page.locator('[data-theme-preview]');
  await preview.getByRole('button', { name: 'next dates' }).click();
  await expect(preview.locator('.a-theme-preview__ticker')).toHaveCSS('background-color', 'rgb(255, 136, 0)');
  await expect(preview.locator('.a-theme-preview__hl')).toHaveCSS('background-color', 'rgb(255, 136, 0)');

  // Un fondo de página casi igual que el del menú: aviso (pero se puede guardar).
  await setColor(page, 'fondo de la página', '#333333');
  await expect(page.locator('[data-contrast]')).toContainText('los dos fondos (texto del menú y de la página)');
  await setColor(page, 'fondo de la página', '#f2f2f2');
  await expect(page.locator('[data-contrast]')).toContainText('Todos los textos se leen bien.');

  // Reproductor con color propio.
  await setColor(page, 'color propio del reproductor', '#00ccff');
  await page.getByRole('button', { name: 'guardar' }).click();
  await expect(toast(page)).toHaveText('Guardado.');
  await expect(page.locator('.a-lead')).toHaveText('La web usa los colores guardados desde aquí.');

  const state = await mockState(request);
  expect(state.tables.site_settings[0]!.theme).toMatchObject({
    next: '#ff8800',
    panelBg: '#f2f2f2',
    player: '#00ccff',
    playerFollowsSection: false,
  });

  // En la web: el acento de next dates, el fondo de la página (y el texto del
  // menú, que es el mismo) y el reproductor.
  await page.goto('/next-dates');
  await expect.poll(() => cssVar(page, '--accent')).toBe('rgb(255, 136, 0)');
  expect(await cssVar(page, '--c-panel-bg')).toBe('#f2f2f2');
  expect(await cssVar(page, '--c-menu-fg')).toBe('#f2f2f2');
  expect(await cssVar(page, '--c-player')).toBe('#00ccff');
  await expect(page.locator('[data-ticker]')).toHaveCSS('background-color', 'rgb(255, 136, 0)');
  await expect(page.locator('#panel')).toHaveCSS('background-color', 'rgb(242, 242, 242)');
  // El rotulador pinta sus bordes con el papel nuevo.
  const texture = await page.locator('.hl').first().evaluate((el) => getComputedStyle(el).backgroundImage);
  expect(texture).toMatch(/(%23|#)f2f2f2/i);
  expect(texture).not.toMatch(/(%23|#)c5c7d6/i);
  if (isMobile(page)) {
    // Mini-barra del reproductor: siempre del color del reproductor.
    await page.locator('[data-back-button]').click();
    await expect(page.locator('html')).toHaveAttribute('data-view', 'page');
    await expect(page.locator('.player').getByRole('button', { name: 'Mix siguiente' })).toHaveCSS(
      'color',
      'rgb(0, 204, 255)',
    );
  }
});

test('el reproductor puede llevar el color de cada sección', async ({ page, request }) => {
  await signInAsPau(page, 'colores');
  const own = page.getByLabel('color propio del reproductor');
  await expect(own).toBeVisible();
  await page.getByLabel('usar el color de cada sección (como la barra y el rotulador)').check();
  await expect(own).toBeHidden();
  await page.getByRole('button', { name: 'guardar' }).click();
  await expect(toast(page)).toHaveText('Guardado.');
  expect((await mockState(request)).tables.site_settings[0]!.theme).toMatchObject({ playerFollowsSection: true });

  await page.goto('/archive');
  await expect.poll(() => cssVar(page, '--c-player')).toBe('rgb(0, 255, 0)');
  if (isMobile(page)) {
    await page.locator('[data-back-button]').click();
    await expect(page.locator('.player').getByRole('button', { name: 'Mix siguiente' })).toHaveCSS(
      'color',
      'rgb(0, 255, 0)',
    );
  }
});

test('un código que no es un color no se guarda', async ({ page, request }) => {
  await signInAsPau(page, 'colores');
  await setColor(page, 'media', 'amarillo');
  await page.getByRole('button', { name: 'guardar' }).click();
  await expect(page.locator('[data-error-for="media"]')).toHaveText('Escribe un color en formato #RRGGBB (p. ej. #ff00ff).');
  expect((await mockState(request)).tables.site_settings[0]!.theme).toBeNull();
});

test('volver a los colores originales', async ({ page, request }) => {
  await signInAsPau(page, 'colores');
  await setColor(page, 'info', '#123456');
  await page.getByRole('button', { name: 'guardar' }).click();
  await expect(toast(page)).toHaveText('Guardado.');
  await openAdmin(page, 'colores');
  await page.getByRole('button', { name: 'usar los colores originales' }).click();
  await page.locator('dialog[data-admin-dialog]').getByRole('button', { name: 'volver a los originales' }).click();
  await expect(toast(page)).toHaveText('Vuelven a estar los colores originales.');
  expect((await mockState(request)).tables.site_settings[0]!.theme).toBeNull();
  await page.goto('/');
  await expect.poll(() => cssVar(page, '--accent')).toBe('rgb(255, 0, 255)');
  await expect(page.locator('style[data-theme]')).toHaveCount(0);
});
