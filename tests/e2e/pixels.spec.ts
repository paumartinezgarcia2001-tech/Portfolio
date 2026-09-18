import { expect, test, type Page } from '@playwright/test';
import { isMobileViewport, menuLink, openMobileMenu } from './helpers';

/** C11 · Filtro pixelado: transición de píxeles (C11c) y textura LCD (C11a). */

interface LayerRecord {
  type: 'add' | 'remove';
  t: number;
  inPanel?: boolean;
  cols?: number;
  rows?: number;
  cssWidth?: string;
  painted?: number;
  color?: number[];
  panelWidth?: number;
  panelHeight?: number;
}

/** Anota cuándo entra y sale la capa de la transición, y cómo llega pintada. */
async function watchPixelLayer(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as { __px: LayerRecord[] };
    w.__px = [];
    const isLayer = (node: Node): node is HTMLElement =>
      node instanceof HTMLElement && node.classList.contains('pixel-transition');
    new MutationObserver((records) => {
      for (const record of records) {
        for (const node of record.addedNodes) {
          if (!isLayer(node)) continue;
          const canvas = node.querySelector('canvas')!;
          const data = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
          let painted = 0;
          for (let i = 3; i < data.length; i += 4) if (data[i]! > 0) painted++;
          const panel = document.getElementById('panel')!;
          w.__px.push({
            type: 'add',
            t: performance.now(),
            inPanel: node.parentElement === panel,
            cols: canvas.width,
            rows: canvas.height,
            cssWidth: canvas.style.width,
            painted,
            color: [data[0]!, data[1]!, data[2]!],
            panelWidth: panel.clientWidth,
            panelHeight: panel.clientHeight,
          });
        }
        for (const node of record.removedNodes) if (isLayer(node)) w.__px.push({ type: 'remove', t: performance.now() });
      }
    }).observe(document.documentElement, { childList: true, subtree: true });
  });
}

const records = (page: Page) => page.evaluate(() => (window as unknown as { __px: LayerRecord[] }).__px);

test.describe('Transición de píxeles', () => {
  test('el panel nuevo llega cubierto de cuadrados de 24 px del color de la sección y se descubre en ~450 ms', async ({
    page,
  }, testInfo) => {
    await page.goto('/');
    await watchPixelLayer(page);
    if (isMobileViewport(testInfo.project.use.viewport)) await openMobileMenu(page);
    await menuLink(page, 'archive').click();
    await expect(page.locator('html')).toHaveAttribute('data-section', 'archive');

    await expect.poll(async () => (await records(page)).length, { timeout: 3_000 }).toBe(2);
    const [added, removed] = await records(page);
    expect(added!.type).toBe('add');
    expect(added!.inPanel).toBe(true);
    expect(added!.cols).toBe(Math.ceil(added!.panelWidth! / 24));
    expect(added!.rows).toBe(Math.ceil(added!.panelHeight! / 24));
    expect(added!.cssWidth).toBe(`${added!.cols! * 24}px`);
    // Entra entero y del verde de archive.
    expect(added!.painted).toBe(added!.cols! * added!.rows!);
    expect(added!.color).toEqual([0, 255, 0]);
    // Desaparece solo: ~450 ms de disolución desde que arranca el deslizamiento.
    expect(removed!.type).toBe('remove');
    const visibleFor = removed!.t - added!.t;
    expect(visibleFor).toBeGreaterThanOrEqual(400);
    expect(visibleFor).toBeLessThan(1_500);
    await expect(page.locator('.pixel-transition')).toHaveCount(0);
  });

  test.describe('con prefers-reduced-motion', () => {
    test.use({ reducedMotion: 'reduce' });

    test('no hay transición de píxeles', async ({ page }, testInfo) => {
      await page.goto('/');
      await watchPixelLayer(page);
      if (isMobileViewport(testInfo.project.use.viewport)) await openMobileMenu(page);
      await menuLink(page, 'contact').click();
      await expect(page.locator('html')).toHaveAttribute('data-section', 'contact');
      await page.waitForTimeout(700);
      expect(await records(page)).toEqual([]);
    });
  });
});

test.describe('Textura LCD', () => {
  test('cubre toda la ventana, también el vídeo de Media, sin recibir clics', async ({ page }) => {
    await page.goto('/media');
    const overlay = page.locator('.pixel-overlay');
    await expect(overlay).toBeVisible();
    const info = await overlay.evaluate((el) => {
      const box = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      return {
        box: [box.x, box.y, box.width, box.height],
        viewport: [window.innerWidth, window.innerHeight],
        position: style.position,
        zIndex: Number(style.zIndex),
        pointerEvents: style.pointerEvents,
        opacity: Number(style.opacity),
      };
    });
    expect(info.position).toBe('fixed');
    expect(info.box).toEqual([0, 0, ...info.viewport]);
    expect(info.zIndex).toBe(30);
    expect(info.pointerEvents).toBe('none');
    expect(info.opacity).toBeCloseTo(0.12, 2);
  });

  test.describe('con prefers-contrast: more', () => {
    test.use({ contrast: 'more' });

    test('desaparece', async ({ page }) => {
      await page.goto('/');
      await expect(page.locator('.pixel-overlay')).toBeHidden();
    });
  });
});
