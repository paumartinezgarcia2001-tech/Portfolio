import { randomUUID } from 'node:crypto';
import { expect, type APIRequestContext, type Locator, type Page, type Request } from '@playwright/test';

/**
 * Ayudas de los e2e del formulario de contacto (C17, fase 5).
 *
 * Turnstile y Resend no se llaman de verdad:
 * - el servidor habla con `tests/e2e/mock-services.mjs`, que imita
 *   `siteverify` con el comportamiento de las **claves de prueba** de
 *   Cloudflare y la API de Resend (TURNSTILE_VERIFY_URL y RESEND_API_URL en
 *   playwright.config.ts);
 * - en el navegador, `mockTurnstile()` sustituye `api.js` por un widget de
 *   pruebas que devuelve el token `XXXX.DUMMY.TOKEN.XXXX`, como las claves de
 *   prueba. El contenedor de la nube no llega a challenges.cloudflare.com.
 *
 * Con `E2E_TURNSTILE=real` no se sustituye nada: los tests van contra
 * Cloudflare con sus claves de prueba (hace falta salida a internet).
 */

export const DUMMY_TOKEN = 'XXXX.DUMMY.TOKEN.XXXX';
export const TURNSTILE_SCRIPT = 'https://challenges.cloudflare.com/turnstile/v0/api.js*';
export const TURNSTILE_FRAME = 'https://challenges.cloudflare.com/turnstile/v0/e2e-widget*';
export const SERVICES_URL = `http://127.0.0.1:${process.env.E2E_SERVICES_PORT ?? 4323}`;
export const REAL_TURNSTILE = process.env.E2E_TURNSTILE === 'real';

/** Widget de pruebas: hace lo mismo que Turnstile con las claves de prueba. */
const STUB = `
(() => {
  const DUMMY = ${JSON.stringify(DUMMY_TOKEN)};
  const widgets = new Map();
  let next = 0;
  function fill(widget) {
    const fails = widget.options.sitekey.startsWith('2x');
    if (fails) {
      widget.token = '';
      widget.input.value = '';
      widget.options['error-callback'] && widget.options['error-callback']('e2e-fail');
      return;
    }
    widget.token = DUMMY;
    widget.input.value = DUMMY;
    widget.options.callback && widget.options.callback(DUMMY);
  }
  window.turnstile = {
    ready(callback) { callback(); },
    render(target, options) {
      const container = typeof target === 'string' ? document.querySelector(target) : target;
      if (!container) return undefined;
      const id = 'e2e-' + ++next;
      const frame = document.createElement('iframe');
      frame.src = 'https://challenges.cloudflare.com/turnstile/v0/e2e-widget?id=' + id;
      frame.title = 'Widget de Turnstile (prueba)';
      frame.width = '300';
      frame.height = '65';
      frame.style.border = '0';
      const input = document.createElement('input');
      input.type = 'hidden';
      input.name = options['response-field-name'] || 'cf-turnstile-response';
      container.appendChild(frame);
      container.appendChild(input);
      const widget = { id, container, frame, input, options, token: '' };
      widgets.set(id, widget);
      fill(widget);
      return id;
    },
    reset(id) {
      const widget = widgets.get(id);
      if (widget) fill(widget);
    },
    remove(id) {
      const widget = widgets.get(id);
      if (!widget) return;
      widget.frame.remove();
      widget.input.remove();
      widgets.delete(id);
    },
    getResponse(id) { return widgets.get(id)?.token || undefined; },
    isExpired() { return false; },
  };
})();
`;

/** Sustituye el script de Turnstile (y el iframe del widget) por los de prueba. */
export async function mockTurnstile(page: Page): Promise<void> {
  if (REAL_TURNSTILE) return;
  await page.route(TURNSTILE_SCRIPT, (route) =>
    route.fulfill({ status: 200, contentType: 'application/javascript; charset=utf-8', body: STUB }),
  );
  await page.route(TURNSTILE_FRAME, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'text/html; charset=utf-8',
      body: '<!doctype html><html lang="es"><body style="font:14px Helvetica,Arial,sans-serif">Turnstile (prueba)</body></html>',
    }),
  );
}

