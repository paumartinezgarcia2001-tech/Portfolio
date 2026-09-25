import { expect, test } from '@playwright/test';
import { CONTACT_RATE_LIMIT, CONTACT_TEXT as TEXT } from '../../src/config/contact';
import { SITE } from '../../src/config/site';
import {
  DUMMY_TOKEN,
  mockTurnstile,
  fieldError,
  fillContact,
  form,
  formAlert,
  openContact,
  sentEmails,
  sentMessage,
  submitButton,
  uniqueIp,
  uniqueMarker,
  waitForEmail,
  waitForTurnstileToken,
} from './contact-helpers';
import { isMobileViewport, menu, menuLink, showMobilePage, withMusicPaused } from './helpers';

/**
 * C17 · formulario de contacto (fase 5), con los tres campos de D58.
 * Turnstile y Resend están simulados: ver tests/e2e/contact-helpers.ts.
 *
 * Estos tests corren contra el build de Cloudflare (`npm run build`), el que
 * tiene Actions. El camino de GitHub Pages (Web3Forms) se prueba con tests
 * unitarios y de componente.
 */

test.beforeEach(async ({ page }) => {
  // Sin música: estos tests no van del reproductor (y un clic no debe arrancarla).
  await withMusicPaused(page);
});

test.describe('Envío correcto', () => {
  test('envía el mensaje y cambia el formulario por el aviso de enviado', async ({ page, request }) => {
    const marker = uniqueMarker();
    await openContact(page);
    await showMobilePage(page);
    await fillContact(page, {
      email: 'ana@example.com',
      telefono: '+34 600 11 22 33',
      mensaje: `Hola, ¿tienes libre el 15 de octubre? ${marker}`,
    });
    await waitForTurnstileToken(page);
    await submitButton(page).click();

    await expect(sentMessage(page)).toBeVisible();
    await expect(sentMessage(page)).toHaveText(TEXT.success);
    await expect(form(page)).toBeHidden();
    // El foco va al aviso, para quien navega con teclado o lector de pantalla.
    await expect(sentMessage(page)).toBeFocused();
    // Sin recargar: la URL no cambia y la música seguiría sonando.
    await expect(page).toHaveURL(/\/contact$/);

    const email = await waitForEmail(request, marker);
    expect(email.body.subject).toBe('[web] mensaje de ana@example.com');
    expect(email.body.reply_to).toBe('ana@example.com');
    expect(email.body.to).toEqual(['pau@e2e.test']);
    expect(email.body.text).toContain('Email: ana@example.com');
    expect(email.body.text).toContain('Teléfono: +34 600 11 22 33');
    expect(email.attempts).toBe(1);
  });

  test('el teléfono es opcional', async ({ page, request }) => {
    const marker = uniqueMarker();
    await openContact(page);
    await showMobilePage(page);
    await expect(page.locator('[name="telefono"]')).not.toHaveAttribute('required', '');
    await fillContact(page, { email: 'ana@example.com', mensaje: `Mensaje sin teléfono ${marker}` });
    await waitForTurnstileToken(page);
    await submitButton(page).click();

    await expect(sentMessage(page)).toBeVisible();
    const email = await waitForEmail(request, marker);
    expect(email.body.text).not.toContain('Teléfono');
  });
});

test.describe('Teclado (§10)', () => {
  test('se completa y se envía solo con el teclado', async ({ page, request }) => {
    const marker = uniqueMarker();
    await openContact(page);
    await showMobilePage(page);
    await waitForTurnstileToken(page);

    /** Qué tiene el foco: el `name` del campo, «enviar» o la etiqueta del elemento. */
    const focused = () =>
      page.evaluate(() => {
        const element = document.activeElement as HTMLElement | null;
        if (!element) return 'ninguno';
        return (
          element.getAttribute('name') ??
          (element.hasAttribute('data-submit') ? 'enviar' : element.tagName.toLowerCase())
        );
      });

    await page.locator('[name="email"]').focus();
    await page.keyboard.type('ana@example.com');

    const order: string[] = [];
    for (let i = 0; i < 10; i++) {
      await page.keyboard.press('Tab');
      const current = await focused();
      order.push(current);
      if (current === 'telefono') await page.keyboard.type('600112233');
      if (current === 'mensaje') await page.keyboard.type(`Mensaje escrito con el teclado ${marker}`);
      if (current === 'enviar') break;
    }

    // Orden de tabulación: los campos en el orden en que se leen, y al final
    // «enviar». El widget de Turnstile queda por medio (iframe).
    const visited = order
      .filter((name) => name !== 'a' && name !== 'iframe')
      .filter((name, index, all) => name !== all[index - 1]);
    expect(visited).toEqual(['telefono', 'mensaje', 'enviar']);

    await page.keyboard.press('Enter');
    await expect(sentMessage(page)).toBeVisible();
    await expect(sentMessage(page)).toBeFocused();
    const email = await waitForEmail(request, marker);
    expect(email.body.text).toContain('Teléfono: 600112233');
  });
});

