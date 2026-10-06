import { expect, type Page } from '@playwright/test';
import { existsSync } from 'node:fs';
import { adminUrl, openAdmin, PAU, resetSupabase, test, waitReady } from './helpers';

/**
 * Capturas del panel para revisión visual y para la guía de Pau (sin
 * comparación estricta). Se guardan en test-results/screenshots-admin/<proyecto>/.
 * En la barra de direcciones no sale nada: el nombre de los tests
 * (`panel-e2e`) no aparece en las imágenes.
 */
const FIXTURE_POSTER = '.media/video/e2e-fixture/4x5/poster.jpg';

test.describe('Capturas del panel', () => {
  test.use({ reducedMotion: 'reduce' });

  test.beforeEach(async ({ request }) => {
    await resetSupabase(request);
  });

  const shot = (page: Page, project: string, name: string, fullPage = false) =>
    page.screenshot({ path: `test-results/screenshots-admin/${project}/${name}.png`, fullPage });

  test('recorrido', async ({ page }, testInfo) => {
    const project = testInfo.project.name;
    // Sin animación del ticker: la captura sale igual siempre.
    await page.addInitScript(() => {
      document.addEventListener('DOMContentLoaded', () => {
        const style = document.createElement('style');
        style.textContent = '.ticker__track { animation: none !important; }';
        document.head.appendChild(style);
      });
    });

    await page.goto(adminUrl());
    await waitReady(page);
    await page.getByLabel('usuario').fill(PAU.alias);
    await page.getByLabel('contraseña').fill(PAU.password);
    await shot(page, project, '01-login');

    await page.getByRole('button', { name: 'entrar' }).click();
    await expect(page.getByRole('button', { name: 'cerrar sesión' })).toBeVisible();
    await waitReady(page);
    await page.getByLabel('texto', { exact: true }).fill('NUEVO EP «TRAVESTISIMA» YA DISPONIBLE');
    await shot(page, project, '02-barra');

    const form = page.locator('[data-gig-form]');
    await form.getByLabel('fecha *').fill('2099-12-24');
    await form.getByLabel(/nombre de la fiesta/).fill('LA MARI');
    await form.getByLabel('sala *').fill('LA MARIQUEEN');
    await form.getByLabel('ciudad *').fill('Madrid');
    await form.getByLabel(/lineup/).fill('MANUELAC0RE, TRAVEST15M0, NEGRACONDA');
    await page.evaluate(() => document.querySelector('#new-gig-title')?.scrollIntoView({ block: 'start' }));
    await shot(page, project, '03-anadir-bolo');

    await form.getByLabel('añadir varias fechas').check();
    await form.getByRole('button', { name: '+ la misma, una semana después' }).click();
    await form.getByRole('button', { name: '+ la misma, una semana después' }).click();
    await page.evaluate(() => document.querySelector('#new-gig-title')?.scrollIntoView({ block: 'start' }));
    await shot(page, project, '04-varias-fechas');
    await form.getByRole('button', { name: 'añadir' }).click();
    await expect(page.locator('[data-admin-toast]')).toHaveText('Guardado. 3 fechas.');
    await page.evaluate(() => document.querySelector('#upcoming-title')?.scrollIntoView({ block: 'start' }));
    await shot(page, project, '05-guardado-y-lista');

    // Duplicado
    await form.getByLabel('fecha *').fill('2099-09-30');
    await form.getByLabel(/nombre de la fiesta/).fill('OTRA FIESTA');
    await form.getByLabel('sala *').fill('SIROCO');
    await form.getByLabel('ciudad *').fill('Madrid');
    await form.getByRole('button', { name: 'añadir' }).click();
    await expect(page.locator('dialog[data-admin-dialog]')).toBeVisible();
    await shot(page, project, '06-aviso-duplicado');
    await page.locator('dialog[data-admin-dialog]').getByRole('button', { name: 'cancelar' }).click();

    // Borrar
    const row = page.locator('[data-region="upcoming"] .a-item', { hasText: 'INSULTO CLUB' });
    await row.getByRole('button', { name: /Borrar/ }).click();
    await expect(page.locator('dialog[data-admin-dialog]')).toBeVisible();
    await shot(page, project, '07-borrar');
    await page.locator('dialog[data-admin-dialog]').getByRole('button', { name: 'cancelar' }).click();

    // Editar
    await row.getByRole('link', { name: /Editar/ }).click();
    await waitReady(page);
    await shot(page, project, '08-editar');

    await openAdmin(page, 'archivo');
    await shot(page, project, '09-archivo');

    await openAdmin(page, 'mixes');
    await shot(page, project, '10-mixes');

    await openAdmin(page, 'info');
    await shot(page, project, '11-info');

    // El póster del vídeo de prueba no está en el R2 simulado: se usa el de los e2e (.media/).
    if (existsSync(FIXTURE_POSTER)) {
      await page.route('http://localhost:4322/video/**/poster.jpg', (route) => route.fulfill({ path: FIXTURE_POSTER }));
    }
    await openAdmin(page, 'video');
    await shot(page, project, '12-video');

  });
});
