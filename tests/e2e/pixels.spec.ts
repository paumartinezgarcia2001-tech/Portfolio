import { expect, test, type Page } from '@playwright/test';
import { PIXEL } from '../../src/config/pixel';
import { isMobileViewport, menuLink, openMobileMenu } from './helpers';

/**
 * C11 · Filtro pixelado: transición de píxeles (C11c, sin deslizamiento desde
 * el 05-10-2026) y textura LCD (C11a, apagada).
 */

interface LayerRecord {
  type: 'add' | 'remove';
  t: number;
  /** `screen`: pixelado de la pantalla vieja (fijo en <body>); `panel`: despixelado en #panel. */
  kind: 'screen' | 'panel' | 'other';
  position?: string;
  box?: { left: number; top: number; width: number; height: number };
  cols?: number;
  rows?: number;
  cssWidth?: string;
  painted?: number;
  color?: number[];
  panelWidth?: number;
  panelHeight?: number;
  viewport?: { width: number; height: number };
  view?: string;
}

interface ColorSample {
  kind: 'screen' | 'panel';
  color: number[];
  accent: string;
}

/**
 * Anota cuándo entran y salen las capas de la transición y cómo están
 * pintadas, y en cada fotograma el color de los cuadrados junto al acento.
 */
async function watchPixelLayers(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as { __px: LayerRecord[]; __colors: ColorSample[] };
    w.__px = [];
    w.__colors = [];
    const isLayer = (node: Node): node is HTMLElement =>
      node instanceof HTMLElement && node.classList.contains('pixel-transition');
    const kindOf = (node: HTMLElement, parent: Node | null): LayerRecord['kind'] =>
      node.classList.contains('pixel-transition--screen')
        ? 'screen'
        : parent instanceof HTMLElement && parent.id === 'panel'
          ? 'panel'
          : 'other';
    const paint = (node: HTMLElement) => {
      const canvas = node.querySelector('canvas')!;
      const data = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
      let painted = 0;
      let color: number[] = [];
      for (let i = 3; i < data.length; i += 4) {
        if (data[i]! === 0) continue;
        painted++;
        if (!color.length) color = [data[i - 3]!, data[i - 2]!, data[i - 1]!];
      }
      return { canvas, painted, color };
    };
    const kinds = new WeakMap<HTMLElement, LayerRecord['kind']>();
    new MutationObserver((records) => {
      for (const record of records) {
        for (const node of record.addedNodes) {
          if (!isLayer(node)) continue;
          const { canvas, painted, color } = paint(node);
          const panel = document.getElementById('panel')!;
          const rect = node.getBoundingClientRect();
          const kind = kindOf(node, node.parentElement);
          kinds.set(node, kind);
          w.__px.push({
            type: 'add',
            t: performance.now(),
            kind,
            position: getComputedStyle(node).position,
            box: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
            cols: canvas.width,
            rows: canvas.height,
            cssWidth: canvas.style.width,
            painted,
            color,
            panelWidth: panel.clientWidth,
            panelHeight: panel.clientHeight,
            viewport: { width: innerWidth, height: innerHeight },
            view: document.documentElement.dataset.view,
          });
        }
        // El cambio de página sustituye el <body> entero: la capa del pixelado
        // se va dentro de él.
        const removed = [...record.removedNodes].flatMap((node) =>
          isLayer(node)
            ? [node]
            : node instanceof HTMLElement
              ? [...node.querySelectorAll<HTMLElement>('.pixel-transition')]
              : [],
        );
        for (const node of removed) {
          const { canvas, painted } = paint(node);
          w.__px.push({
            type: 'remove',
            t: performance.now(),
            kind: kinds.get(node) ?? 'other',
            cols: canvas.width,
            rows: canvas.height,
            painted,
          });
        }
      }
    }).observe(document.documentElement, { childList: true, subtree: true });
    const sample = () => {
      for (const node of document.querySelectorAll<HTMLElement>('.pixel-transition')) {
        const { painted, color } = paint(node);
        if (!painted) continue;
        w.__colors.push({
          kind: node.classList.contains('pixel-transition--screen') ? 'screen' : 'panel',
          color,
          accent: getComputedStyle(document.documentElement).getPropertyValue('--accent').trim(),
        });
      }
      requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });
}

const records = (page: Page) => page.evaluate(() => (window as unknown as { __px: LayerRecord[] }).__px);
const colorSamples = (page: Page) =>
  page.evaluate(() => (window as unknown as { __colors: ColorSample[] }).__colors);

const rgb = (color: number[]) => `rgb(${color.join(', ')})`;

