import { gzipSync } from 'node:zlib';
import { expect, test, type Page } from '@playwright/test';
import { SECTION_CASES, isMobileViewport, openMobileMenu } from './helpers';

/** Tamaños de §5 · C05. */
const MENU_SIZES = [
  { width: 1024, height: 600 },
  { width: 1280, height: 720 },
  { width: 1440, height: 900 },
  { width: 1920, height: 1080 },
  { width: 2560, height: 1440 },
  { width: 375, height: 812 },
];

interface RowMetrics {
  name: string;
  textWidth: number;
  textHeight: number;
  boxWidth: number;
  rowHeight: number;
  scrollWidth: number;
  clientWidth: number;
  textRight: number;
  columnRight: number;
  rowBottom: number;
}

/** Mide el texto de cada fila del menú y del reproductor. */
async function measureRows(page: Page): Promise<{ rows: RowMetrics[]; viewportHeight: number }> {
  return page.evaluate(() => {
    const column = document.getElementById('left')!.getBoundingClientRect();
    const targets = [
      ...document.querySelectorAll<HTMLElement>('[data-menu-link]'),
      // Reproductor (D43): los tres botones del centro.
      document.querySelector<HTMLElement>('mix-player .player__controls')!,
    ];
    const rows = targets.map((el) => {
      const range = document.createRange();
      range.selectNodeContents(el);
      const text = range.getBoundingClientRect();
      const box = el.getBoundingClientRect();
      const row = (el.closest('li, mix-player') as HTMLElement).getBoundingClientRect();
      return {
        name: el.textContent?.trim() || 'reproductor',
        textWidth: text.width,
        textHeight: text.height,
        boxWidth: box.width,
        rowHeight: row.height,
        scrollWidth: el.scrollWidth,
        clientWidth: el.clientWidth,
        textRight: text.right,
        columnRight: column.right,
        rowBottom: row.bottom,
      };
    });
    return { rows, viewportHeight: window.innerHeight };
  });
}

