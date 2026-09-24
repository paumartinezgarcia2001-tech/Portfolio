import { expect, test } from '@playwright/test';
import { PAU, R2_ORIGIN, TOTP_CODE, mockState, openAdmin, resetSupabase, signIn, signInAsPau, toast, waitReady } from './helpers';

/**
 * C19 · P2 (fase 6): texto de Info, vídeo de Media, mixes con subida a R2 y
 * verificación en dos pasos.
 */

test.beforeEach(async ({ request }) => {
  await resetSupabase(request);
});

test('Info: parte del texto del repo, vista previa segura y aparece en la web', async ({ page }) => {
  await signInAsPau(page, 'info');
  const textarea = page.getByLabel('texto de info');
  await expect(textarea).toHaveValue(/## Info\n\nTRAVEST15M0 es un proyecto de DJ/);
  await expect(textarea).toHaveValue(/\[SoundCloud ↗\]\(https:\/\/soundcloud\.com\/travest15m0\)/);

  await textarea.fill('## Info\n\nTexto NUEVO de Pau <b>sin HTML</b>.\n\n## Booking\n\nEscríbeme desde [contact](/contact).');
  const preview = page.locator('[data-info-preview]');
  await expect(preview.locator('h2')).toHaveText(['Info', 'Booking']);
  await expect(preview).toContainText('Texto NUEVO de Pau <b>sin HTML</b>.');
  await expect(preview.locator('b')).toHaveCount(0);
  await page.getByRole('button', { name: 'guardar' }).click();
  await expect(toast(page)).toHaveText('Guardado.');

  await page.goto('/');
  const article = page.locator('article.info');
  await expect(article).toContainText('Texto NUEVO de Pau <b>sin HTML</b>.');
  // (En móvil la web abre en el menú: el texto está, aunque no a la vista.)
  await expect(article.locator('a', { hasText: 'contact' })).toHaveAttribute('href', '/contact');

  // Volver al original
  await openAdmin(page, 'info');
  await page.getByRole('button', { name: 'usar el texto original' }).click();
  await page.locator('dialog[data-admin-dialog]').getByRole('button', { name: 'volver al original' }).click();
  await expect(toast(page)).toHaveText('Vuelve a estar el texto original.');
  await page.goto('/');
  await expect(page.locator('article.info')).toContainText('TRAVEST15M0 es un proyecto de DJ');
});

test('vídeo: punto focal y enlace al set; «avanzado» valida el bloque', async ({ page, request }) => {
  await signInAsPau(page, 'video');
  await page.getByLabel(/horizontal/).fill('25');
  await page.getByLabel(/vertical/).fill('70');
  await expect(page.locator('[data-focus-dot]')).toHaveAttribute('style', /left: 25%; top: 70%/);
  await page.getByLabel('título').fill('Set de prueba');
  await page.getByLabel('enlace «ver set completo ↗»').check();
  await page.getByLabel('enlace', { exact: true }).fill('https://www.youtube.com/watch?v=XokoqVkCmQg&t=2541s');

  await page.getByText('avanzado: cambiar de vídeo').click();
  await page.getByLabel('bloque de video-to-hls').fill('esto no es un bloque');
  await page.getByRole('button', { name: 'guardar' }).click();
  await expect(page.locator('[data-error-for="bloque"]')).toContainText('No es un bloque válido');

  await page.getByLabel('bloque de video-to-hls').fill('');
  await page.getByRole('button', { name: 'guardar' }).click();
  await expect(toast(page)).toHaveText('Guardado.');
  const video = (await mockState(request)).tables.site_settings[0]!.video as Record<string, unknown>;
  expect(video).toMatchObject({ title: 'Set de prueba', focusX: 0.25, focusY: 0.7, slug: 'prueba-media' });
  expect(video.fullSet).toEqual({ href: 'https://www.youtube.com/watch?v=XokoqVkCmQg&t=2541s', label: 'ver set completo' });

  await page.goto('/media');
  await expect(page.locator('media-video')).toHaveAttribute('style', /--media-position: 25% 70%/);
  await expect(page.locator('media-video a', { hasText: 'ver set completo' })).toHaveAttribute(
    'href',
    'https://www.youtube.com/watch?v=XokoqVkCmQg&t=2541s',
  );
});

test('mixes: subir a R2 (URL firmada), publicar y quitar', async ({ page, request }) => {
  const uploads: Array<{ url: string; method: string; type: string | undefined }> = [];
  await page.route(`${R2_ORIGIN}/**`, async (route) => {
    const req = route.request();
    if (req.method() === 'OPTIONS') {
      return route.fulfill({
        status: 204,
        headers: {
          'access-control-allow-origin': '*',
          'access-control-allow-methods': 'PUT',
          'access-control-allow-headers': 'content-type, cache-control',
        },
      });
    }
    uploads.push({ url: req.url(), method: req.method(), type: req.headers()['content-type'] });
    return route.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*' }, body: '' });
  });

  await signInAsPau(page, 'mixes');
  await expect(page.getByRole('heading', { name: '1 mix' })).toBeVisible();
  await page.getByLabel(/archivo de audio/).setInputFiles({
    name: 'mi-mix.mp3',
    mimeType: 'audio/mpeg',
    buffer: Buffer.from('ID3 no es un mp3 de verdad'),
  });
  await page.getByLabel('título *').fill('Sesión de otoño');
  await page.getByLabel(/carátula/).setInputFiles({ name: 'tapa.jpg', mimeType: 'image/jpeg', buffer: Buffer.from('jpg') });
  await page.getByRole('button', { name: 'subir y guardar' }).click();
  await expect(toast(page)).toHaveText('Guardado.');
  await expect(page.getByRole('heading', { name: '2 mixes' })).toBeVisible();

  expect(uploads.map((upload) => upload.method)).toEqual(['PUT', 'PUT']);
  const audio = new URL(uploads[0]!.url);
  expect(audio.pathname).toMatch(/^\/e2e-bucket\/mixes\/sesion-de-otono-[0-9a-f]{8}\.mp3$/);
  expect(audio.searchParams.get('X-Amz-Signature')).toMatch(/^[0-9a-f]{64}$/);
  expect(uploads[0]!.type).toBe('audio/mpeg');
  expect(new URL(uploads[1]!.url).pathname).toMatch(/caratula-[0-9a-f]{8}\.jpg$/);

  const mix = (await mockState(request)).tables.mixes.find((item) => item.title === 'Sesión de otoño')!;
  expect(mix.audio_url).toBe(audio.pathname.replace('/e2e-bucket/', ''));
  expect(mix.published).toBe(true);

  // Despublicar el de prueba
  const item = page.locator('[data-region="mixes"] .a-item', { has: page.locator('input[value="MIX DE PRUEBA"]') });
  await item.getByLabel('publicado (suena en la web)').uncheck();
  await item.getByRole('button', { name: 'guardar' }).click();
  await expect(toast(page)).toHaveText('Guardado.');
  expect((await mockState(request)).tables.mixes.find((m) => m.title === 'MIX DE PRUEBA')!.published).toBe(false);

  // Borrar el nuevo (el archivo de R2 no se puede borrar desde los tests: lo avisa)
  const created = page.locator('[data-region="mixes"] .a-item', { has: page.locator('input[value="Sesión de otoño"]') });
  await created.getByRole('button', { name: 'Borrar Sesión de otoño' }).click();
  await page.locator('dialog[data-admin-dialog]').getByRole('button', { name: 'borrar' }).click();
  await expect(toast(page)).toContainText('Borrado.');
  await expect(page.getByRole('heading', { name: '1 mix' })).toBeVisible();
});

test('mixes: rechaza lo que no es audio', async ({ page }) => {
  await signInAsPau(page, 'mixes');
  await page.getByLabel(/archivo de audio/).setInputFiles({ name: 'foto.png', mimeType: 'image/png', buffer: Buffer.from('png') });
  await page.getByLabel('título *').fill('Esto no es audio');
  await page.getByRole('button', { name: 'subir y guardar' }).click();
  await expect(page.locator('[data-error-for="audio"]')).toHaveText('El audio tiene que ser MP3 o M4A.');
});

test('verificación en dos pasos: activar y entrar con el código', async ({ page, context }) => {
  await signInAsPau(page, 'seguridad');
  await page.getByRole('button', { name: 'activar' }).click();
  await expect(page.getByAltText('Código QR para la app de autenticación')).toBeVisible();
  await expect(page.locator('[data-mfa-secret]')).toHaveText('JBSWY3DPEHPK3PXP');
  await page.getByLabel('código').fill('000000');
  await page.getByRole('button', { name: 'confirmar' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'El código no es correcto' })).toBeVisible();
  await page.getByLabel('código').fill(TOTP_CODE);
  await page.getByRole('button', { name: 'confirmar' }).click();
  await expect(page.getByText('Activada: al entrar, el panel pide también el código de la app.')).toBeVisible();

  // Sesión nueva: después de la contraseña, el código.
  await context.clearCookies();
  await signIn(page, PAU);
  await expect(page.getByLabel('código')).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Panel' })).toHaveCount(0);
  expect(await page.content()).not.toContain('SIROCO');
  // Mientras falta el código, las Actions no dejan hacer nada.
  const blocked = await page.evaluate(async () => {
    const data = new FormData();
    data.set('texto', 'HACK');
    const response = await fetch('/_actions/admin.updateTicker', { method: 'POST', body: data });
    return response.status;
  });
  expect(blocked).toBe(401);
  await page.getByLabel('código').fill(TOTP_CODE);
  await waitReady(page);
  await page.getByRole('button', { name: 'continuar' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'bolos y barra' })).toBeVisible();
});
