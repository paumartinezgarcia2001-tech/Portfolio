import { expect, test, type Page, type Request } from '@playwright/test';
import { SOCIAL_TEXT, instagramPosts, soundcloudPlayerUrl } from '../../src/config/social';
import { openContact } from './contact-helpers';
import { ensureMusic, isMobileViewport, player, showMobilePage, withMusicPaused } from './helpers';

/**
 * D59 · widgets de contact: reproductor de SoundCloud y publicaciones de
 * Instagram, los dos con fachada.
 *
 * Lo que se prueba de verdad aquí es la promesa de /privacidad: **mientras
 * nadie pulse, el navegador no habla ni con SoundCloud ni con Meta**. Ni los
 * scripts ni los iframes se piden de verdad: se interceptan, igual que
 * Turnstile y Resend (tests/e2e/contact-helpers.ts), porque el contenedor no
 * sale a esos dominios.
 */

const SOUNDCLOUD_ORIGIN = 'https://w.soundcloud.com';
const INSTAGRAM_ORIGIN = 'https://www.instagram.com';

/** API del widget de SoundCloud, de mentira: apunta lo que se le pide en `window`. */
const SC_API_STUB = `
(() => {
  const calls = [];
  function Widget(frame) {
    return {
      bind(event, listener) { calls.push(['bind', event]); },
      pause() { calls.push(['pause']); },
    };
  }
  Widget.Events = { PLAY: 'play', PAUSE: 'pause', FINISH: 'finish' };
  window.SC = { Widget };
  window.__scCalls = calls;
})();
`;

/** `embed.js` de Instagram, de mentira: no pinta nada, solo deja su API. */
const IG_SCRIPT_STUB = `
(() => {
  window.__igProcessed = 0;
  window.instgrm = { Embeds: { process() { window.__igProcessed++; } } };
})();
`;

/** Intercepta los scripts y el iframe, y devuelve las peticiones que se hagan. */
async function stubThirdParties(page: Page): Promise<Request[]> {
  const requests: Request[] = [];
  page.on('request', (request) => {
    const url = request.url();
    if (url.startsWith(SOUNDCLOUD_ORIGIN) || url.startsWith(`${INSTAGRAM_ORIGIN}/embed.js`)) requests.push(request);
  });

  const script = (body: string) => ({
    status: 200,
    contentType: 'application/javascript; charset=utf-8',
    body,
  });

  await page.route((url) => url.href.startsWith(`${SOUNDCLOUD_ORIGIN}/player/api.js`), (route) =>
    route.fulfill(script(SC_API_STUB)),
  );
  await page.route((url) => url.href.startsWith(`${SOUNDCLOUD_ORIGIN}/player/?`), (route) =>
    route.fulfill({
      status: 200,
      contentType: 'text/html; charset=utf-8',
      body: '<!doctype html><html lang="es"><body style="font:14px Helvetica,Arial,sans-serif">SoundCloud (prueba)</body></html>',
    }),
  );
  await page.route((url) => url.href.startsWith(`${INSTAGRAM_ORIGIN}/embed.js`), (route) =>
    route.fulfill(script(IG_SCRIPT_STUB)),
  );
  return requests;
}

test.describe('Fachadas: nada de terceros hasta que se pulsa', () => {
  test.beforeEach(async ({ page }) => {
    await withMusicPaused(page);
  });

  test('al abrir contact no se pide ni un byte a SoundCloud ni a Instagram', async ({ page }) => {
    const requests = await stubThirdParties(page);
    await openContact(page);
    await showMobilePage(page);
    await page.waitForLoadState('load');
    // Margen para lo que se cargue después del `load`.
    await page.waitForTimeout(500);

    expect(requests.map((request) => request.url())).toEqual([]);
    // Y en la página no hay ningún iframe de ellos.
    expect(await page.locator(`iframe[src*="w.soundcloud.com"]`).count()).toBe(0);
    expect(await page.locator('.instagram-media').count()).toBe(0);
  });

  test('el aviso dice que se cargan desde fuera', async ({ page }) => {
    await stubThirdParties(page);
    await openContact(page);
    await showMobilePage(page);
    await expect(page.getByText(SOCIAL_TEXT.soundcloud.notice)).toBeVisible();
  });
});