/** IP distinta en cada test: el límite de 5 envíos/hora no se pisa entre tests. */
export function uniqueIp(): string {
  const random = () => Math.floor(Math.random() * 254) + 1;
  // 198.18.0.0/15 está reservado para pruebas (RFC 2544).
  return `198.18.${random()}.${random()}`;
}

/** Marca única para reconocer el email de un test en el Resend simulado. */
export function uniqueMarker(): string {
  return `[e2e:${randomUUID()}]`;
}

export interface SentEmail {
  id: string;
  idempotencyKey: string;
  attempts: number;
  body: { from: string; to: string[]; reply_to: string; subject: string; text: string; html: string };
}

/** Emails que ha recibido el Resend simulado con esa marca. */
export async function sentEmails(request: APIRequestContext, marker: string): Promise<SentEmail[]> {
  const response = await request.get(`${SERVICES_URL}/__e2e/emails?marker=${encodeURIComponent(marker)}`);
  expect(response.ok()).toBe(true);
  const body = (await response.json()) as { emails: SentEmail[] };
  return body.emails;
}

/** Espera a que llegue un email con esa marca y lo devuelve. */
export async function waitForEmail(request: APIRequestContext, marker: string): Promise<SentEmail> {
  let emails: SentEmail[] = [];
  await expect
    .poll(
      async () => {
        emails = await sentEmails(request, marker);
        return emails.length;
      },
      { timeout: 10_000 },
    )
    .toBeGreaterThan(0);
  return emails[0]!;
}

export interface ContactFormData {
  email?: string;
  telefono?: string;
  mensaje?: string;
  /** Marca la casilla oculta `botcheck`, como haría un bot. */
  honeypot?: boolean;
}

export function form(page: Page): Locator {
  return page.locator('[data-contact-form]');
}

export function fieldError(page: Page, field: string): Locator {
  return page.locator(`[data-error-for="${field}"]`);
}

export function formAlert(page: Page): Locator {
  return page.locator('[data-form-error]');
}

export function sentMessage(page: Page): Locator {
  return page.locator('[data-contact-sent]');
}

/**
 * Widgets de contact (D59): el reproductor de SoundCloud se carga al abrir la
 * página, así que **todos** los tests de contact lo encuentran por medio. Aquí
 * se intercepta, como Turnstile y Resend: el contenedor no sale a esos
 * dominios, y así el iframe no depende de la red.
 *
 * Devuelve las peticiones que se hagan a esos orígenes (las usa
 * tests/e2e/social-embeds.spec.ts). Llamarlo dos veces sobre la misma página
 * devuelve la misma lista y no duplica los interceptores.
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

/** Abre /contact con Turnstile y los widgets simulados, y una IP propia. */
export async function openContact(page: Page, options: { ip?: string } = {}): Promise<void> {
  await page.setExtraHTTPHeaders({ 'CF-Connecting-IP': options.ip ?? uniqueIp() });
  await mockTurnstile(page);
  await stubSocialWidgets(page);
  await page.goto('/contact');
  await expect(page.locator('html')).toHaveAttribute('data-section', 'contact');
}

/** Rellena el formulario (solo lo que se le pase). */
export async function fillContact(page: Page, values: ContactFormData): Promise<void> {
  if (values.email !== undefined) await page.locator('[name="email"]').fill(values.email);
  if (values.telefono !== undefined) await page.locator('[name="telefono"]').fill(values.telefono);
  if (values.mensaje !== undefined) await page.locator('[name="mensaje"]').fill(values.mensaje);
  if (values.honeypot) {
    // La casilla está escondida con `display: none`: se marca como lo haría un bot.
    await page.locator('[name="botcheck"]').evaluate((input) => {
      (input as HTMLInputElement).checked = true;
    });
  }
}

/** Espera a que el widget de prueba haya dejado su token en el formulario. */
export async function waitForTurnstileToken(page: Page): Promise<void> {
  await expect
    .poll(() => page.locator('[name="cf-turnstile-response"]').count(), { timeout: 15_000 })
    .toBeGreaterThan(0);
  await expect.poll(() => page.locator('[name="cf-turnstile-response"]').first().inputValue(), { timeout: 15_000 }).not.toBe('');
}

export function submitButton(page: Page): Locator {
  return page.locator('[data-submit]');
}
