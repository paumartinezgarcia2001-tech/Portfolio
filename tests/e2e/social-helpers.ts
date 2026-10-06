import { expect, type Page, type Request } from '@playwright/test';

/**
 * Widgets de contact (D59): el reproductor de SoundCloud y el embed de
 * Instagram se cargan al abrir la página. Aquí se interceptan: el contenedor de
 * los tests no sale a esos dominios, y así el iframe no depende de la red.
 *
 * `stubSocialWidgets` devuelve las peticiones que se hagan a esos orígenes (las
 * usa tests/e2e/social-embeds.spec.ts). Llamarlo dos veces sobre la misma
 * página devuelve la misma lista y no duplica los interceptores.
 */
const stubbed = new WeakMap<Page, Request[]>();

export const SOUNDCLOUD_ORIGIN = 'https://w.soundcloud.com';
export const INSTAGRAM_ORIGIN = 'https://www.instagram.com';

/** API del widget de SoundCloud, de mentira; `window.__scFire('play')` la dispara. */
const SOUNDCLOUD_API_STUB = `
(() => {
  const listeners = {};
  window.__scPaused = 0;
  function Widget(frame) {
    return {
      bind(event, listener) { (listeners[event] ||= []).push(listener); },
      pause() { window.__scPaused++; },
    };
  }
  Widget.Events = { PLAY: 'play', PAUSE: 'pause', FINISH: 'finish' };
  window.SC = { Widget };
  window.__scFire = (event) => (listeners[event] || []).forEach((listener) => listener());
})();
`;

/** `embed.js` de Instagram, de mentira: no pinta nada, solo deja su API. */
const INSTAGRAM_SCRIPT_STUB = `
(() => {
  window.__igProcessed = 0;
  window.instgrm = { Embeds: { process() { window.__igProcessed++; } } };
})();
`;

export async function stubSocialWidgets(page: Page): Promise<Request[]> {
  const existing = stubbed.get(page);
  if (existing) return existing;

  const requests: Request[] = [];
  stubbed.set(page, requests);
  page.on('request', (request) => {
    const url = request.url();
    if (url.startsWith(SOUNDCLOUD_ORIGIN) || url.startsWith(`${INSTAGRAM_ORIGIN}/embed.js`)) requests.push(request);
  });

  const script = (body: string) => ({ status: 200, contentType: 'application/javascript; charset=utf-8', body });
  await page.route((url) => url.href.startsWith(`${SOUNDCLOUD_ORIGIN}/player/api.js`), (route) =>
    route.fulfill(script(SOUNDCLOUD_API_STUB)),
  );
  await page.route((url) => url.href.startsWith(`${SOUNDCLOUD_ORIGIN}/player/?`), (route) =>
    route.fulfill({
      status: 200,
      contentType: 'text/html; charset=utf-8',
      body: '<!doctype html><html lang="es"><body style="font:14px Helvetica,Arial,sans-serif">SoundCloud (prueba)</body></html>',
    }),
  );
  await page.route((url) => url.href.startsWith(`${INSTAGRAM_ORIGIN}/embed.js`), (route) =>
    route.fulfill(script(INSTAGRAM_SCRIPT_STUB)),
  );
  return requests;
}

/** Abre /contact con los widgets simulados. */
export async function openContact(page: Page): Promise<void> {
  await stubSocialWidgets(page);
  await page.goto('/contact');
  await expect(page.locator('html')).toHaveAttribute('data-section', 'contact');
}