test.describe('Errores de validación', () => {
  test('campos vacíos: los dice y no envía nada', async ({ page, request }) => {
    const marker = uniqueMarker();
    await openContact(page);
    await showMobilePage(page);
    await waitForTurnstileToken(page);
    await submitButton(page).click();

    await expect(fieldError(page, 'email')).toHaveText('Escribe tu email.');
    await expect(fieldError(page, 'mensaje')).toHaveText('Escribe tu mensaje.');
    // El teléfono está vacío, pero es opcional: sin error.
    await expect(fieldError(page, 'telefono')).toBeHidden();
    // El foco va al primer campo con error y queda enlazado con su mensaje.
    await expect(page.locator('[name="email"]')).toBeFocused();
    await expect(page.locator('[name="email"]')).toHaveAttribute('aria-describedby', 'contact-email-error');
    await expect(page.locator('[name="email"]')).toHaveAttribute('aria-invalid', 'true');
    await expect(form(page)).toBeVisible();
    await expect(sentMessage(page)).toBeHidden();
    expect(await sentEmails(request, marker)).toHaveLength(0);
  });

  test('email no válido: lo dice y conserva lo escrito', async ({ page, request }) => {
    const marker = uniqueMarker();
    await openContact(page);
    await showMobilePage(page);
    await fillContact(page, {
      email: 'ana@',
      telefono: '600112233',
      mensaje: `Un mensaje bastante largo para pasar el mínimo ${marker}`,
    });
    await waitForTurnstileToken(page);
    await submitButton(page).click();

    await expect(fieldError(page, 'email')).toHaveText('Escribe un email válido.');
    await expect(page.locator('[name="email"]')).toBeFocused();
    await expect(page.locator('[name="email"]')).toHaveValue('ana@');
    await expect(page.locator('[name="telefono"]')).toHaveValue('600112233');
    expect(await sentEmails(request, marker)).toHaveLength(0);

    // Al corregirlo, el mensaje sale y el error desaparece.
    await page.locator('[name="email"]').fill('ana@example.com');
    await submitButton(page).click();
    await expect(sentMessage(page)).toBeVisible();
    await expect(fieldError(page, 'email')).toBeHidden();
    await waitForEmail(request, marker);
  });

  test('teléfono con letras: lo dice y no envía', async ({ page, request }) => {
    const marker = uniqueMarker();
    await openContact(page);
    await showMobilePage(page);
    await fillContact(page, {
      email: 'ana@example.com',
      telefono: 'llámame al fijo',
      mensaje: `Mensaje con un teléfono raro ${marker}`,
    });
    await waitForTurnstileToken(page);
    await submitButton(page).click();

    await expect(fieldError(page, 'telefono')).toContainText('Escribe un teléfono válido');
    await expect(page.locator('[name="telefono"]')).toBeFocused();
    expect(await sentEmails(request, marker)).toHaveLength(0);
  });

  test('mensaje demasiado corto', async ({ page }) => {
    await openContact(page);
    await showMobilePage(page);
    await fillContact(page, { email: 'ana@example.com', mensaje: 'corto' });
    await waitForTurnstileToken(page);
    await submitButton(page).click();
    await expect(fieldError(page, 'mensaje')).toHaveText('Escribe al menos 10 caracteres.');
  });
});

