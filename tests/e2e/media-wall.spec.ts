import { expect, test, type Page } from '@playwright/test';
import { MEDIA_WALL } from '../../src/config/media-wall';
import { FIXTURE_WALL } from '../../src/lib/data/fixtures';
import { isMobileViewport, menuLink, openMobileMenu, showMobilePage } from './helpers';

/**
 * D65 · Muro animado de Media, con las piezas de `FIXTURE_WALL` (las genera
 * tests/e2e/global-setup.ts y las sirve scripts/serve-media.mjs como si fuera
 * R2). El movimiento en sí (velocidad constante, reciclado, semilla) lo prueba
 * tests/unit/media-wall.test.ts; aquí, la integración en la web.
 */

interface WallStats {
  elements: number;
  videos: number;
  playing: number;
  mode: string | null;
  frames: number;
}

function stats(page: Page): Promise<WallStats | undefined> {
  return page.evaluate(() => (customElements.get('media-wall') as unknown as { stats?: WallStats } | undefined)?.stats);
}

async function frames(page: Page): Promise<number> {
  return (await stats(page))?.frames ?? 0;
}

/** Pinta fotogramas nuevos: la animación está en marcha. */
async function expectAnimating(page: Page): Promise<void> {
  const first = await frames(page);
  await expect.poll(() => frames(page), { timeout: 8_000 }).toBeGreaterThan(first + 5);
}

/** No pinta nada en 600 ms: está parada. */
async function expectStill(page: Page): Promise<void> {
  const first = await frames(page);
  await page.waitForTimeout(600);
  expect(await frames(page)).toBeLessThanOrEqual(first + 1);
}

async function openMedia(page: Page): Promise<void> {
  await page.goto('/media');
  await showMobilePage(page);
  await expect(page.locator('media-wall')).toHaveAttribute('data-mode', /.+/);
}

/** Como un navegador sin WebGL (o con la GPU bloqueada y sin alternativa). */
async function withoutWebGL(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, type: string, ...rest: unknown[]) {
      if (type === 'webgl' || type === 'webgl2' || type === 'experimental-webgl') return null;
      return (original as (...args: unknown[]) => unknown).call(this, type, ...rest);
    } as typeof original;
  });
}

const wall = (page: Page) => page.locator('media-wall');
// Dentro del muro: el reproductor de mixes también tiene un botón `data-action="toggle"`.
const pauseButton = (page: Page) => wall(page).locator('[data-action="toggle"]');

