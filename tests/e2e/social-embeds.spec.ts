import { expect, test, type Page } from '@playwright/test';
import { SOCIAL_TEXT, SOUNDCLOUD, instagramPosts, soundcloudPlayerUrl } from '../../src/config/social';
import { INSTAGRAM_ORIGIN, SOUNDCLOUD_ORIGIN, openContact, stubSocialWidgets as stubThirdParties } from './social-helpers';
import { ensureMusic, isMobileViewport, player, showMobilePage, withMusicPaused } from './helpers';

/**
 * D59 · widgets de contact.
 *
 * - **SoundCloud** va puesto al abrir la página, pero no suena hasta que le dan
 *   al play. Lo que se prueba aquí es justo eso: que no se cuela por encima de
 *   la música de la web (D43), y que cuando sí suena, la música se pausa y
 *   vuelve al salir.
 * - **Instagram**: publicaciones destacadas, cada una con su enlace.
 *
 * Ni los scripts ni los iframes se piden de verdad: se interceptan
 * (tests/e2e/social-helpers.ts), porque el contenedor no sale a esos dominios.
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

  test('sin aviso de cookies debajo (Luna ✓ 02-10): lo dicen los propios widgets', async ({ page }) => {
    await stubThirdParties(page);
    await withMusicPaused(page);
    await openContact(page);
    await showMobilePage(page);
    expect(await page.locator('.embed__notice').count()).toBe(0);
    await expect(page.locator('soundcloud-embed')).not.toContainText(/cookies/i);
  });

  test('los dos widgets ocupan todo el ancho de la columna', async ({ page }) => {
    await stubThirdParties(page);
    await withMusicPaused(page);
    await openContact(page);
    await showMobilePage(page);
    const anchos = await page.evaluate(() => {
      const ancho = (selector: string) => {
        const element = document.querySelector(selector);
        return element ? Math.round(element.getBoundingClientRect().width) : 0;
      };
      // El email no se mide: es un enlace y ocupa lo que ocupa su texto.
      return {
        columna: ancho('#panel .contact'),
        escucha: ancho('soundcloud-embed'),
        instagram: ancho('instagram-posts'),
      };
    });
    expect(anchos.columna).toBeGreaterThan(0);
    for (const clave of ['escucha', 'instagram'] as const) {
      expect(Math.abs(anchos[clave] - anchos.columna), clave).toBeLessThanOrEqual(1);
    }
  });

  test('debajo, el enlace al perfil: «soundcloud ↗» (Luna ✓ 02-10)', async ({ page }) => {
    await stubThirdParties(page);
    await withMusicPaused(page);
    await openContact(page);
    await showMobilePage(page);
    const link = page.locator('soundcloud-embed ~ .embed__link a');
    await expect(link).toHaveAttribute('href', 'https://soundcloud.com/travest15m0');
    await expect(link).toContainText(SOCIAL_TEXT.soundcloud.profileLabel);
    await expect(link).toHaveAttribute('target', '_blank');
  });

  test('va centrado en la columna de la página', async ({ page }) => {
    await stubThirdParties(page);
    await withMusicPaused(page);
    await openContact(page);
    await showMobilePage(page);
    const centrado = await page.evaluate(() => {
      const section = document.querySelector('soundcloud-embed')?.closest('.embed');
      const panel = document.querySelector('#panel .contact');
      if (!section || !panel) return null;
      const a = section.getBoundingClientRect();
      const b = panel.getBoundingClientRect();
      return Math.abs((a.left + a.right) / 2 - (b.left + b.right) / 2);
    });
    // A menos de 2 px del centro de la columna.
    expect(centrado).not.toBeNull();
    expect(centrado!).toBeLessThan(2);
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

  test('se cargan solas al abrir contact (Luna ✓ 02-10)', async ({ page }) => {
    const requests = await stubThirdParties(page);
    await openContact(page);
    await showMobilePage(page);

    const total = instagramPosts().length;
    await expect(page.locator('instagram-posts .instagram-media')).toHaveCount(total);
    for (const url of instagramPosts()) {
      await expect(page.locator(`.instagram-media[data-instgrm-permalink="${url}"]`)).toHaveCount(1);
    }
    // Y se ha pedido su script, sin que nadie pulse nada.
    await expect
      .poll(() => requests.some((request) => request.url().startsWith(`${INSTAGRAM_ORIGIN}/embed.js`)), {
        timeout: 10_000,
      })
      .toBe(true);
    await expect(page.locator('instagram-posts')).toHaveAttribute('data-state', 'ready');
  });

  test('cada publicación lleva su enlace dentro, por si el embed no carga', async ({ page }) => {
    await stubThirdParties(page);
    await openContact(page);
    await showMobilePage(page);
    for (const url of instagramPosts()) {
      const link = page.locator(`instagram-posts .instagram-media a[href="${url}"]`);
      await expect(link).toHaveCount(1);
      await expect(link).toHaveAttribute('target', '_blank');
    }
  });

  test('las tres van en la misma fila (Luna ✓ 02-10)', async ({ page }) => {
    test.skip(isMobileViewport(page.viewportSize()), 'En móvil la fila se desplaza en horizontal.');
    await stubThirdParties(page);
    await openContact(page);
    await showMobilePage(page);

    const cajas = await page.locator('instagram-posts .instagram-media').evaluateAll((nodes) =>
      nodes.map((node) => {
        const { x, y, width } = node.getBoundingClientRect();
        return { x: Math.round(x), y: Math.round(y), width: Math.round(width) };
      }),
    );
    expect(cajas).toHaveLength(3);
    // Misma línea: todas empiezan a la misma altura.
    expect(new Set(cajas.map((caja) => caja.y)).size).toBe(1);
    // Y una detrás de otra, de izquierda a derecha.
    expect(cajas[1]!.x).toBeGreaterThan(cajas[0]!.x);
    expect(cajas[2]!.x).toBeGreaterThan(cajas[1]!.x);
    // Del mismo ancho (columnas iguales).
    expect(Math.abs(cajas[0]!.width - cajas[2]!.width)).toBeLessThanOrEqual(1);
  });

  test('debajo, el enlace al perfil: «instagram ↗» (Luna ✓ 02-10)', async ({ page }) => {
    await stubThirdParties(page);
    await openContact(page);
    await showMobilePage(page);
    const link = page.locator('instagram-posts ~ .embed__link a');
    await expect(link).toHaveAttribute('href', 'https://www.instagram.com/travest15m0/');
    await expect(link).toContainText(SOCIAL_TEXT.instagram.profileLabel);
  });

  test('una publicación que no carga deja su enlace en un marco (02-10)', async ({ page }) => {
    await stubThirdParties(page);
    // Simula lo que hace embed.js con una publicación borrada: le mete delante
    // un iframe vacío y no llega a quitar el blockquote. Esta ruta se registra
    // después que la del helper, así que es la que manda.
    await page.route(`${INSTAGRAM_ORIGIN}/embed.js`, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/javascript; charset=utf-8',
        body: `(() => {
          const render = () => {
            [...document.querySelectorAll('blockquote.instagram-media')].forEach((quote, i) => {
              const frame = document.createElement('iframe');
              frame.className = i === 0 ? 'instagram-media' : 'instagram-media instagram-media-rendered';
              frame.setAttribute('height', i === 0 ? '0' : '320');
              frame.style.cssText = 'display:block;width:100%;border:0';
              quote.before(frame);
              if (i !== 0) quote.remove();
            });
          };
          window.instgrm = { Embeds: { process: render } };
          render();
        })();`,
      }),
    );
    await openContact(page);
    await showMobilePage(page);

    const fila = page.locator('instagram-posts');
    await expect(fila).toHaveAttribute('data-fallback', '1', { timeout: 20_000 });
    // El iframe vacío se tira: quedan los dos que sí cargaron.
    await expect(fila.locator('iframe')).toHaveCount(2);
    // Y la que falló se queda como marco con su enlace, no como una línea suelta.
    const caida = fila.locator('blockquote.ig__fallback');
    await expect(caida).toHaveCount(1);
    await expect(caida.locator('a')).toHaveAttribute('href', instagramPosts()[0]!);
    const caja = await caida.boundingBox();
    expect(caja!.height).toBeGreaterThan(100);
  });

  test('si el navegador bloquea embed.js (Brave…), los marcos y el aviso salen al momento (05-10)', async ({
    page,
  }) => {
    await stubThirdParties(page);
    // Como Brave con los escudos puestos: la petición ni llega.
    await page.route(`${INSTAGRAM_ORIGIN}/embed.js`, (route) => route.abort('blockedbyclient'));
    await openContact(page);
    await showMobilePage(page);

    const fila = page.locator('instagram-posts');
    // Mucho antes de los 8 s de margen que se dan a un embed lento.
    await expect(fila).toHaveAttribute('data-state', 'error', { timeout: 4_000 });
    await expect(fila.locator('blockquote.ig__fallback')).toHaveCount(instagramPosts().length, { timeout: 1_000 });
    await expect(page.locator('[data-ig-blocked]')).toBeVisible();
    await expect(page.locator('[data-ig-blocked]')).toHaveText(SOCIAL_TEXT.instagram.blocked);
  });

  test('si embed.js carga, el aviso de bloqueo no sale', async ({ page }) => {
    await stubThirdParties(page);
    await openContact(page);
    await showMobilePage(page);
    await expect(page.locator('instagram-posts')).toHaveAttribute('data-state', 'ready');
    await expect(page.locator('[data-ig-blocked]')).toBeHidden();
  });

  test('sin JavaScript quedan los enlaces de cada publicación', async ({ browser }) => {
    const context = await browser.newContext({ javaScriptEnabled: false });
    const noJs = await context.newPage();
    await stubThirdParties(noJs);
    await noJs.goto('/contact');
    await expect(noJs.locator('instagram-posts .instagram-media a')).toHaveCount(instagramPosts().length);
    await context.close();
  });
});

test.describe('Cabeceras de seguridad con los widgets puestos', () => {
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
      await expect(page.locator('.instagram-media').first()).toBeAttached();
    }
    await page.waitForTimeout(500);
    expect(violations).toEqual([]);
  });

  test('la CSP de las respuestas del Worker nombra los dos orígenes', async ({ page }) => {
    const response = await page.goto('/contact');
    const csp = response?.headers()['content-security-policy'] ?? '';
    expect(csp).toContain(`script-src 'self' ${SOUNDCLOUD_ORIGIN} ${INSTAGRAM_ORIGIN}`);
    expect(csp).toContain(`frame-src ${SOUNDCLOUD_ORIGIN} ${INSTAGRAM_ORIGIN}`);
  });
});

/** El cursor propio se esconde encima de los iframes (C10). */
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
