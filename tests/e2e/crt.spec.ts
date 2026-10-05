import { expect, test } from '@playwright/test';
import { CRT } from '../../src/config/crt';
import { isMobileViewport, markNode, menuLink, openMobileMenu, readMark } from './helpers';

/** C11d · Efecto CRT (Luna, 05-10-2026): capa CSS encima de toda la web. */

const overlay = '.crt-overlay';

test.describe('CRT', () => {
  test('capa fija encima de todo, sin eventos, con scanlines, fósforo y viñeta', async ({ page }) => {
    expect(CRT.enabled).toBe(true);
    await page.goto('/');
    const layer = page.locator(overlay);
    await expect(layer).toHaveCount(1);
    await expect(layer).toHaveAttribute('aria-hidden', 'true');
    await expect(layer).toHaveCSS('position', 'fixed');
    await expect(layer).toHaveCSS('pointer-events', 'none');
    const style = await layer.evaluate((el) => {
      const s = getComputedStyle(el);
      return { z: Number(s.zIndex), image: s.backgroundImage };
    });
    // Por encima del cursor (60), que es la capa más alta del resto.
    expect(style.z).toBe(70);
    expect(style.image).toContain('radial-gradient');
    expect(style.image.match(/repeating-linear-gradient/g)).toHaveLength(2);
    // El texto lleva el brillo y la aberración cromática.
    const shadow = await page.locator('#panel p').first().evaluate((el) => getComputedStyle(el).textShadow);
    expect(shadow).toContain('rgba(255, 0, 80, 0.35)');
    expect(shadow).toContain('rgba(0, 220, 255, 0.35)');
    // No tapa los clics: lo de debajo sigue siendo lo que recibe el puntero.
    const hit = await page.evaluate(() => {
      const el = document.elementFromPoint(innerWidth / 2, innerHeight / 2);
      return el?.closest('.crt-overlay') ? 'crt' : 'page';
    });
    expect(hit).toBe('page');
  });

  test('parpadea y sigue siendo la misma capa al navegar', async ({ page }, testInfo) => {
    await page.goto('/');
    const layer = page.locator(overlay);
    await expect(layer).toHaveCSS('animation-name', 'crt-flicker');
    await markNode(page, overlay, 'crt');
    if (isMobileViewport(testInfo.project.use.viewport)) await openMobileMenu(page);
    await menuLink(page, 'contact').click();
    await expect(page.locator('html')).toHaveAttribute('data-section', 'contact');
    expect(await readMark(page, overlay)).toBe('crt');
    await expect(page.locator('html')).toHaveAttribute('data-crt', '');
  });

  test('la curvatura (filtro SVG) está apagada por defecto', async ({ page }) => {
    expect(CRT.curvature.enabled).toBe(false);
    await page.goto('/');
    await expect(page.locator('#crt-barrel')).toHaveCount(0);
    await expect(page.locator('body')).toHaveCSS('filter', 'none');
  });

  test.describe('con prefers-reduced-motion', () => {
    test.use({ reducedMotion: 'reduce' });

    test('no parpadea', async ({ page }) => {
      await page.goto('/');
      await expect(page.locator(overlay)).toHaveCSS('animation-name', 'none');
      await expect(page.locator(overlay)).toBeAttached();
    });
  });

  test.describe('con prefers-contrast: more', () => {
    test.use({ contrast: 'more' });

    test('no hay efecto', async ({ page }) => {
      await page.goto('/');
      await expect(page.locator(overlay)).toHaveCSS('display', 'none');
      const shadow = await page.locator('#panel p').first().evaluate((el) => getComputedStyle(el).textShadow);
      expect(shadow).toBe('none');
    });
  });
});
