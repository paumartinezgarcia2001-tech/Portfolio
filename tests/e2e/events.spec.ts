import { expect, test, type Page } from '@playwright/test';
import { isMobileViewport } from './helpers';

/**
 * Fase 2 · listas de bolos (C13, C14 y C16).
 * La web se compila con `DATA_SOURCE=fixtures` (ver playwright.config.ts).
 */

const dates = (page: Page) => page.locator('.event__date');

test.describe('Next dates', () => {
  test('ordena las fechas de la más próxima a la más lejana', async ({ page }) => {
    await page.goto('/next-dates');
    const iso = await dates(page).evaluateAll((els) => els.map((el) => el.getAttribute('datetime') ?? ''));
    expect(iso.length).toBeGreaterThan(1);
    expect([...iso]).toEqual([...iso].sort());
  });

  test('muestra la fecha en formato DD MES AAAA y con subrayado del acento', async ({ page }) => {
    await page.goto('/next-dates');
    const first = dates(page).first();
    await expect(first).toHaveText('30 SEPTIEMBRE 2099');
    await expect(first).toHaveAttribute('datetime', '2099-09-30');
    await expect(first).toHaveCSS('text-decoration-line', 'underline');
    await expect(first).toHaveCSS('text-decoration-color', 'rgb(0, 255, 255)');
    const thickness = await first.evaluate((el) => parseFloat(getComputedStyle(el).textDecorationThickness));
    expect(thickness).toBeGreaterThanOrEqual(3);
  });

  test('sin nombre de fiesta y sin lineup se muestra TBA', async ({ page }) => {
    await page.goto('/next-dates');
    const item = page.locator('.events__item', { has: page.getByText('LA2, Sevilla') });
    await expect(item.locator('.event__name')).toHaveText('TBA');
    await expect(item.locator('.event__lineup')).toHaveText('TBA');
  });

  test('el nombre de la fiesta va en mayúsculas y en negrita, y solo se subraya en archive', async ({ page }) => {
    await page.goto('/next-dates');
    const name = page.locator('.event__name').first();
    await expect(name).toHaveCSS('font-weight', '700');
    await expect(name).toHaveCSS('text-transform', 'uppercase');
    await expect(name).toHaveCSS('text-decoration-line', 'none');
    // La sala y el lineup no van en negrita.
    await expect(page.locator('.event__place').first()).toHaveCSS('font-weight', '400');
    await expect(page.locator('.event__lineup').first()).toHaveCSS('font-weight', '400');
  });

  test('cada bolo publica su JSON-LD MusicEvent', async ({ page }) => {
    await page.goto('/next-dates');
    const events = await page.locator('script[type="application/ld+json"]').evaluateAll((els) =>
      els.map((el) => JSON.parse(el.textContent ?? '{}')),
    );
    const musicEvents = events.filter((e) => e['@type'] === 'MusicEvent');
    expect(musicEvents.length).toBe(await page.locator('.events__item').count());
    expect(musicEvents[0]).toMatchObject({
      '@type': 'MusicEvent',
      startDate: '2099-09-30',
      location: { '@type': 'Place', name: 'SIROCO', address: { addressLocality: 'Madrid', addressCountry: 'ES' } },
    });
  });
});

test.describe('Archive', () => {
  test('ordena de la más reciente a la más antigua y subraya el nombre', async ({ page }) => {
    await page.goto('/archive');
    const iso = await dates(page).evaluateAll((els) => els.map((el) => el.getAttribute('datetime') ?? ''));
    expect(iso.length).toBeGreaterThan(1);
    expect([...iso]).toEqual([...iso].sort().reverse());

    const name = page.locator('.event__name').first();
    await expect(name).toHaveCSS('text-decoration-line', 'underline');
    await expect(name).toHaveCSS('text-decoration-color', 'rgb(0, 255, 0)');
    await expect(dates(page).first()).toHaveCSS('text-decoration-color', 'rgb(0, 255, 0)');
  });
});

