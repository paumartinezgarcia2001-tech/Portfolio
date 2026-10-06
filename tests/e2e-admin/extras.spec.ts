import { expect } from '@playwright/test';
import { mockState, openAdmin, resetSupabase, signInAsPau, test, toast } from './helpers';

/**
 * C19 · texto de Info, vídeo de Media y mixes con subida a R2.
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