test.describe('Anti-spam', () => {
  test('honeypot marcado: responde como si se hubiera enviado, pero no envía', async ({ page, request }) => {
    const marker = uniqueMarker();
    await openContact(page);
    await showMobilePage(page);
    await fillContact(page, {
      email: 'bot@example.com',
      mensaje: `Mensaje de un bot ${marker}`,
      honeypot: true,
    });
    await waitForTurnstileToken(page);

    const response = page.waitForResponse((res) => res.url().includes('/_actions/contact.send'));
    await submitButton(page).click();
    expect((await response).status()).toBe(200);

    await expect(sentMessage(page)).toBeVisible();
    expect(await sentEmails(request, marker)).toHaveLength(0);
  });

  test('sin token de Turnstile no se envía y se avisa', async ({ page, request }) => {
    const marker = uniqueMarker();
    await openContact(page);
    await showMobilePage(page);
    await fillContact(page, { email: 'ana@example.com', mensaje: `Mensaje sin comprobación ${marker}` });
    await waitForTurnstileToken(page);
    // Como si el widget no hubiera terminado: se le quita el token.
    await page.evaluate(() => {
      const input = document.querySelector<HTMLInputElement>('[name="cf-turnstile-response"]');
      if (input) input.value = '';
      (window as unknown as { turnstile?: { getResponse(): undefined } }).turnstile!.getResponse = () => undefined;
    });
    await submitButton(page).click();

    await expect(formAlert(page)).toBeVisible();
    await expect(formAlert(page)).toContainText(TEXT.turnstileMissing);
    expect(await sentEmails(request, marker)).toHaveLength(0);
  });

  test(`más de ${CONTACT_RATE_LIMIT.max} envíos en una hora desde la misma IP → 429`, async ({ page, request }) => {
    const ip = uniqueIp();
    const marker = uniqueMarker();
    await openContact(page, { ip });
    await showMobilePage(page);

    for (let i = 1; i <= CONTACT_RATE_LIMIT.max; i++) {
      await fillContact(page, { email: 'ana@example.com', mensaje: `Mensaje número ${i} ${marker}` });
      await waitForTurnstileToken(page);
      await submitButton(page).click();
      await expect(sentMessage(page)).toBeVisible();
      // Vuelve al formulario limpio para el siguiente envío.
      await page.reload();
      await showMobilePage(page);
    }
    expect(await sentEmails(request, marker)).toHaveLength(CONTACT_RATE_LIMIT.max);

    // El sexto: la Action responde 429 y se ve el aviso.
    await fillContact(page, {
      email: 'ana@example.com',
      mensaje: `Mensaje número ${CONTACT_RATE_LIMIT.max + 1} ${marker}`,
    });
    await waitForTurnstileToken(page);
    const response = page.waitForResponse((res) => res.url().includes('/_actions/contact.send'));
    await submitButton(page).click();
    expect((await response).status()).toBe(429);
    await expect(formAlert(page)).toContainText(TEXT.rateLimited);
    await expect(sentMessage(page)).toBeHidden();
    expect(await sentEmails(request, marker)).toHaveLength(CONTACT_RATE_LIMIT.max);
  });
});

test.describe('Si falla el envío', () => {
  test('muestra el aviso y deja reintentar', async ({ page, request }) => {
    const marker = uniqueMarker();
    await openContact(page);
    await showMobilePage(page);
    // El Resend simulado devuelve 500 con esta marca en el mensaje.
    await fillContact(page, {
      email: 'ana@example.com',
      mensaje: `Mensaje que falla [e2e:resend-500] ${marker}`,
    });
    await waitForTurnstileToken(page);
    const response = page.waitForResponse((res) => res.url().includes('/_actions/contact.send'));
    await submitButton(page).click();
    expect((await response).status()).toBe(502);
    await expect(formAlert(page)).toContainText(TEXT.error);
    await expect(form(page)).toBeVisible();
    expect(await sentEmails(request, marker)).toHaveLength(0);

    // «reintentar» vuelve a enviar; ahora sin la marca que provoca el fallo.
    await page.locator('[name="mensaje"]').fill(`Mensaje que ya funciona ${marker}`);
    await page.getByRole('button', { name: TEXT.retry }).click();
    await expect(sentMessage(page)).toBeVisible();
    await waitForEmail(request, marker);
  });

  test('reintenta una vez si Resend falla solo el primer intento', async ({ page, request }) => {
    const marker = uniqueMarker();
    await openContact(page);
    await showMobilePage(page);
    await fillContact(page, {
      email: 'ana@example.com',
      mensaje: `Mensaje con un fallo pasajero [e2e:resend-500-once] ${marker}`,
    });
    await waitForTurnstileToken(page);
    await submitButton(page).click();
    await expect(sentMessage(page)).toBeVisible();

    const email = await waitForEmail(request, marker);
    // Dos intentos, un solo email: la clave de idempotencia evita duplicados.
    expect(email.attempts).toBe(2);
    expect(await sentEmails(request, marker)).toHaveLength(1);
  });
});