test.describe('Layout', () => {
  test.skip(({ viewport }) => isMobileViewport(viewport), 'Cambia el tamaño desde el proyecto de escritorio');

  for (const size of MENU_SIZES) {
    test(`el menú no desborda en ${size.width}×${size.height}`, async ({ page }) => {
      await page.setViewportSize(size);
      await page.goto('/');
      if (size.width < 1024) await openMobileMenu(page);

      const { rows, viewportHeight } = await measureRows(page);
      expect(rows).toHaveLength(6);
      for (const row of rows) {
        const label = `${row.name} @ ${size.width}×${size.height}`;
        expect(row.scrollWidth, label).toBeLessThanOrEqual(row.clientWidth);
        expect(row.textWidth, label).toBeLessThanOrEqual(row.boxWidth + 0.5);
        expect(row.textRight, label).toBeLessThanOrEqual(row.columnRight);
        expect(row.textHeight, label).toBeLessThanOrEqual(row.rowHeight);
      }
      // Las seis filas caben en la altura de la ventana.
      const lastBottom = Math.max(...rows.map((r) => r.rowBottom));
      expect(lastBottom).toBeLessThanOrEqual(viewportHeight);
      // Todas las filas miden lo mismo (la del reproductor incluida).
      const heights = rows.map((r) => r.rowHeight);
      expect(Math.max(...heights) - Math.min(...heights)).toBeLessThan(0.5);
    });
  }

  for (const size of [
    { width: 1440, height: 900 },
    { width: 1025, height: 700 },
  ]) {
    test(`la división está exactamente al 50 % en ${size.width}×${size.height}`, async ({ page }) => {
      await page.setViewportSize(size);
      await page.goto('/');
      const metrics = await page.evaluate(() => {
        const left = document.getElementById('left')!.getBoundingClientRect();
        const panel = document.getElementById('panel')!;
        const panelBox = panel.getBoundingClientRect();
        const style = getComputedStyle(panel);
        return {
          viewport: document.documentElement.clientWidth,
          leftX: left.x,
          leftWidth: left.width,
          panelX: panelBox.x,
          panelWidth: panelBox.width,
          panelHeight: panelBox.height,
          overflowY: style.overflowY,
          scrollbarWidth: style.scrollbarWidth,
          docScrolls: document.documentElement.scrollHeight > window.innerHeight,
        };
      });
      expect(metrics.leftX).toBe(0);
      expect(Math.abs(metrics.leftWidth - metrics.viewport / 2)).toBeLessThanOrEqual(0.5);
      expect(Math.abs(metrics.panelX - metrics.viewport / 2)).toBeLessThanOrEqual(0.5);
      expect(Math.abs(metrics.panelWidth - metrics.viewport / 2)).toBeLessThanOrEqual(0.5);
      expect(metrics.panelHeight).toBe(size.height);
      expect(metrics.overflowY).toBe('auto');
      expect(metrics.scrollbarWidth).toBe('none');
      expect(metrics.docScrolls).toBe(false);
    });
  }

  test('el panel derecho hace scroll por su cuenta', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 600 });
    await page.goto('/');
    const panel = page.locator('#panel');
    const scrollable = await panel.evaluate((el) => el.scrollHeight > el.clientHeight);
    expect(scrollable).toBe(true);
    await panel.hover();
    await page.mouse.wheel(0, 400);
    await expect.poll(() => panel.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
    // La columna izquierda y la ventana no se mueven.
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
    expect(await page.locator('#left').evaluate((el) => el.getBoundingClientRect().top)).toBe(0);
  });

  test('la transición dura 0,5 s y el panel entra por debajo del menú', async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => {
      const w = window as unknown as { __vt: unknown[] };
      w.__vt = [];
      const original = document.startViewTransition.bind(document);
      document.startViewTransition = ((arg: Parameters<typeof original>[0]) => {
        const transition = original(arg);
        void transition.ready.then(() => {
          const root = document.documentElement;
          w.__vt.push({
            animations: document.getAnimations().map((a) => {
              const effect = a.effect as KeyframeEffect | null;
              return { pseudo: effect?.pseudoElement ?? null, duration: effect?.getTiming().duration ?? null };
            }),
            zLeft: getComputedStyle(root, '::view-transition-group(left-column)').zIndex,
            zPanel: getComputedStyle(root, '::view-transition-group(panel)').zIndex,
            zOverlay: getComputedStyle(root, '::view-transition-group(pixel-overlay)').zIndex,
          });
        });
        return transition;
      }) as typeof document.startViewTransition;
    });

    await page.getByRole('navigation', { name: 'Secciones' }).getByRole('link', { name: 'next dates' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-section', 'next');

    const records = await page.evaluate(() => (window as unknown as { __vt: unknown[] }).__vt);
    expect(records).toHaveLength(1);
    const record = records[0] as {
      animations: { pseudo: string | null; duration: number | string | null }[];
      zLeft: string;
      zPanel: string;
      zOverlay: string;
    };
    const slide = record.animations.find((a) => a.pseudo === '::view-transition-new(panel)');
    expect(slide, JSON.stringify(record.animations)).toBeDefined();
    expect(slide!.duration).toBe(500);
    expect(Number(record.zLeft)).toBeGreaterThan(Number(record.zPanel));
    expect(Number(record.zOverlay)).toBeGreaterThan(Number(record.zLeft));
    // Nada más se anima: ni el menú ni la raíz parpadean.
    const others = record.animations.filter((a) => a.pseudo && a.pseudo !== '::view-transition-new(panel)');
    expect(others, JSON.stringify(others)).toHaveLength(0);
  });

  test('sin movimiento con prefers-reduced-motion', async ({ browser }) => {
    const context = await browser.newContext({ reducedMotion: 'reduce', viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    await page.goto('/');
    const track = page.locator('.ticker__track');
    await expect(track).toHaveCSS('animation-name', 'none');
    expect(await track.evaluate((el) => el.getAnimations().length)).toBe(0);
    await context.close();
  });

  test('la barra de noticias se mueve y se pausa al pasar el ratón', async ({ page }) => {
    await page.goto('/');
    const track = page.locator('.ticker__track');
    expect(await track.evaluate((el) => el.getAnimations().length)).toBe(1);
    await expect(track).toHaveCSS('animation-play-state', 'running');
    await page.locator('[data-ticker]').hover();
    await expect(track).toHaveCSS('animation-play-state', 'paused');
    // Las dos copias son idénticas y cada una es más alta que la ventana.
    const copies = await page.locator('.ticker__copy').evaluateAll((els) =>
      els.map((el) => ({ text: el.textContent, height: el.getBoundingClientRect().height })),
    );
    expect(copies).toHaveLength(2);
    expect(copies[0]!.text).toBe(copies[1]!.text);
    expect(copies[0]!.height).toBeGreaterThanOrEqual(900);
  });

  test('JS inicial ≤ 50 KB gzip', async ({ page }) => {
    const scripts = new Map<string, number>();
    page.on('response', async (response) => {
      if (response.request().resourceType() !== 'script') return;
      try {
        const body = await response.body();
        scripts.set(response.url(), gzipSync(body, { level: 9 }).length);
      } catch {
        // Respuestas sin cuerpo (redirecciones, etc.).
      }
    });
    await page.goto('/', { waitUntil: 'networkidle' });
    // Astro incrusta en el HTML los scripts pequeños: también cuentan.
    const inline = await page.evaluate(() =>
      [...document.querySelectorAll('script:not([src])')]
        .filter((s) => !s.getAttribute('type') || s.getAttribute('type') === 'module')
        .map((s) => s.textContent ?? ''),
    );
    const inlineSize = inline.reduce((sum, code) => sum + gzipSync(code, { level: 9 }).length, 0);
    const external = [...scripts.values()].reduce((sum, size) => sum + size, 0);
    const total = external + inlineSize;
    testLog(
      `JS inicial: ${(total / 1024).toFixed(1)} KB gzip (${scripts.size} archivos + ${inline.length} scripts en línea)`,
    );
    expect(scripts.size).toBeGreaterThan(0);
    expect(total).toBeLessThanOrEqual(50 * 1024);
  });

  test('la negrita solo aparece en el menú y en el reproductor', async ({ page }) => {
    for (const section of SECTION_CASES) {
      await page.goto(section.path);
      const offenders = await page.evaluate(() => {
        const allowed = 'nav[aria-label="Secciones"], mix-player, .event__name';
        const bad: string[] = [];
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
          const text = node.textContent?.trim();
          const parent = node.parentElement;
          if (!text || !parent || parent.closest('script, style, [aria-hidden="true"]')) continue;
          const weight = Number(getComputedStyle(parent).fontWeight);
          if (weight >= 600 && !parent.closest(allowed)) bad.push(`${parent.tagName}: ${text.slice(0, 40)}`);
        }
        return bad;
      });
      expect(offenders, section.path).toEqual([]);
    }
  });
});

function testLog(message: string): void {
  test.info().annotations.push({ type: 'info', description: message });
  console.log(message);
}