test.describe('Transición de píxeles', () => {
  test('se pixela la pantalla vieja y, ya llena, se despixela mostrando la nueva, del color del acento', async ({
    page,
  }, testInfo) => {
    const mobile = isMobileViewport(testInfo.project.use.viewport);
    await page.goto('/');
    if (mobile) await openMobileMenu(page);
    await watchPixelLayers(page);
    await menuLink(page, 'archive').click();
    await expect(page.locator('html')).toHaveAttribute('data-section', 'archive');

    await expect.poll(async () => (await records(page)).length, { timeout: 4_000 }).toBe(4);
    const [screenIn, screenOut, panelIn, panelOut] = await records(page);

    // 1 · Pixelado: capa fija encima de lo que se ve (el panel en escritorio;
    // en móvil, el menú abierto, a pantalla completa). Arranca vacía.
    expect(screenIn!.type).toBe('add');
    expect(screenIn!.kind).toBe('screen');
    expect(screenIn!.position).toBe('fixed');
    expect(screenIn!.painted).toBe(0);
    const covered = mobile
      ? { width: screenIn!.viewport!.width, height: screenIn!.viewport!.height }
      : { width: screenIn!.panelWidth!, height: screenIn!.panelHeight! };
    expect(screenIn!.box!.width).toBe(covered.width);
    expect(screenIn!.box!.height).toBe(covered.height);
    if (!mobile) expect(screenIn!.box!.left).toBe(screenIn!.viewport!.width / 2);
    expect(screenIn!.cols).toBe(Math.ceil(covered.width / 24));
    expect(screenIn!.rows).toBe(Math.ceil(covered.height / 24));
    expect(screenIn!.cssWidth).toBe(`${screenIn!.cols! * 24}px`);

    // Se va con el cambio de página, y para entonces está llena.
    expect(screenOut!.type).toBe('remove');
    expect(screenOut!.kind).toBe('screen');
    expect(screenOut!.painted).toBe(screenOut!.cols! * screenOut!.rows!);
    expect(screenOut!.t - screenIn!.t).toBeGreaterThanOrEqual(400);

    // 2 · Despixelado: la página nueva llega entera tapada, ya sin el menú.
    expect(panelIn!.type).toBe('add');
    expect(panelIn!.kind).toBe('panel');
    expect(panelIn!.view).toBe('page');
    expect(panelIn!.cols).toBe(Math.ceil(panelIn!.panelWidth! / 24));
    expect(panelIn!.rows).toBe(Math.ceil(panelIn!.panelHeight! / 24));
    expect(panelIn!.painted).toBe(panelIn!.cols! * panelIn!.rows!);
    // Arranca del color en que acabó el pixelado: el rosa de info.
    expect(panelIn!.color).toEqual([255, 0, 255]);
    expect(panelIn!.t).toBeGreaterThanOrEqual(screenOut!.t);

    // Desaparece sola en ~450 ms.
    expect(panelOut!.type).toBe('remove');
    expect(panelOut!.kind).toBe('panel');
    expect(panelOut!.painted).toBe(0);
    const visibleFor = panelOut!.t - panelIn!.t;
    expect(visibleFor).toBeGreaterThanOrEqual(400);
    expect(visibleFor).toBeLessThan(1_500);
    await expect(page.locator('.pixel-transition')).toHaveCount(0);

    // El color sigue al acento fotograma a fotograma, como la barra de noticias:
    // pasa del rosa al verde por colores intermedios.
    const samples = (await colorSamples(page)).filter((s) => s.kind === 'panel');
    const colors = samples.map((s) => rgb(s.color));
    expect(colors.some((c) => c !== 'rgb(255, 0, 255)' && c !== 'rgb(0, 255, 0)'), colors.join(' | ')).toBe(true);
    // Mismo color que el acento (o el del fotograma anterior, según qué
    // requestAnimationFrame corra antes).
    const matching = samples.filter((s, i) => [s.accent, samples[i - 1]?.accent].includes(rgb(s.color))).length;
    expect(matching / samples.length, JSON.stringify(samples)).toBeGreaterThanOrEqual(0.9);
    await expect(page.locator('[data-ticker]')).toHaveCSS('background-color', 'rgb(0, 255, 0)');
  });

  test.describe('con prefers-reduced-motion', () => {
    test.use({ reducedMotion: 'reduce' });

    test('no hay transición de píxeles', async ({ page }, testInfo) => {
      await page.goto('/');
      if (isMobileViewport(testInfo.project.use.viewport)) await openMobileMenu(page);
      await watchPixelLayers(page);
      await menuLink(page, 'contact').click();
      await expect(page.locator('html')).toHaveAttribute('data-section', 'contact');
      await page.waitForTimeout(700);
      expect(await records(page)).toEqual([]);
    });
  });
});

test.describe('Textura LCD', () => {
  test('está apagada: no hay rejilla encima de la web (Luna, 04-10-2026)', async ({ page }) => {
    expect(PIXEL.overlay.enabled).toBe(false);
    await page.goto('/media');
    await expect(page.locator('.pixel-overlay')).toHaveCount(0);
  });
});