test.describe('Maquetación de los bolos', () => {
  test('sin separación entre eventos', async ({ page }) => {
    await page.goto('/archive');
    const gaps = await page.locator('.events__item').evaluateAll((items) => {
      const list = items[0]?.parentElement;
      const listStyle = list ? getComputedStyle(list) : null;
      const boxes = items.map((el) => el.getBoundingClientRect());
      const between = boxes.slice(1).map((box, i) => box.top - (boxes[i]?.bottom ?? 0));
      const margins = items.map((el) => {
        const s = getComputedStyle(el);
        return [s.marginTop, s.marginBottom, s.borderTopWidth, s.borderBottomWidth].join(' ');
      });
      return { rowGap: listStyle?.rowGap, between, margins };
    });
    expect(gaps.rowGap === '0px' || gaps.rowGap === 'normal').toBe(true);
    for (const gap of gaps.between) expect(Math.abs(gap)).toBeLessThan(0.5);
    for (const margin of gaps.margins) expect(margin).toBe('0px 0px 0px 0px');
  });

  for (const size of [
    { width: 1024, height: 600 },
    { width: 1440, height: 900 },
    { width: 2560, height: 1440 },
    { width: 375, height: 812 },
  ]) {
    test(`la fecha más larga cabe en una línea en ${size.width}×${size.height}`, async ({ page }) => {
      await page.setViewportSize(size);
      await page.goto('/next-dates');
      const metrics = await dates(page)
        .first()
        .evaluate((el) => {
          const style = getComputedStyle(el);
          const range = document.createRange();
          range.selectNodeContents(el);
          const rects = range.getClientRects();
          return {
            text: el.textContent,
            lines: rects.length,
            width: el.scrollWidth,
            available: el.clientWidth,
            fontSize: parseFloat(style.fontSize),
          };
        });
      expect(metrics.text).toBe('30 SEPTIEMBRE 2099');
      expect(metrics.lines).toBe(1);
      expect(metrics.width).toBeLessThanOrEqual(metrics.available);
      expect(metrics.fontSize).toBeGreaterThan(14);
    });
  }

  test('el lineup va a la derecha en escritorio y debajo en móvil', async ({ page }, testInfo) => {
    await page.goto('/archive');
    const positions = await page.locator('.events__item').first().evaluate((item) => {
      const main = item.querySelector('.event__main')!.getBoundingClientRect();
      const lineup = item.querySelector('.event__lineup')!.getBoundingClientRect();
      return {
        mainRight: main.right,
        mainBottom: main.bottom,
        mainTop: main.top,
        lineupLeft: lineup.left,
        lineupTop: lineup.top,
      };
    });
    if (isMobileViewport(testInfo.project.use.viewport)) {
      expect(positions.lineupTop).toBeGreaterThanOrEqual(positions.mainBottom - 1);
    } else {
      expect(positions.lineupLeft).toBeGreaterThanOrEqual(positions.mainRight);
      // Alineado arriba, a la altura de la fecha.
      expect(Math.abs(positions.lineupTop - positions.mainTop)).toBeLessThan(40);
    }
  });
});

test.describe('Barra de noticias con datos', () => {
  test('añade la próxima fecha al texto de los ajustes', async ({ page }) => {
    await page.goto('/');
    // textContent: en móvil la barra está dentro de la capa del menú, oculta.
    const text = (await page.locator('[data-ticker] .visually-hidden').textContent()) ?? '';
    expect(text).toContain('travest15m0 · DJ · Madrid');
    expect(text).toContain('PRÓXIMA FECHA: 30 SEPTIEMBRE 2099 · SIROCO, Madrid');
  });
});

test.describe('API', () => {
  test('/api/health responde 200 y no se cachea', async ({ request }) => {
    const response = await request.get('/api/health');
    expect(response.status()).toBe(200);
    expect(response.headers()['cache-control']).toContain('no-store');
    expect(await response.json()).toMatchObject({ ok: true });
  });

  test('las secciones públicas se cachean 60 s con etiquetas', async ({ request }) => {
    const response = await request.get('/next-dates');
    expect(response.headers()['cloudflare-cdn-cache-control']).toContain('max-age=60');
    expect(response.headers()['cache-tag']).toContain('gigs');
  });
});