test.describe('Reproductor de SoundCloud', () => {
  test('al pulsar se carga el reproductor, sonando, y la música se pausa', async ({ page }) => {
    const requests = await stubThirdParties(page);
    await openContact(page);
    await showMobilePage(page);
    // Con la música sonando, para ver que SoundCloud la pausa (D42/D59).
    await ensureMusic(page);
    await expect(player(page)).toHaveAttribute('data-state', 'playing');

    const facade = page.locator('soundcloud-embed [data-load]');
    // Con JavaScript, la fachada ya no invita a salir a SoundCloud.
    await expect(facade).toHaveText(new RegExp(SOCIAL_TEXT.soundcloud.load));
    await facade.click();

    const frame = page.locator('soundcloud-embed iframe');
    await expect(frame).toHaveCount(1);
    await expect(frame).toHaveAttribute('src', soundcloudPlayerUrl({ autoPlay: true }));
    await expect(frame).toHaveAttribute('allow', /autoplay/);
    await expect(frame).toHaveAttribute('title', SOCIAL_TEXT.soundcloud.frameTitle);
    await expect(page.locator('soundcloud-embed')).toHaveAttribute('data-state', 'ready');

    // La música se calla: no suenan los dos a la vez.
    await expect(player(page)).toHaveAttribute('data-state', 'paused');

    // Y ahora sí se ha pedido: el iframe y la API del widget.
    await expect.poll(() => requests.length, { timeout: 10_000 }).toBeGreaterThanOrEqual(2);
    const urls = requests.map((request) => request.url());
    expect(urls.some((url) => url.startsWith(`${SOUNDCLOUD_ORIGIN}/player/?`))).toBe(true);
    expect(urls.some((url) => url.startsWith(`${SOUNDCLOUD_ORIGIN}/player/api.js`))).toBe(true);
  });

  test('al salir de contact la música vuelve sola', async ({ page }) => {
    await stubThirdParties(page);
    await openContact(page);
    await showMobilePage(page);
    await ensureMusic(page);
    await page.locator('soundcloud-embed [data-load]').click();
    await expect(player(page)).toHaveAttribute('data-state', 'paused');

    // El iframe se destruye al navegar, así que ya no suena nada de SoundCloud.
    await page.goto('/');
    await expect(player(page)).toHaveAttribute('data-state', 'playing');
  });

  test('sin JavaScript la fachada es un enlace a SoundCloud', async ({ browser }) => {
    const context = await browser.newContext({ javaScriptEnabled: false });
    const noJs = await context.newPage();
    await stubThirdParties(noJs);
    await noJs.goto('/contact');
    const link = noJs.locator('soundcloud-embed [data-load]');
    await expect(link).toHaveAttribute('href', 'https://soundcloud.com/travest15m0');
    await expect(link).toHaveAttribute('target', '_blank');
    await expect(link).toHaveText(new RegExp(SOCIAL_TEXT.soundcloud.openLabel));
    expect(await noJs.locator('soundcloud-embed iframe').count()).toBe(0);
    await context.close();
  });
});

test.describe('Publicaciones de Instagram', () => {
  test.skip(
    instagramPosts().length === 0,
    'Sin publicaciones en INSTAGRAM_POSTS todavía (src/config/social.ts): el apartado no se pinta.',
  );

  test.beforeEach(async ({ page }) => {
    await withMusicPaused(page);
  });

  test('los enlaces están desde el principio y el botón carga los embeds', async ({ page }) => {
    const requests = await stubThirdParties(page);
    await openContact(page);
    await showMobilePage(page);

    const links = page.locator('instagram-posts [data-post]');
    const total = instagramPosts().length;
    await expect(links).toHaveCount(total);
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
    await page.locator('soundcloud-embed [data-load]').click();
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
    await expect(page.locator('soundcloud-embed')).toHaveCSS('cursor', 'auto');
  });
});