test.describe('Muro de Media', () => {
  test.skip(!MEDIA_WALL.enabled, 'El muro está apagado (MEDIA_WALL.enabled): Media enseña el vídeo único');
  test.skip(Boolean(process.env.E2E_BASE_URL), 'Usa las piezas de prueba y el servidor local de .media');
  test.skip(process.env.E2E_MEDIA !== 'ok', `Sin piezas de prueba: ${process.env.E2E_MEDIA ?? 'sin preparar'}`);

  test('ocupa todo el panel, pinta con WebGL y se anima', async ({ page }) => {
    await openMedia(page);
    await expect(wall(page)).toHaveAttribute('data-mode', 'gl');
    await expect(wall(page)).toHaveAttribute('data-ready', '', { timeout: 10_000 });
    await expect(wall(page)).toHaveAttribute('data-state', 'playing');
    await expectAnimating(page);

    const boxes = await page.evaluate(() => {
      const panel = document.getElementById('panel')!.getBoundingClientRect();
      const canvas = document.querySelector('media-wall canvas')!.getBoundingClientRect();
      const bar = document.querySelector('mix-player')!.getBoundingClientRect();
      const mobile = !window.matchMedia('(min-width: 1024px)').matches;
      const bottom = mobile ? bar.top : panel.bottom;
      return { panel: [panel.x, panel.y, panel.width, bottom - panel.y], canvas: [canvas.x, canvas.y, canvas.width, canvas.height] };
    });
    boxes.canvas.forEach((value, i) => expect(Math.abs(value - boxes.panel[i]!)).toBeLessThanOrEqual(0.5));
  });

  test('se anima también con «reducir movimiento» (Luna, 13-10-2026) y tiene pausa (WCAG 2.2.2)', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await openMedia(page);
    await expectAnimating(page);

    await pauseButton(page).click();
    await expect(pauseButton(page)).toHaveText('reanudar');
    await expect(pauseButton(page)).toHaveAttribute('aria-pressed', 'true');
    await expect(wall(page)).toHaveAttribute('data-state', 'paused');
    await expectStill(page);

    await pauseButton(page).click();
    await expect(pauseButton(page)).toHaveText('pausa');
    await expectAnimating(page);
  });

  test('los bucles de vídeo se reproducen sin pasar del límite', async ({ page }, testInfo) => {
    await openMedia(page);
    await expect.poll(async () => (await stats(page))?.playing ?? 0, { timeout: 10_000 }).toBeGreaterThan(0);
    const cap = isMobileViewport(testInfo.project.use.viewport) ? FIXTURE_WALL.maxVideos.narrow : FIXTURE_WALL.maxVideos.wide;
    for (let i = 0; i < 5; i++) {
      expect((await stats(page))?.playing ?? 0).toBeLessThanOrEqual(cap);
      await page.waitForTimeout(400);
    }
    // Mudos, en línea y sin controles: solo son texturas.
    const videos = await page.evaluate(() =>
      [...document.querySelectorAll<HTMLVideoElement>('media-wall [data-wall-videos] video')].map((v) => ({
        muted: v.muted,
        inline: v.playsInline,
        controls: v.controls,
        cors: v.crossOrigin,
      })),
    );
    expect(videos.length).toBeGreaterThan(0);
    for (const v of videos) expect(v).toEqual({ muted: true, inline: true, controls: false, cors: 'anonymous' });
  });

  test('teclado: cada pieza tiene su enlace, aparece con el foco y abre el visor', async ({ page }) => {
    await openMedia(page);
    const links = wall(page).locator('a[data-wall-item]');
    await expect(links).toHaveCount(FIXTURE_WALL.items.length);
    await expect(links.first()).toHaveAccessibleName(FIXTURE_WALL.items[0]!.title);

    await links.first().focus();
    await expect(links.first()).toBeVisible();
    await page.keyboard.press('Enter');
    const viewer = wall(page).locator('[data-wall-viewer]');
    await expect(viewer).toBeVisible();
    await expect(viewer.getByRole('button', { name: 'cerrar' })).toBeFocused();
    await expect(viewer).toContainText(FIXTURE_WALL.items[0]!.title);
    // Con el visor abierto, el muro se para.
    await expect(wall(page)).toHaveAttribute('data-state', 'idle');

    await page.keyboard.press('Escape');
    await expect(viewer).toBeHidden();
    await expect(links.first()).toBeFocused();
    await expect(wall(page)).toHaveAttribute('data-state', 'playing');
  });

  test('un clic o un toque en una pieza la abre en el visor', async ({ page }) => {
    await openMedia(page);
    await expect(wall(page)).toHaveAttribute('data-ready', '', { timeout: 10_000 });
    // Para la animación y busca el centro de una pieza que se vea entera.
    await pauseButton(page).click();
    const box = (await wall(page).boundingBox())!;
    const viewer = wall(page).locator('[data-wall-viewer]');
    for (const [fx, fy] of [[0.3, 0.5], [0.7, 0.5], [0.3, 0.3], [0.7, 0.7], [0.5, 0.4]] as const) {
      await page.mouse.click(box.x + box.width * fx, box.y + box.height * fy);
      if (await viewer.isVisible()) break;
    }
    await expect(viewer).toBeVisible();
    await viewer.getByRole('button', { name: 'cerrar' }).click();
    await expect(viewer).toBeHidden();
  });

  test('al salir de Media se libera todo (GPU, vídeos, bucle)', async ({ page }, testInfo) => {
    await openMedia(page);
    await expect.poll(async () => (await stats(page))?.videos ?? 0, { timeout: 10_000 }).toBeGreaterThan(0);
    if (isMobileViewport(testInfo.project.use.viewport)) await openMobileMenu(page);
    await menuLink(page, 'archive').click();
    await expect(page.locator('html')).toHaveAttribute('data-section', 'archive');
    await expect.poll(() => stats(page)).toMatchObject({ elements: 0, videos: 0 });
    await expect(page.locator('video')).toHaveCount(0);
  });

  test('en móvil, con el menú abierto, se para', async ({ page }, testInfo) => {
    test.skip(!isMobileViewport(testInfo.project.use.viewport), 'Solo en móvil');
    await openMedia(page);
    await expectAnimating(page);
    await openMobileMenu(page);
    await expect(wall(page)).toHaveAttribute('data-state', 'idle');
    await expectStill(page);
  });

  test('sin WebGL: el bucle pre-renderizado, en la proporción del panel', async ({ page }, testInfo) => {
    await withoutWebGL(page);
    await openMedia(page);
    await expect(wall(page)).toHaveAttribute('data-mode', 'video');
    const video = wall(page).locator('video.media-wall__fallback');
    const rendition = isMobileViewport(testInfo.project.use.viewport) ? '9x16' : '4x5';
    await expect(video).toHaveAttribute('src', new RegExp(`/${rendition}/fallback\\.mp4$`));
    await expect(wall(page)).toHaveAttribute('data-ready', '', { timeout: 10_000 });
    const time = () => video.evaluate((v: HTMLVideoElement) => v.currentTime);
    const start = await time();
    await expect.poll(time, { timeout: 5_000 }).toBeGreaterThan(start + 0.3);
    // La pausa también lo para.
    await pauseButton(page).click();
    await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.paused)).toBe(true);
  });

  test('sin WebGL ni bucle: piezas HTML que se mueven igual (último recurso)', async ({ page }) => {
    await withoutWebGL(page);
    // Quita el bucle pre-renderizado de la configuración que manda el servidor
    // (se cambia el JSON en cuanto el HTML lo trae, antes de que corra el script).
    await page.addInitScript(() => {
      const strip = () => {
        const script = document.querySelector('script[data-wall-config]');
        if (!script?.textContent || script.hasAttribute('data-stripped')) return;
        const config = JSON.parse(script.textContent) as { fallback: unknown };
        config.fallback = null;
        script.textContent = JSON.stringify(config);
        script.setAttribute('data-stripped', '');
      };
      new MutationObserver(strip).observe(document, { childList: true, subtree: true });
    });
    await openMedia(page);
    await expect(wall(page)).toHaveAttribute('data-mode', 'dom');
    const pieces = wall(page).locator('.media-wall__dom-piece');
    await expect.poll(() => pieces.count()).toBeGreaterThan(2);
    const first = await pieces.first().getAttribute('style');
    await expect.poll(() => pieces.first().getAttribute('style')).not.toBe(first);
  });
});