test.describe('Sin JavaScript', () => {
  test.use({ javaScriptEnabled: false });

  test('el POST funciona y acaba en /mensaje-enviado', async ({ page, request }) => {
    const marker = uniqueMarker();
    await page.setExtraHTTPHeaders({ 'CF-Connecting-IP': uniqueIp() });
    // Sin JavaScript no hay widget de Turnstile: se añade el token al POST como
    // lo haría el widget (así se prueba el camino del servidor, C17).
    await page.route(/\/contact\?_action=contact\.send/, async (route) => {
      const body = route.request().postData() ?? '';
      await route.continue({ postData: `${body}&cf-turnstile-response=${encodeURIComponent(DUMMY_TOKEN)}` });
    });
    await page.goto('/contact');

    // El aviso del <noscript> explica que hace falta JavaScript (en Cloudflare
    // lo necesita Turnstile).
    await expect(page.locator('.contact-form__noscript')).toHaveText(TEXT.noscript);
    // En móvil, sin JavaScript no hay capas: el menú y la página se ven a la vez.
    if (isMobileViewport(page.viewportSize())) {
      await expect(page.locator('#panel')).toBeVisible();
      await expect(menu(page)).toBeVisible();
    }

    await fillContact(page, {
      email: 'ana@example.com',
      telefono: '600112233',
      mensaje: `Mensaje enviado sin JavaScript ${marker}`,
    });
    await submitButton(page).click();

    // POST → redirección → GET: se llega a una página de verdad, así que
    // recargar no reenvía.
    await expect(page).toHaveURL(/\/mensaje-enviado\/?$/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('mensaje enviado');
    await expect(page.getByText(TEXT.success)).toBeVisible();
    await expect(form(page)).toHaveCount(0);
    // Y esa página no va a los buscadores.
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);

    const email = await waitForEmail(request, marker);
    expect(email.body.subject).toBe('[web] mensaje de ana@example.com');

    // Desde ahí se vuelve a contact.
    await page.getByRole('link', { name: 'volver a contact' }).click();
    await expect(page).toHaveURL(/\/contact\/?$/);
  });

  test('un error vuelve a pintar la página con lo escrito', async ({ page }) => {
    await page.setExtraHTTPHeaders({ 'CF-Connecting-IP': uniqueIp() });
    await page.route(/\/contact\?_action=contact\.send/, async (route) => {
      const body = route.request().postData() ?? '';
      await route.continue({ postData: `${body}&cf-turnstile-response=${encodeURIComponent(DUMMY_TOKEN)}` });
    });
    await page.goto('/contact');
    // Un mensaje de solo espacios pasa el `required` y el `minlength` del
    // navegador, pero el servidor lo recorta y lo rechaza: así se prueba el
    // camino sin JavaScript.
    await fillContact(page, { email: 'ana@example.com', mensaje: ' '.repeat(15) });
    await submitButton(page).click();

    await expect(fieldError(page, 'mensaje')).toHaveText('Escribe tu mensaje.');
    await expect(page.locator('[name="email"]')).toHaveValue('ana@example.com');
    // El primer campo con error recibe el foco al cargar la página.
    await expect(page.locator('[name="mensaje"]')).toHaveAttribute('autofocus', '');
    // Y sigue sin enviarse nada (el formulario está a la vista, no el aviso).
    await expect(sentMessage(page)).toBeHidden();
  });
});

test.describe('Correo, redes y pie legal', () => {
  test('SoundCloud e Instagram se abren en otra pestaña', async ({ page }) => {
    await openContact(page);
    await showMobilePage(page);
    await waitForTurnstileToken(page);
    for (const [label, href] of [
      ['SoundCloud', 'https://soundcloud.com/travest15m0'],
      ['Instagram', 'https://www.instagram.com/travest15m0/'],
    ]) {
      const link = page.getByRole('link', { name: new RegExp(`^${label}`) });
      await expect(link).toHaveAttribute('href', href!);
      await expect(link).toHaveAttribute('target', '_blank');
      await expect(link).toHaveAttribute('rel', /noopener/);
    }
  });

  test('el email de Pau está a la vista como mailto (D58), y su teléfono no', async ({ page }) => {
    await openContact(page);
    await showMobilePage(page);
    const link = page.getByRole('link', { name: SITE.contactEmail });
    await expect(link).toHaveAttribute('href', `mailto:${SITE.contactEmail}`);
    // No abre pestaña nueva: es el programa de correo.
    await expect(link).not.toHaveAttribute('target', '_blank');
    // El teléfono sigue sin aparecer.
    expect(await page.content()).not.toMatch(/tel:|\+34\s?\d{2}\s?\d{2}/);
  });

  test('el pie lleva al aviso legal y a la privacidad, con sus TODO a la vista', async ({ page }) => {
    await openContact(page);
    await showMobilePage(page);
    // Con el widget ya pintado, el pie no se mueve mientras se pulsa.
    await waitForTurnstileToken(page);
    await page.getByRole('link', { name: 'privacidad', exact: true }).first().click();
    await expect(page).toHaveURL(/\/privacidad\/?$/);
    await expect(page.locator('html')).toHaveAttribute('data-section', 'none');
    await expect(page.locator('.todo').first()).toBeVisible();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('privacidad');

    await page.goto('/aviso-legal');
    await expect(page.locator('.todo').first()).toBeVisible();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('aviso legal');
    // Enlaza de vuelta a contact.
    await page.getByRole('link', { name: 'volver a contact' }).click();
    await expect(page).toHaveURL(/\/contact\/?$/);
  });
});

