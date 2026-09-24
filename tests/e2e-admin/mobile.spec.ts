import { expect, test } from '@playwright/test';
import { adminUrl, resetSupabase, signInAsPau, toast } from './helpers';

/**
 * C19 · Criterio de aceptación: Pau publica un bolo nuevo desde el móvil en
 * menos de un minuto (panel usable a 375 px): sin scroll horizontal, zonas
 * táctiles de 44 px y el formulario a mano.
 */

test.beforeEach(async ({ request }) => {
  await resetSupabase(request);
});

test('a 375 px: sin scroll horizontal y con zonas táctiles de 44 px', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'admin-mobile', 'Solo en móvil');
  await signInAsPau(page);
  for (const path of ['', 'archivo', 'mixes', 'info', 'video', 'seguridad']) {
    await page.goto(adminUrl(path));
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow, `scroll horizontal en /${path}`).toBeLessThanOrEqual(0);
  }
  await page.goto(adminUrl());
  // Las casillas se tocan por toda su etiqueta (<label class="a-check">).
  const small = await page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>('main button, main a, main input:not([type="hidden"]), header button, header a')]
      .filter((el) => el.offsetParent !== null)
      .map((el) => (el.matches('input[type="checkbox"]') ? (el.closest('label') ?? el) : el))
      .map((el) => ({ el: el.outerHTML.slice(0, 80), h: el.getBoundingClientRect().height }))
      .filter(({ h }) => h < 43.5),
  );
  expect(small).toEqual([]);
});

test('publicar un bolo desde el móvil en menos de un minuto', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'admin-mobile', 'Solo en móvil');
  const start = Date.now();
  await signInAsPau(page);
  const form = page.locator('[data-gig-form]');
  await form.getByLabel('fecha *').fill('2099-10-31');
  await form.getByLabel(/nombre de la fiesta/).fill('HALLOWEEN');
  await form.getByLabel('sala *').fill('SALA MÓVIL');
  await form.getByLabel('ciudad *').fill('Madrid');
  await form.getByRole('button', { name: 'añadir' }).tap();
  await expect(toast(page)).toHaveText('Guardado.');
  await expect(toast(page)).toBeInViewport();
  await page.goto('/next-dates');
  await expect(page.locator('.event', { hasText: 'HALLOWEEN' })).toBeAttached();
  expect(Date.now() - start).toBeLessThan(60_000);
});
