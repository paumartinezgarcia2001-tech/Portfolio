import { expect, test, type Page } from '@playwright/test';
import {
  audioInfo,
  blockSoundWithoutInteraction,
  expectMusicPlaying,
  isMobileViewport,
  menuLink,
  openMobileMenu,
  player,
  showMobilePage,
  withMusicPaused,
} from './helpers';

/**
 * C15 · Media con el vídeo de prueba de `tests/e2e/global-setup.ts`
 * (AV1 + Opus, servido por scripts/serve-media.mjs como si fuera R2).
 */

const MEDIA_ORIGIN = `http://localhost:${process.env.E2E_MEDIA_PORT ?? 4322}`;
const FIXTURE_CODECS = 'video/mp4; codecs="av01.0.01M.08,opus"';

interface VideoInfo {
  state: string | undefined;
  paused: boolean;
  muted: boolean;
  time: number;
  frames: number;
  stats: { elements: number; hls: number } | undefined;
}

async function videoInfo(page: Page): Promise<VideoInfo> {
  return page.evaluate(() => {
    const element = document.querySelector<HTMLElement>('media-video');
    const video = element?.querySelector<HTMLVideoElement>('video[data-video]');
    const ctor = customElements.get('media-video') as unknown as { stats?: { elements: number; hls: number } } | undefined;
    return {
      state: element?.dataset.state,
      paused: video?.paused ?? true,
      muted: video?.muted ?? true,
      time: video?.currentTime ?? 0,
      frames: video?.getVideoPlaybackQuality().totalVideoFrames ?? 0,
      stats: ctor?.stats,
    };
  });
}

async function expectPlaying(page: Page): Promise<void> {
  await expect(page.locator('media-video')).toHaveAttribute('data-state', 'playing', { timeout: 10_000 });
  await expect(page.locator('media-video')).toHaveAttribute('data-ready', '');
}

/**
 * El <video> que está en la página es el que avanza (no basta con que suene:
 * uno fuera del DOM también suena, y en pantalla solo se ve el póster).
 */
async function expectVideoOnPage(page: Page): Promise<void> {
  const first = await videoInfo(page);
  await expect.poll(async () => (await videoInfo(page)).time, { timeout: 5_000 }).toBeGreaterThan(first.time + 0.3);
  const later = await videoInfo(page);
  expect(later.paused).toBe(false);
  expect(later.frames).toBeGreaterThan(first.frames);
}

/** ¿Puede este navegador reproducir el vídeo de prueba? (WebKit en Linux/Windows, a veces no.) */
async function canPlayFixture(page: Page): Promise<boolean> {
  return page.evaluate((type) => 'MediaSource' in window && MediaSource.isTypeSupported(type), FIXTURE_CODECS);
}

/** Apunta los `media:sound-on` desde que se crea la página (sobrevive a la navegación del menú). */
async function watchSoundOn(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as { __soundOn: unknown[] };
    w.__soundOn = [];
    document.addEventListener('media:sound-on', (event) => w.__soundOn.push((event as CustomEvent).detail));
  });
}

function soundOnEvents(page: Page): Promise<unknown[]> {
  return page.evaluate(() => (window as unknown as { __soundOn: unknown[] }).__soundOn);
}

