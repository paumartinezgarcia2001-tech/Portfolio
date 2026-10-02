import { expect, test, type Page } from '@playwright/test';
import { SOCIAL_TEXT, SOUNDCLOUD, instagramPosts, soundcloudPlayerUrl } from '../../src/config/social';
import { INSTAGRAM_ORIGIN, SOUNDCLOUD_ORIGIN, openContact, stubSocialWidgets as stubThirdParties } from './contact-helpers';
import { ensureMusic, isMobileViewport, player, showMobilePage, withMusicPaused } from './helpers';

/**
 * D59 · widgets de contact.
 *
 * - **SoundCloud** va puesto al abrir la página, pero no suena hasta que le dan
 *   al play. Lo que se prueba aquí es justo eso: que no se cuela por encima de
 *   la música de la web (D43), y que cuando sí suena, la música se pausa y
 *   vuelve al salir.
 * - **Instagram** es una fachada: hasta que se pulsa, nada de Meta. Eso es lo
 *   que sostiene lo que promete /privacidad.
 *
 * Ni los scripts ni los iframes se piden de verdad: se interceptan, igual que
 * Turnstile y Resend (tests/e2e/contact-helpers.ts), porque el contenedor no
 * sale a esos dominios.
 */

/** Simula que alguien le da al play dentro del iframe de SoundCloud. */
async function playSoundCloud(page: Page): Promise<void> {
  await expect
    .poll(() => page.evaluate(() => typeof (window as unknown as { __scFire?: unknown }).__scFire), { timeout: 15_000 })
    .toBe('function');
  await page.evaluate(() => (window as unknown as { __scFire: (event: string) => void }).__scFire('play'));
}

test.describe('Reproductor de SoundCloud', () => {
  test('viene puesto al abrir contact, con la pista y sin arrancar solo', async ({ page }) => {
    const requests = await stubThirdParties(page);
    await openContact(page);
    await showMobilePage(page);

    const frame = page.locator('soundcloud-embed iframe');
    await expect(frame).toHaveCount(1);
    await expect(frame).toHaveAttribute('src', soundcloudPlayerUrl());
    await expect(frame).toHaveAttribute('title', SOCIAL_TEXT.soundcloud.frameTitle);
    expect(soundcloudPlayerUrl()).toContain('auto_play=false');
    // Y el iframe sí se ha pedido: aquí no hay fachada que valga.
    await expect.poll(() => requests.length, { timeout: 10_000 }).toBeGreaterThan(0);
  });

  test('no le pisa la música a la web al llegar (D43)', async ({ page }) => {
    await stubThirdParties(page);
    await page.goto('/');
    await ensureMusic(page);
    await expect(player(page)).toHaveAttribute('data-state', 'playing');

    await page.goto('/contact');
    await showMobilePage(page);
    await expect(page.locator('soundcloud-embed iframe')).toHaveCount(1);
    // Margen por si algo quisiera pausarla al cargar el iframe.
    await page.waitForTimeout(1_000);
    await expect(player(page)).toHaveAttribute('data-state', 'playing');
  });

  test('cuando suena, la música se pausa; al salir de contact, vuelve', async ({ page }) => {
    await stubThirdParties(page);
    await page.goto('/contact');
    await showMobilePage(page);
    await ensureMusic(page);
    await expect(player(page)).toHaveAttribute('data-state', 'playing');

    await playSoundCloud(page);
    await expect(player(page)).toHaveAttribute('data-state', 'paused');

    // El iframe se destruye al navegar, así que ya no suena nada de SoundCloud.
    await page.goto('/');
    await expect(player(page)).toHaveAttribute('data-state', 'playing');
  });

  test('si arranca la música, SoundCloud se pausa', async ({ page }) => {
    await stubThirdParties(page);
    await openContact(page);
    await showMobilePage(page);
    await expect(page.locator('soundcloud-embed iframe')).toHaveCount(1);
    // La API ya enganchada: es la que recibe el `pause`.
    await expect
      .poll(() => page.evaluate(() => typeof (window as unknown as { __scFire?: unknown }).__scFire), { timeout: 15_000 })
      .toBe('function');
    await ensureMusic(page);

    // La música ya sonaba al llegar, así que se para y se vuelve a arrancar:
    // ese arranque es el que tiene que callar a SoundCloud.
    const region = player(page);
    await region.getByRole('button', { name: 'Pausar', exact: true }).click();
    await expect(region).toHaveAttribute('data-state', 'paused');
    await region.getByRole('button', { name: 'Reproducir', exact: true }).click();

    await expect
      .poll(() => page.evaluate(() => (window as unknown as { __scPaused: number }).__scPaused), { timeout: 10_000 })
      .toBeGreaterThan(0);
  });

  test('sin JavaScript el reproductor también está', async ({ browser }) => {
    const context = await browser.newContext({ javaScriptEnabled: false });
    const noJs = await context.newPage();
    await stubThirdParties(noJs);
    await noJs.goto('/contact');
    await expect(noJs.locator('soundcloud-embed iframe')).toHaveCount(1);
    await context.close();
  });

  test('el aviso va debajo, en el tamaño más pequeño de la web', async ({ page }) => {
    await stubThirdParties(page);
    await withMusicPaused(page);
    await openContact(page);
    await showMobilePage(page);
    const notice = page.getByText(SOCIAL_TEXT.soundcloud.notice);
    await expect(notice).toBeVisible();

    const [noticePx, smallPx] = await page.evaluate(() => {
      const styles = getComputedStyle(document.documentElement);
      const read = (token: string) => {
        const probe = document.createElement('span');
        probe.style.fontSize = styles.getPropertyValue(token).trim();
        document.body.appendChild(probe);
        const size = Number.parseFloat(getComputedStyle(probe).fontSize);
        probe.remove();
        return size;
      };
      const element = document.querySelector('.embed__notice');
      return [Number.parseFloat(getComputedStyle(element!).fontSize), read('--fs-small')];
    });
    // El más pequeño de la escala (--fs-label), por debajo del texto normal.
    expect(noticePx).toBeLessThan(smallPx);
  });
});

