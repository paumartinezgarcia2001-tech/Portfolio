import { expect, test, type Page } from '@playwright/test';
import {
  SECTION_CASES,
  audioInfo,
  blockSoundWithoutInteraction,
  ensureMusic,
  expectMusicPlaying,
  isMobile,
  isMobileViewport,
  markNode,
  menuLink,
  openMobileMenu,
  player,
  readMark,
  showMobilePage,
} from './helpers';

/**
 * C06 · Reproductor de mixes (fase 4, D43) con los mixes de prueba de
 * `tests/e2e/global-setup.ts` (tonos de 20 s en MP3), servidos por
 * scripts/serve-media.mjs como si fuera R2.
 *
 * Los navegadores de los e2e dejan sonar sin haber tocado la página (como
 * Chrome en una web que ya se conoce: playwright.config.ts); el bloqueo de la
 * primera visita se simula con blockSoundWithoutInteraction. Donde no se puede
 * quitar el bloqueo (WebKit), ensureMusic pulsa «Reproducir».
 */

const button = (page: Page, name: string) => player(page).getByRole('button', { name, exact: true });

async function currentMix(page: Page): Promise<string | undefined> {
  return (await audioInfo(page)).mix;
}

async function seek(page: Page, seconds: number | 'end'): Promise<void> {
  await page.evaluate((to) => {
    const audio = document.querySelector<HTMLAudioElement>('mix-player audio')!;
    audio.currentTime = to === 'end' ? audio.duration - 0.4 : to;
  }, seconds);
}

