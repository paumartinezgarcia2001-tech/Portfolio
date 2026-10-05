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

  test('filtro de pantalla con bloom y sin curvatura (Luna, 05-10-2026)', async ({ page }) => {
    expect(CRT.curvature.enabled).toBe(false);
    expect(CRT.bloom.enabled).toBe(true);
    await page.goto('/');
    await expect(page.locator('html')).toHaveAttribute('data-crt-filter', '');
    await expect(page.locator('body')).toHaveCSS('filter', /url\(.*#crt-screen.*\)/);
    const filter = await page.locator('#crt-screen').evaluate((el) => ({
      displacement: el.querySelectorAll('feImage, feDisplacementMap').length,
      blur: el.querySelector('feGaussianBlur')?.getAttribute('stdDeviation'),
      source: el.querySelector('feComponentTransfer')?.getAttribute('in'),
    }));
    expect(filter.displacement).toBe(0);
    expect(filter.blur).toBe(String(CRT.bloom.radius));
    expect(filter.source).toBe('SourceGraphic');
  });

  test('el píxel del tubo mide 2 px (scanlines y fósforo)', async ({ page }) => {
    expect(CRT.pixel).toBe(2);
    await page.goto('/');
    const image = await page.locator(overlay).evaluate((el) => getComputedStyle(el).backgroundImage);
    expect(image).toContain('rgba(0, 0, 0, 0.25) 0px, rgba(0, 0, 0, 0.25) 2px, rgba(0, 0, 0, 0) 2px, rgba(0, 0, 0, 0) 6px');
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
      await expect(page.locator('body')).toHaveCSS('filter', 'none');
    });
  });
});
