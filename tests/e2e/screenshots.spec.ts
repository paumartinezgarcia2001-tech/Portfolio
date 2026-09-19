import { test } from '@playwright/test';
import { SECTION_CASES, isMobile, openMobileMenu, showMobilePage } from './helpers';

/**
 * Capturas para revisión visual (sin comparación estricta).
 * Se guardan en test-results/screenshots/<proyecto>/.
 */
test.describe('Capturas', () => {
  test.use({ reducedMotion: 'reduce' });

  for (const section of SECTION_CASES) {
    test(`captura de ${section.label}`, async ({ page }, testInfo) => {
      await page.goto(section.path);
      // En móvil las secciones abren en el menú (D44): aquí, la página, con la
      // mini-barra del reproductor. El menú tiene su propia captura.
      await showMobilePage(page);
      await page.evaluate(() => document.fonts.ready);
      await page.screenshot({
        path: `test-results/screenshots/${testInfo.project.name}/${section.key}.png`,
      });
    });
  }

  test('captura del menú en móvil', async ({ page }, testInfo) => {
    test.skip(!isMobile(testInfo), 'Solo móvil');
    await page.goto('/');
    await openMobileMenu(page);
    await page.screenshot({ path: `test-results/screenshots/${testInfo.project.name}/menu.png` });
  });

  test('captura del 404', async ({ page }, testInfo) => {
    await page.goto('/esto-no-existe');
    await page.screenshot({ path: `test-results/screenshots/${testInfo.project.name}/404.png` });
  });
});