test.describe('Muro de Media sin las piezas en R2', () => {
  test.skip(!MEDIA_WALL.enabled, 'El muro está apagado');
  test.skip(Boolean(process.env.E2E_BASE_URL), 'Usa el servidor local de .media');

  test('si ninguna pieza carga (404), el muro sigue vivo con los rótulos y lo avisa en la consola', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });
    await page.route('**/wall/**', (route) => route.fulfill({ status: 404, body: 'Not Found' }));
    await openMedia(page);
    await expect(wall(page)).toHaveAttribute('data-ready', '', { timeout: 10_000 });
    await expectAnimating(page);
    await expect.poll(() => errors.some((e) => e.includes('No carga ninguna pieza del muro'))).toBe(true);
  });
});

test.describe('Muro de Media sin JavaScript', () => {
  test.skip(!MEDIA_WALL.enabled, 'El muro está apagado');
  test.use({ javaScriptEnabled: false });

  test('queda una rejilla de miniaturas que abren cada archivo', async ({ page }) => {
    await page.goto('/media');
    const links = page.locator('media-wall a[data-wall-item]');
    await expect(links).toHaveCount(FIXTURE_WALL.items.length);
    for (const link of await links.all()) await expect(link.locator('img')).toBeAttached();
    await expect(links.first()).toHaveAttribute('href', /\/wall\/e2e-wall-video\/loop\.mp4$/);
  });
});