test.describe('Reproductor', () => {
  test.skip(Boolean(process.env.E2E_BASE_URL), 'Usa los mixes de prueba y el servidor local de .media');
  test.skip(process.env.E2E_MEDIA !== 'ok', `Sin mixes de prueba: ${process.env.E2E_MEDIA ?? 'sin preparar'}`);

  test('suena nada más abrir la web, con solo tres botones en el centro (D43)', async ({ page, browserName }) => {
    test.skip(browserName === 'webkit', 'WebKit no deja quitar el bloqueo del autoplay');
    await page.goto('/');
    // Sin tocar nada (el autoplay está permitido en los e2e: playwright.config.ts).
    const info = await expectMusicPlaying(page);
    expect(info.count).toBe(1);
    expect(info.src).toMatch(/\/mixes\/e2e-mix-[123]\.mp3$/);

    const region = player(page);
    await expect(region.getByRole('button')).toHaveCount(3);
    for (const name of ['Mix anterior', 'Pausar', 'Mix siguiente']) await expect(button(page, name)).toBeVisible();
    // Nada más a la vista: ni título, ni tiempos, ni barra de progreso.
    expect((await region.innerText()).trim()).toBe('');
    await expect(region.locator('input, progress, [role="slider"]')).toHaveCount(0);

    // Anterior · reproducir/pausar · siguiente, centrados en la fila.
    const layout = await region.evaluate((el) => {
      const row = el.getBoundingClientRect();
      const boxes = [...el.querySelectorAll('button')].map((b) => b.getBoundingClientRect());
      return {
        rowCenter: row.left + row.width / 2,
        groupCenter: (boxes[0]!.left + boxes[2]!.right) / 2,
        toggleCenter: boxes[1]!.left + boxes[1]!.width / 2,
        order: boxes.map((b) => b.left),
        smallest: Math.min(...boxes.map((b) => Math.min(b.width, b.height))),
      };
    });
    expect(Math.abs(layout.groupCenter - layout.rowCenter)).toBeLessThan(1);
    expect(Math.abs(layout.toggleCenter - layout.rowCenter)).toBeLessThan(1);
    expect(layout.order).toEqual([...layout.order].sort((a, b) => a - b));
    // Zona táctil de al menos 44 × 44 px (§10).
    expect(layout.smallest).toBeGreaterThanOrEqual(44);
  });

  test('si el navegador no deja sonar, empieza con el primer toque en cualquier parte', async ({ page }, testInfo) => {
    await blockSoundWithoutInteraction(page);
    await page.goto('/');
    await expect(player(page)).toHaveAttribute('data-state', 'paused');
    await expect(player(page)).toHaveAttribute('data-autoplay', 'waiting');
    await expect(button(page, 'Reproducir')).toBeVisible();
    expect((await audioInfo(page)).paused).toBe(true);

    if (isMobile(testInfo)) {
      // En móvil lo normal es tocar el menú: suena y navega a la vez.
      await menuLink(page, 'next dates').click();
      await expect(page).toHaveURL(/\/next-dates\/?$/);
    } else {
      await page.locator('#panel').click({ position: { x: 30, y: 30 } });
    }
    await expectMusicPlaying(page);
    await expect(player(page)).toHaveAttribute('data-autoplay', '');
  });

  test('pausar y reanudar con el botón del centro', async ({ page }) => {
    await page.goto('/');
    await ensureMusic(page);
    await button(page, 'Pausar').click();
    await expect(player(page)).toHaveAttribute('data-state', 'paused');
    const paused = await audioInfo(page);
    expect(paused.paused).toBe(true);
    await page.waitForTimeout(400);
    expect((await audioInfo(page)).time).toBe(paused.time);

    await button(page, 'Reproducir').click();
    const resumed = await expectMusicPlaying(page);
    expect(resumed.mix).toBe(paused.mix);
    expect(resumed.time).toBeGreaterThan(paused.time);
  });

  test('siguiente y anterior cambian de canción; en la primera, «anterior» vuelve a empezar', async ({ page }) => {
    await page.goto('/');
    const first = await ensureMusic(page);

    await button(page, 'Mix siguiente').click();
    await expect.poll(() => currentMix(page)).not.toBe(first.mix);
    const second = await expectMusicPlaying(page);
    await button(page, 'Mix siguiente').click();
    await expect.poll(() => currentMix(page)).not.toBe(second.mix);
    const third = await expectMusicPlaying(page);
    // Una vuelta entera sin repetir.
    expect(new Set([first.mix, second.mix, third.mix]).size).toBe(3);

    await button(page, 'Mix anterior').click();
    await expect.poll(() => currentMix(page)).toBe(second.mix);
    await button(page, 'Mix anterior').click();
    await expect.poll(() => currentMix(page)).toBe(first.mix);
    await expectMusicPlaying(page);

    // En la primera no hay anterior: vuelve al principio de la misma.
    await seek(page, 6);
    await expect.poll(async () => (await audioInfo(page)).time).toBeGreaterThan(6);
    await button(page, 'Mix anterior').click();
    await expect.poll(async () => (await audioInfo(page)).time).toBeLessThan(3);
    expect(await currentMix(page)).toBe(first.mix);
    await expectMusicPlaying(page);
  });

  test('al terminar una canción pasa sola a la siguiente', async ({ page }) => {
    await page.goto('/');
    const first = await ensureMusic(page);
    await seek(page, 'end');
    await expect.poll(() => currentMix(page), { timeout: 5_000 }).not.toBe(first.mix);
    await expectMusicPlaying(page);
  });

  test('si un archivo falla, lo reintenta una vez y lo salta', async ({ page }) => {
    const attempts = new Map<string, number>();
    const warnings: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'warning') warnings.push(message.text());
    });
    // Los mixes 1 y 2 no existen; solo el 3 se puede escuchar.
    await page.route(/\/mixes\/e2e-mix-[12]\.mp3$/, (route) => {
      const name = new URL(route.request().url()).pathname.split('/').pop()!;
      attempts.set(name, (attempts.get(name) ?? 0) + 1);
      return route.fulfill({ status: 404, contentType: 'text/plain', body: 'No existe' });
    });

    await page.goto('/');
    await ensureMusic(page);
    await expect.poll(() => currentMix(page), { timeout: 15_000 }).toBe('fixture-mix-3');
    await expectMusicPlaying(page);

    // Al pasar al siguiente, prueba los rotos (dos veces cada uno) y vuelve al bueno.
    await button(page, 'Mix siguiente').click();
    await expect.poll(() => attempts.get('e2e-mix-1.mp3') ?? 0, { timeout: 15_000 }).toBeGreaterThanOrEqual(2);
    await expect.poll(() => attempts.get('e2e-mix-2.mp3') ?? 0, { timeout: 15_000 }).toBeGreaterThanOrEqual(2);
    await expect.poll(() => currentMix(page), { timeout: 15_000 }).toBe('fixture-mix-3');
    await expectMusicPlaying(page);
    expect(warnings.some((text) => text.includes('se reintenta'))).toBe(true);
    expect(warnings.some((text) => text.includes('se salta'))).toBe(true);
  });

  test('si no se puede reproducir ninguno, se queda en error y «Reproducir» lo vuelve a intentar', async ({ page }) => {
    let broken = true;
    await page.route(/\/mixes\/e2e-mix-\d\.mp3$/, (route) =>
      broken ? route.fulfill({ status: 404, body: 'No existe' }) : route.fallback(),
    );
    await page.goto('/');
    await expect(player(page)).toHaveAttribute('data-state', 'error', { timeout: 15_000 });
    await expect(button(page, 'Reproducir')).toBeVisible();

    broken = false;
    await button(page, 'Reproducir').click();
    await expectMusicPlaying(page);
  });

  test('la música no se corta al navegar: mismo <audio> y el tiempo sigue avanzando', async ({ page }, testInfo) => {
    const mobile = isMobile(testInfo);
    await page.goto('/');
    await ensureMusic(page);
    await markNode(page, 'mix-player audio', 'persist');

    let last = await audioInfo(page);
    const route = [...SECTION_CASES.slice(1), SECTION_CASES[0]!];
    for (const section of route) {
      if (mobile) await openMobileMenu(page);
      await menuLink(page, section.label).click();
      await expect(page.locator('html')).toHaveAttribute('data-section', section.key);

      // Es el mismo nodo (no se ha recreado) y sigue sonando (también en Media: D42).
      expect(await readMark(page, 'mix-player audio'), section.key).toBe('persist');
      const now = await audioInfo(page);
      expect(now.count, section.key).toBe(1);
      expect(now.paused, section.key).toBe(false);
      if (now.mix === last.mix) expect(now.time, section.key).toBeGreaterThan(last.time);
      last = now;
    }
    await expectMusicPlaying(page);
  });

  test('Media Session: título, artista y estado para la pantalla de bloqueo', async ({ page }) => {
    await page.goto('/');
    await ensureMusic(page);
    const session = await page.evaluate(() => ({
      title: navigator.mediaSession.metadata?.title,
      artist: navigator.mediaSession.metadata?.artist,
      album: navigator.mediaSession.metadata?.album,
      state: navigator.mediaSession.playbackState,
    }));
    expect(session).toMatchObject({ artist: 'travest15m0', album: 'tests', state: 'playing' });
    expect(session.title).toMatch(/^Mix de prueba [123]$/);

    await button(page, 'Pausar').click();
    await expect.poll(() => page.evaluate(() => navigator.mediaSession.playbackState)).toBe('paused');
  });

  test('anuncia la canción a los lectores de pantalla solo tras una acción', async ({ page }) => {
    await page.goto('/');
    await ensureMusic(page);
    const live = player(page).locator('[aria-live="polite"]');
    await expect(live).toHaveText('');
    await button(page, 'Mix siguiente').click();
    await expect(live).toHaveText(/^Reproduciendo: Mix de prueba [123]$/);
  });

  test('al recargar sigue la misma canción por donde iba', async ({ page }) => {
    await page.goto('/');
    const before = await ensureMusic(page);
    await seek(page, 6);
    await expect.poll(async () => (await audioInfo(page)).time).toBeGreaterThan(6);
    await page.reload();
    const after = await expectMusicPlaying(page);
    expect(after.mix).toBe(before.mix);
    expect(after.time).toBeGreaterThanOrEqual(6);
  });

  test('si se había pausado, al recargar no arranca sola (y sigue por donde iba)', async ({ page }) => {
    await page.goto('/');
    const before = await ensureMusic(page);
    await seek(page, 8);
    await expect.poll(async () => (await audioInfo(page)).time).toBeGreaterThan(8);
    await button(page, 'Pausar').click();
    await expect(player(page)).toHaveAttribute('data-state', 'paused');

    await page.reload();
    await expect(player(page)).toHaveAttribute('data-state', 'paused');
    await page.waitForTimeout(600);
    const info = await audioInfo(page);
    expect(info.paused).toBe(true);
    expect(info.mix).toBe(before.mix);

    await button(page, 'Reproducir').click();
    const resumed = await expectMusicPlaying(page);
    expect(resumed.time).toBeGreaterThanOrEqual(8);
  });

  test('con Save-Data no arranca sola', async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'connection', { configurable: true, value: { saveData: true } });
    });
    await page.goto('/');
    await expect(player(page)).toHaveAttribute('data-state', 'idle');
    await page.waitForTimeout(500);
    expect((await audioInfo(page)).paused).toBe(true);
    await button(page, 'Reproducir').click();
    await expectMusicPlaying(page);
  });

  test.describe('móvil', () => {
    test.skip(({ viewport }) => !isMobileViewport(viewport), 'Solo móvil');

    test('fila en el menú, mini-barra fija en la página, y siempre el mismo <audio>', async ({ page }) => {
      await page.goto('/');
      await ensureMusic(page);
      await markNode(page, 'mix-player audio', 'mismo');
      const box = () =>
        player(page).evaluate((el) => {
          const r = el.getBoundingClientRect();
          return { top: r.top, bottom: r.bottom, width: r.width, height: r.height, position: getComputedStyle(el).position };
        });

      // En el menú (donde arranca el móvil, D44): la sexta fila.
      const row = await box();
      expect(row.position).not.toBe('fixed');
      const lastLink = await menuLink(page, 'contact').evaluate((el) => el.closest('li')!.getBoundingClientRect().bottom);
      expect(Math.abs(row.top - lastLink)).toBeLessThan(1);

      // En la página: barra fija abajo, de lado a lado.
      await showMobilePage(page);
      await expect(player(page)).toBeVisible();
      const bar = await box();
      expect(bar.position).toBe('fixed');
      expect(Math.abs(bar.bottom - 812)).toBeLessThan(1);
      expect(Math.abs(bar.width - 375)).toBeLessThan(1);
      expect(Math.abs(bar.height - 56)).toBeLessThan(1);
      for (const name of ['Mix anterior', 'Pausar', 'Mix siguiente']) await expect(button(page, name)).toBeVisible();
      // El final del contenido no queda tapado.
      const padding = await page.locator('#panel').evaluate((el) => parseFloat(getComputedStyle(el).paddingBottom));
      expect(padding).toBeGreaterThanOrEqual(56);

      // La barra controla el mismo <audio>.
      await button(page, 'Pausar').click();
      await expect(player(page)).toHaveAttribute('data-state', 'paused');
      const paused = await audioInfo(page);
      expect(paused.paused).toBe(true);
      expect(paused.count).toBe(1);
      expect(await readMark(page, 'mix-player audio')).toBe('mismo');

      // Al volver al menú, otra vez la fila, en pausa.
      await openMobileMenu(page);
      expect((await box()).position).not.toBe('fixed');
      await expect(button(page, 'Reproducir')).toBeVisible();
      await button(page, 'Reproducir').click();
      await expectMusicPlaying(page);
      expect(await readMark(page, 'mix-player audio')).toBe('mismo');
    });
  });
});
