import { expect, test, type Page } from '@playwright/test';
import { isMobileViewport, menuLink } from './helpers';

async function cursorState(page: Page) {
  return page.locator('[data-cursor]').evaluate((el) => {
    const style = getComputedStyle(el);
    const matrix = new DOMMatrixReadOnly(style.transform);
    const box = el.getBoundingClientRect();
    return {
      visible: el.hasAttribute('data-visible'),
      display: style.display,
      background: style.backgroundColor,
      scale: Math.round(Math.hypot(matrix.a, matrix.b) * 100) / 100,
      centerX: box.x + box.width / 2,
      centerY: box.y + box.height / 2,
      pointerEvents: style.pointerEvents,
    };
  });
}

test.describe('Cursor personalizado', () => {
  test.skip(({ viewport }) => isMobileViewport(viewport), 'Solo con ratón');

  test('sigue al ratón, crece sobre enlaces y toma el color del ítem', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('html')).toHaveClass(/has-cursor/);
    await expect(page.locator('body')).toHaveCSS('cursor', 'none');

    await page.mouse.move(1000, 500);
    await expect.poll(async () => (await cursorState(page)).visible).toBe(true);
    await expect
      .poll(async () => {
        const s = await cursorState(page);
        return Math.round(Math.hypot(s.centerX - 1000, s.centerY - 500));
      })
      .toBeLessThanOrEqual(1);
    const state = await cursorState(page);
    expect(state.pointerEvents).toBe('none');
    expect(state.background).toBe('rgb(255, 0, 255)');
    expect(state.scale).toBe(1);

    // Sobre «archive»: color verde y escala 1,6.
    await menuLink(page, 'archive').hover();
    await expect.poll(async () => (await cursorState(page)).scale).toBe(1.6);
    await expect.poll(async () => (await cursorState(page)).background).toBe('rgb(0, 255, 0)');

    // Al pulsar se encoge.
    await page.mouse.down();
    await expect.poll(async () => (await cursorState(page)).scale).toBe(0.8);
    await page.mouse.up();

    // Sobre la barra de noticias (fondo de acento) se ve en oscuro.
    await page.locator('[data-ticker]').hover();
    await expect.poll(async () => (await cursorState(page)).background).toBe('rgb(39, 39, 43)');
    await expect.poll(async () => (await cursorState(page)).scale).toBe(1);
  });

  test('sigue funcionando después de navegar y se oculta al salir de la ventana', async ({ page }) => {
    await page.goto('/');
    await page.mouse.move(900, 400);
    await menuLink(page, 'media').click();
    await expect(page.locator('html')).toHaveAttribute('data-section', 'media');
    await expect(page.locator('html')).toHaveClass(/has-cursor/);
    await page.mouse.move(1100, 450);
    await expect.poll(async () => (await cursorState(page)).visible).toBe(true);
    await expect.poll(async () => (await cursorState(page)).background).toBe('rgb(255, 255, 0)');

    await page.mouse.move(-10, -10);
    await page.evaluate(() =>
      document.dispatchEvent(new MouseEvent('mouseout', { bubbles: true, relatedTarget: null })),
    );
    await expect.poll(async () => (await cursorState(page)).visible).toBe(false);
  });

  test('no se activa en pantallas táctiles', async ({ browser }) => {
    const context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      hasTouch: true,
      isMobile: true,
    });
    const page = await context.newPage();
    await page.goto('/');
    await expect(page.locator('html')).not.toHaveClass(/has-cursor/);
    await expect(page.locator('[data-cursor]')).toBeHidden();
    await context.close();
  });
});