test.describe('Media', () => {
  test.skip(Boolean(process.env.E2E_BASE_URL), 'Usa el vídeo de prueba y el servidor local de .media');
  test.skip(process.env.E2E_MEDIA !== 'ok', `Sin vídeo de prueba: ${process.env.E2E_MEDIA ?? 'sin preparar'}`);

  test.describe('sin bandas', () => {
    test.skip(({ viewport }) => isMobileViewport(viewport), 'Cambia el tamaño desde el proyecto de escritorio');

    for (const size of [
      { width: 1024, height: 600, rendition: '4x5' },
      { width: 1440, height: 900, rendition: '4x5' },
      { width: 2560, height: 1440, rendition: '4x5' },
      { width: 375, height: 812, rendition: '9x16' },
    ]) {
      test(`el vídeo cubre el panel en ${size.width}×${size.height} (${size.rendition})`, async ({ page }) => {
        const masters: string[] = [];
        page.on('request', (request) => {
          if (request.url().endsWith('/master.m3u8')) masters.push(request.url());
        });
        await page.setViewportSize(size);
        await page.goto('/media');
        test.skip(!(await canPlayFixture(page)), 'Este navegador no reproduce AV1 + Opus');
        // En móvil las secciones abren en el menú (D44): se cierra para ver el vídeo.
        await showMobilePage(page);
        await expectPlaying(page);

        const boxes = await page.evaluate(() => {
          const panel = document.getElementById('panel')!.getBoundingClientRect();
          const video = document.querySelector<HTMLVideoElement>('media-video video[data-video]')!;
          const box = video.getBoundingClientRect();
          const bar = document.querySelector('mix-player')!.getBoundingClientRect();
          const mobile = !window.matchMedia('(min-width: 1024px)').matches;
          // En móvil, la mini-barra del reproductor ocupa el final de la pantalla (C06).
          const bottom = mobile ? bar.top : panel.bottom;
          return {
            panel: [panel.x, panel.y, panel.width, bottom - panel.y],
            video: [box.x, box.y, box.width, box.height],
            fit: getComputedStyle(video).objectFit,
            intrinsic: video.videoWidth / video.videoHeight,
          };
        });
        // Mismo rectángulo que el panel (menos la mini-barra, en móvil) y
        // `cover`: el vídeo lo llena entero.
        boxes.video.forEach((value, i) => expect(Math.abs(value - boxes.panel[i]!)).toBeLessThanOrEqual(0.5));
        expect(boxes.fit).toBe('cover');
        expect(boxes.intrinsic).toBeGreaterThan(0);
        // Versión 4:5 o 9:16 según la proporción del panel.
        expect(masters).toHaveLength(1);
        expect(masters[0]).toContain(`/${size.rendition}/master.m3u8`);
      });
    }
  });

  test('con la música en pausa, llegando desde el menú arranca con sonido (D42) y el vídeo avanza', async ({ page }, testInfo) => {
    // La persona ha pausado la música (si no, el vídeo arranca silenciado: D42).
    await withMusicPaused(page);
    await watchSoundOn(page);
    await page.goto('/');
    test.skip(!(await canPlayFixture(page)), 'Este navegador no reproduce AV1 + Opus');
    if (isMobileViewport(testInfo.project.use.viewport)) await openMobileMenu(page);
    await menuLink(page, 'media').click();
    await expectPlaying(page);

    const sound = page.getByRole('button', { name: 'sonido', exact: true });
    const first = await videoInfo(page);
    expect(first.muted).toBe(false);
    await expect(sound).toHaveAttribute('aria-pressed', 'true');
    await expect.poll(() => soundOnEvents(page)).toEqual([{ slug: 'e2e-fixture' }]);

    await expect.poll(async () => (await videoInfo(page)).time, { timeout: 5_000 }).toBeGreaterThan(first.time + 0.5);
    const later = await videoInfo(page);
    expect(later.frames).toBeGreaterThan(first.frames);
    expect(later.paused).toBe(false);

    // Si la música vuelve a sonar (player:play), el vídeo se silencia.
    await player(page).getByRole('button', { name: 'Reproducir' }).click();
    await expectMusicPlaying(page);
    await expect(sound).toHaveAttribute('aria-pressed', 'false');
    expect((await videoInfo(page)).muted).toBe(true);
  });

  test('si el navegador no deja arrancar con sonido, arranca silenciado y «sonido» lo activa', async ({ page }) => {
    await blockSoundWithoutInteraction(page);
    await watchSoundOn(page);
    await page.goto('/media');
    test.skip(!(await canPlayFixture(page)), 'Este navegador no reproduce AV1 + Opus');
    await showMobilePage(page);
    await expectPlaying(page);

    const sound = page.getByRole('button', { name: 'sonido', exact: true });
    expect((await videoInfo(page)).muted).toBe(true);
    await expect(sound).toHaveAttribute('aria-pressed', 'false');
    expect(await soundOnEvents(page)).toEqual([]);

    await sound.click();
    await expect(sound).toHaveAttribute('aria-pressed', 'true');
    const info = await videoInfo(page);
    expect(info.muted).toBe(false);
    expect(info.paused).toBe(false);
    expect(await soundOnEvents(page)).toEqual([{ slug: 'e2e-fixture' }]);
    // Tocar los controles del vídeo no arranca la música: suena el vídeo.
    await page.waitForTimeout(300);
    expect((await audioInfo(page)).paused).toBe(true);
  });

  test('con un mix sonando, el vídeo arranca silenciado y la música sigue (D42, D43)', async ({ page }, testInfo) => {
    await watchSoundOn(page);
    await page.goto('/');
    test.skip(!(await canPlayFixture(page)), 'Este navegador no reproduce AV1 + Opus');
    // La música suena sola al abrir la web (D43).
    await expectMusicPlaying(page);
    if (isMobileViewport(testInfo.project.use.viewport)) await openMobileMenu(page);
    await menuLink(page, 'media').click();
    await expectPlaying(page);

    expect((await videoInfo(page)).muted).toBe(true);
    await expect(page.getByRole('button', { name: 'sonido', exact: true })).toHaveAttribute('aria-pressed', 'false');
    expect(await soundOnEvents(page)).toEqual([]);
    // Entrar en Media no corta la música.
    const music = await expectMusicPlaying(page);
    expect(music.paused).toBe(false);
  });

  test('si el vídeo empieza a sonar, la música se pausa; al salir de Media, vuelve', async ({ page }, testInfo) => {
    const mobile = isMobileViewport(testInfo.project.use.viewport);
    await page.goto('/');
    test.skip(!(await canPlayFixture(page)), 'Este navegador no reproduce AV1 + Opus');
    const before = await expectMusicPlaying(page);
    if (mobile) await openMobileMenu(page);
    await menuLink(page, 'media').click();
    await expectPlaying(page);

    await page.getByRole('button', { name: 'sonido', exact: true }).click();
    await expect(page.getByRole('button', { name: 'sonido', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(player(page)).toHaveAttribute('data-state', 'paused');
    expect((await audioInfo(page)).paused).toBe(true);

    if (mobile) await openMobileMenu(page);
    await menuLink(page, 'archive').click();
    await expect(page.locator('html')).toHaveAttribute('data-section', 'archive');
    const after = await expectMusicPlaying(page);
    expect(after.mix).toBe(before.mix);
  });

  test('pausa y reanudar', async ({ page }) => {
    await page.goto('/media');
    test.skip(!(await canPlayFixture(page)), 'Este navegador no reproduce AV1 + Opus');
    await showMobilePage(page);
    await expectPlaying(page);

    await page.getByRole('button', { name: 'pausa', exact: true }).click();
    await expect(page.locator('media-video')).toHaveAttribute('data-state', 'paused');
    const paused = await videoInfo(page);
    expect(paused.paused).toBe(true);
    await page.waitForTimeout(400);
    expect((await videoInfo(page)).time).toBe(paused.time);

    await page.getByRole('button', { name: 'reanudar', exact: true }).click();
    await expectPlaying(page);
    await expect(page.getByRole('button', { name: 'pausa', exact: true })).toBeVisible();
  });

  test('el enlace al set completo abre YouTube en otra pestaña', async ({ page }) => {
    await page.goto('/media');
    await showMobilePage(page);
    const link = page.getByRole('link', { name: /ver set completo/ });
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute('href', 'https://www.youtube.com/watch?v=XokoqVkCmQg&t=2541s');
    await expect(link).toHaveAttribute('target', '_blank');
    await expect(link).toHaveAttribute('rel', 'noopener');
  });

  test('al salir de Media no quedan vídeos, ni hls.js, ni descargas (y al volver, arranca otra vez)', async ({ page }, testInfo) => {
    await page.goto('/media');
    test.skip(!(await canPlayFixture(page)), 'Este navegador no reproduce AV1 + Opus');
    await showMobilePage(page);
    await expectPlaying(page);
    expect((await videoInfo(page)).stats).toEqual({ elements: 1, hls: 1 });

    if (isMobileViewport(testInfo.project.use.viewport)) await openMobileMenu(page);
    await menuLink(page, 'archive').click();
    await expect(page.locator('html')).toHaveAttribute('data-section', 'archive');

    // Los mixes del reproductor siguen sonando (y descargándose): no cuentan.
    const afterLeaving: string[] = [];
    page.on('request', (request) => {
      if (request.url().startsWith(MEDIA_ORIGIN) && !request.url().includes('/mixes/')) afterLeaving.push(request.url());
    });
    await page.waitForTimeout(1_500);

    expect(await page.locator('video').count()).toBe(0);
    expect(await page.evaluate(() => (customElements.get('media-video') as unknown as { stats: unknown }).stats)).toEqual({
      elements: 0,
      hls: 0,
    });
    expect(afterLeaving).toEqual([]);

    // Y al volver, arranca de nuevo con una sola instancia… y es el <video> de
    // la página el que se ve (Astro recrea los <video> al navegar).
    if (isMobileViewport(testInfo.project.use.viewport)) await openMobileMenu(page);
    await menuLink(page, 'media').click();
    await expectPlaying(page);
    await expectVideoOnPage(page);
    expect((await videoInfo(page)).stats).toEqual({ elements: 1, hls: 1 });
  });

  test('con HLS nativo (Chrome ≥ 141, Safari), al volver a Media se ve el vídeo, no solo suena', async ({ page }, testInfo) => {
    // Con HLS nativo, `video.src` se pone en el mismo momento del montaje. Este
    // Chromium no lo reproduce de verdad (acaba en el MP4 de respaldo), pero el
    // orden de las cosas es el de Chrome y Safari.
    await page.addInitScript(() => {
      const canPlayType = HTMLMediaElement.prototype.canPlayType;
      HTMLMediaElement.prototype.canPlayType = function (this: HTMLMediaElement, type: string) {
        return type === 'application/vnd.apple.mpegurl' ? 'maybe' : canPlayType.call(this, type);
      };
    });
    const mobile = isMobileViewport(testInfo.project.use.viewport);
    await page.goto('/media');
    test.skip(!(await canPlayFixture(page)), 'Este navegador no reproduce AV1 + Opus');
    await showMobilePage(page);
    await expectPlaying(page);

    if (mobile) await openMobileMenu(page);
    await menuLink(page, 'archive').click();
    await expect(page.locator('html')).toHaveAttribute('data-section', 'archive');
    if (mobile) await openMobileMenu(page);
    await menuLink(page, 'media').click();
    await expectPlaying(page);
    await expectVideoOnPage(page);
  });

  test('si el HLS falla, usa el MP4 de respaldo', async ({ page }) => {
    await page.route('**/master.m3u8', (route) => route.abort());
    await page.goto('/media');
    test.skip(!(await canPlayFixture(page)), 'Este navegador no reproduce AV1 + Opus');
    await showMobilePage(page);
    await expectPlaying(page);
    const source = await page.evaluate(() => document.querySelector<HTMLVideoElement>('media-video video[data-video]')!.currentSrc);
    expect(source).toMatch(/\/fallback\.mp4$/);
    expect((await videoInfo(page)).stats).toEqual({ elements: 1, hls: 0 });
  });

  test('si no hay forma de reproducirlo, se queda el póster con el nombre del vídeo', async ({ page }) => {
    await page.route(/\/(master\.m3u8|fallback\.mp4)$/, (route) => route.abort());
    await page.goto('/media');
    await showMobilePage(page);
    const element = page.locator('media-video');
    await expect(element).toHaveAttribute('data-state', 'error', { timeout: 10_000 });
    await expect(page.getByRole('img', { name: 'Vídeo de prueba (tests)' })).toBeVisible();
    await expect(page.getByRole('group', { name: 'Controles del vídeo' })).toBeHidden();
  });

  test('hls.js solo se descarga en Media', async ({ page }, testInfo) => {
    const scripts: string[] = [];
    page.on('request', (request) => {
      if (request.resourceType() === 'script') scripts.push(request.url());
    });
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    expect(scripts.filter((url) => /hls/i.test(url))).toEqual([]);

    if (isMobileViewport(testInfo.project.use.viewport)) await openMobileMenu(page);
    await menuLink(page, 'media').click();
    await expect(page.locator('html')).toHaveAttribute('data-section', 'media');
    test.skip(!(await canPlayFixture(page)), 'Este navegador no reproduce AV1 + Opus');
    // Chromium no trae HLS nativo: tiene que cargar hls.js.
    await expect.poll(() => scripts.filter((url) => /hls/i.test(url)).length).toBeGreaterThan(0);
  });

  test('con Save-Data no arranca solo', async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'connection', { configurable: true, value: { saveData: true } });
    });
    await page.goto('/media');
    await showMobilePage(page);
    await expect(page.locator('media-video')).toHaveAttribute('data-state', 'idle');
    await expect(page.getByRole('button', { name: 'reproducir', exact: true })).toBeVisible();
  });

  test.describe('con prefers-reduced-motion', () => {
    test.use({ reducedMotion: 'reduce' });

    test('no arranca solo: póster y botón «reproducir», sin descargar el vídeo', async ({ page }) => {
      const media: string[] = [];
      page.on('request', (request) => {
        if (/\.(m3u8|m4s|mp4)$/.test(request.url())) media.push(request.url());
      });
      await page.goto('/media');
      await showMobilePage(page);
      const element = page.locator('media-video');
      await expect(element).toHaveAttribute('data-state', 'idle');
      await expect(page.locator('media-video picture img')).toBeVisible();
      const start = page.getByRole('button', { name: 'reproducir', exact: true });
      await expect(start).toBeVisible();
      await page.waitForTimeout(500);
      expect(media).toEqual([]);

      test.skip(!(await canPlayFixture(page)), 'Este navegador no reproduce AV1 + Opus');
      await start.click();
      await expect(element).toHaveAttribute('data-state', 'playing', { timeout: 10_000 });
      await expect(start).toBeHidden();
      // Lo ha pedido la persona: suena (D42), aunque sonara la música, que se pausa.
      expect((await videoInfo(page)).muted).toBe(false);
      await expect(page.getByRole('button', { name: 'sonido', exact: true })).toHaveAttribute('aria-pressed', 'true');
      await expect(player(page)).not.toHaveAttribute('data-state', 'playing');
      expect((await audioInfo(page)).paused).toBe(true);
    });
  });
});