test.describe('Cursor sobre el widget (C10)', () => {
  test.skip(({ viewport }) => isMobileViewport(viewport), 'Solo escritorio (hay cursor)');

  test('el círculo se oculta y vuelve el cursor del sistema', async ({ page }) => {
    await openContact(page);
    await showMobilePage(page);
    await waitForTurnstileToken(page);
    const widget = page.locator('[data-turnstile]');
    // Sobre el widget manda el cursor del sistema (también dentro del iframe).
    await expect(widget).toHaveCSS('cursor', 'auto');

    const cursor = page.locator('[data-cursor]');
    // Primero, sobre el texto de la página: el círculo se ve.
    await page.locator('.contact__intro').hover();
    await expect(cursor).toHaveAttribute('data-visible', '');
    await expect(cursor).toHaveCSS('opacity', '1');

    // Sobre el hueco del widget, el círculo desaparece.
    const box = (await widget.boundingBox())!;
    await page.mouse.move(box.x + box.width - 8, box.y + 8);
    await expect(cursor).not.toHaveAttribute('data-visible', '');

    // Y encima del propio iframe, donde el navegador ya no manda eventos.
    await page.locator('[data-turnstile] iframe').hover();
    await expect(cursor).toHaveCSS('opacity', '0');
  });
});

test.describe('Cabeceras de seguridad (§11)', () => {
  test('la CSP deja cargar Turnstile y nada se queda bloqueado al navegar', async ({ page }) => {
    // Las violaciones de CSP salen por la consola del navegador.
    const violations: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'error' && /Content Security Policy/i.test(message.text())) violations.push(message.text());
    });

    await page.setExtraHTTPHeaders({ 'CF-Connecting-IP': uniqueIp() });
    await mockTurnstile(page);
    const response = await page.goto('/contact');
    const csp = response?.headers()['content-security-policy'] ?? '';
    expect(csp).toContain("script-src 'self' https://challenges.cloudflare.com");
    expect(csp).toContain('frame-src https://challenges.cloudflare.com');
    expect(response?.headers()['x-content-type-options']).toBe('nosniff');
    expect(response?.headers()['referrer-policy']).toBe('strict-origin-when-cross-origin');
    expect(response?.headers()['permissions-policy']).toContain('camera=()');

    // Con el widget puesto (script e iframe de challenges.cloudflare.com).
    await showMobilePage(page);
    await waitForTurnstileToken(page);

    // Y recorriendo la web: la CSP de la primera página es la que manda en
    // todas (el ClientRouter no recarga), incluido el vídeo de Media, que usa
    // hls.js y `blob:`. En escritorio se navega por el menú; en móvil, con
    // enlaces directos (el menú se solapa con el vídeo durante la animación).
    const mobile = isMobileViewport(page.viewportSize());
    for (const section of [
      { label: 'media', path: '/media' },
      { label: 'archive', path: '/archive' },
      { label: 'next dates', path: '/next-dates' },
      { label: 'info', path: '/' },
    ]) {
      if (mobile) await page.goto(section.path);
      else await menuLink(page, section.label).click();
      await page.waitForLoadState('load');
      // Margen para lo que se carga después (segmentos de vídeo, pósters).
      await page.waitForTimeout(section.label === 'media' ? 1_500 : 300);
    }
    expect(violations).toEqual([]);
  });

  test('las páginas legales, que son estáticas, también llevan las cabeceras', async ({ page }) => {
    const response = await page.goto('/privacidad');
    expect(response?.headers()['content-security-policy']).toContain('https://challenges.cloudflare.com');
    expect(response?.headers()['x-content-type-options']).toBe('nosniff');
  });
});