test.describe('Publicaciones de Instagram', () => {
  test.skip(
    instagramPosts().length === 0,
    'Sin publicaciones en INSTAGRAM_POSTS (src/config/social.ts): el apartado no se pinta.',
  );

  test.beforeEach(async ({ page }) => {
    await withMusicPaused(page);
  });

  test('al abrir contact no se pide ni un byte a Meta', async ({ page }) => {
    const requests = await stubThirdParties(page);
    await openContact(page);
    await showMobilePage(page);
    await page.waitForLoadState('load');
    await page.waitForTimeout(500);

    expect(requests.filter((request) => request.url().startsWith(INSTAGRAM_ORIGIN))).toEqual([]);
    expect(await page.locator('.instagram-media').count()).toBe(0);
    await expect(page.getByText(SOCIAL_TEXT.instagram.notice)).toBeVisible();
  });

  test('los enlaces están desde el principio y el botón carga los embeds', async ({ page }) => {
    const requests = await stubThirdParties(page);
    await openContact(page);
    await showMobilePage(page);

    const total = instagramPosts().length;
    await expect(page.locator('instagram-posts [data-post]')).toHaveCount(total);
    for (const url of instagramPosts()) {
      await expect(page.locator(`instagram-posts a[href="${url}"]`)).toHaveAttribute('target', '_blank');
    }

    await page.getByRole('button', { name: SOCIAL_TEXT.instagram.load }).click();

    // Un blockquote por publicación, con su permalink, y los enlaces fuera.
    await expect(page.locator('.instagram-media')).toHaveCount(total);
    for (const url of instagramPosts()) {
      await expect(page.locator(`.instagram-media[data-instgrm-permalink="${url}"]`)).toHaveCount(1);
    }
    await expect(page.locator('instagram-posts [data-posts]')).toBeHidden();
    await expect(page.getByRole('button', { name: SOCIAL_TEXT.instagram.load })).toHaveCount(0);
    expect(requests.some((request) => request.url().startsWith(`${INSTAGRAM_ORIGIN}/embed.js`))).toBe(true);
  });
});

test.describe('Cabeceras de seguridad con los widgets puestos (§11)', () => {
  test('cargar los dos no rompe la CSP', async ({ page }) => {
    const violations: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'error' && /Content Security Policy/i.test(message.text())) violations.push(message.text());
    });
    await stubThirdParties(page);
    await withMusicPaused(page);
    await openContact(page);
    await showMobilePage(page);
    await expect(page.locator('soundcloud-embed iframe')).toHaveCount(1);
    if (instagramPosts().length > 0) {
      await page.getByRole('button', { name: SOCIAL_TEXT.instagram.load }).click();
      await expect(page.locator('.instagram-media').first()).toBeAttached();
    }
    await page.waitForTimeout(500);
    expect(violations).toEqual([]);
  });

  test('la CSP de las respuestas del Worker nombra los dos orígenes', async ({ page }) => {
    const response = await page.goto('/contact');
    const csp = response?.headers()['content-security-policy'] ?? '';
    expect(csp).toContain(`script-src 'self' https://challenges.cloudflare.com ${SOUNDCLOUD_ORIGIN} ${INSTAGRAM_ORIGIN}`);
    expect(csp).toContain(`frame-src https://challenges.cloudflare.com ${SOUNDCLOUD_ORIGIN} ${INSTAGRAM_ORIGIN}`);
  });
});

/** El cursor propio se esconde encima de los iframes (C10), como en Turnstile. */
test.describe('Cursor sobre los widgets (C10)', () => {
  test.skip(({ viewport }) => isMobileViewport(viewport), 'Solo escritorio (hay cursor)');

  test('sobre el reproductor manda el cursor del sistema', async ({ page }) => {
    await stubThirdParties(page);
    await withMusicPaused(page);
    await openContact(page);
    await showMobilePage(page);
    expect(SOUNDCLOUD.eager).toBe(true);
    await expect(page.locator('soundcloud-embed')).toHaveCSS('cursor', 'auto');
  });
});
