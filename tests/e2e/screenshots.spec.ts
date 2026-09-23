import { test } from '@playwright/test';
import { fillContact, mockTurnstile, submitButton, uniqueIp, waitForTurnstileToken } from './contact-helpers';
import { SECTION_CASES, isMobile, openMobileMenu, showMobilePage, withMusicPaused } from './helpers';

/**
 * Capturas para revisión visual (sin comparación estricta).
 * Se guardan en test-results/screenshots/<proyecto>/.
 */
test.describe('Capturas', () => {
  test.use({ reducedMotion: 'reduce' });

  for (const section of SECTION_CASES) {
    test(`captura de ${section.label}`, async ({ page }, testInfo) => {
      // Contact lleva el widget de Turnstile (simulado, fase 5).
      if (section.key === 'contact') await mockTurnstile(page);
      await page.goto(section.path);
      if (section.key === 'contact') await waitForTurnstileToken(page);
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

/** Fase 5: estados del formulario y páginas legales. */
test.describe('Capturas del contacto', () => {
  test.use({ reducedMotion: 'reduce' });

  test.beforeEach(async ({ page }) => {
    await withMusicPaused(page);
    await page.setExtraHTTPHeaders({ 'CF-Connecting-IP': uniqueIp() });
    await mockTurnstile(page);
  });

  test('captura del formulario con errores', async ({ page }, testInfo) => {
    await page.goto('/contact');
    await showMobilePage(page);
    await waitForTurnstileToken(page);
    await fillContact(page, { email: 'ana@', mensaje: 'corto' });
    await submitButton(page).click();
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: `test-results/screenshots/${testInfo.project.name}/contact-errores.png`, fullPage: true });
  });

  test('captura del mensaje enviado', async ({ page }, testInfo) => {
    await page.goto('/contact');
    await showMobilePage(page);
    await waitForTurnstileToken(page);
    await fillContact(page, {
      nombre: 'Ana Prueba',
      email: 'ana@example.com',
      motivo: 'booking',
      fecha: '2026-10-15',
      lugar: 'LA MARIQUEEN, Madrid',
      mensaje: 'Hola, ¿tienes libre esa fecha? [captura]',
      privacidad: true,
    });
    await submitButton(page).click();
    await page.locator('[data-contact-sent]').waitFor();
    await page.screenshot({ path: `test-results/screenshots/${testInfo.project.name}/contact-enviado.png` });
  });

  for (const page_ of [
    { key: 'aviso-legal', path: '/aviso-legal' },
    { key: 'privacidad', path: '/privacidad' },
  ]) {
    test(`captura de ${page_.key}`, async ({ page }, testInfo) => {
      await page.goto(page_.path);
      await page.evaluate(() => document.fonts.ready);
      await page.screenshot({ path: `test-results/screenshots/${testInfo.project.name}/${page_.key}.png`, fullPage: true });
    });
  }
});
