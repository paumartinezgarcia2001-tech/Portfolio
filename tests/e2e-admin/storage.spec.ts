import { expect, type Page } from '@playwright/test';
import {
  R2_URL,
  adminUrl,
  fillR2,
  mockState,
  openAdmin,
  r2State,
  resetSupabase,
  signInAsPau,
  test,
  toast,
} from './helpers';

/**
 * D64 · R2 desde el panel: lo que ocupa (siempre a la vista), el límite de
 * 10 GB antes de subir nada, la conversión en el navegador (WAV → MP3 a
 * −14 LUFS, carátula a JPEG cuadrado) y que lo subido suena en la web.
 *
 * R2 está simulado (mock-r2.mjs): empieza con 450 MB (un vídeo y un mix).
 */

const LIMIT = 10_000_000_000;
const STARTING = 300_000_512 + 150_000_000;

test.beforeEach(async ({ request }) => {
  await resetSupabase(request);
});

/** WAV PCM de 16 bits con un tono de 997 Hz (amplitud 0,5 → unos −6 LUFS). */
function wav(seconds: number, sampleRate = 44100, channels = 2, amplitude = 0.5): Buffer {
  const frames = Math.round(seconds * sampleRate);
  const data = Buffer.alloc(frames * channels * 2);
  for (let i = 0; i < frames; i++) {
    const value = Math.round(amplitude * Math.sin((2 * Math.PI * 997 * i) / sampleRate) * 32767);
    for (let c = 0; c < channels; c++) data.writeInt16LE(value, (i * channels + c) * 2);
  }
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * channels * 2, 28);
  header.writeUInt16LE(channels * 2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

/** PNG de 1200 × 800 (rectangular: el panel lo recorta cuadrado). */
async function png(page: Page): Promise<Buffer> {
  const base64 = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 1200;
    canvas.height = 800;
    const context = canvas.getContext('2d')!;
    context.fillStyle = '#ff00ff';
    context.fillRect(0, 0, 1200, 800);
    return canvas.toDataURL('image/png').split(',')[1]!;
  });
  return Buffer.from(base64, 'base64');
}

const meter = (page: Page) => page.locator('[data-storage]');

test('el almacenamiento de R2 sale en todas las páginas del panel', async ({ page }) => {
  await signInAsPau(page);
  for (const path of ['', 'archivo', 'mixes', 'info', 'video', 'colores']) {
    await openAdmin(page, path);
    await expect(meter(page), `/${path}`).toContainText('almacenamiento R2');
    await expect(meter(page), `/${path}`).toContainText('450 MB de 10 GB (4,5 %)');
    await expect(meter(page)).toHaveAttribute('data-level', 'ok');
    await expect(page.getByRole('meter', { name: 'Almacenamiento de R2 ocupado' })).toHaveAttribute('aria-valuenow', '4.5');
  }
});

test('aviso desde el 80 % y «lleno» al llegar a 10 GB', async ({ page, request }) => {
  await fillR2(request, 8_100_000_000 - STARTING);
  await signInAsPau(page, 'mixes');
  await expect(meter(page)).toHaveAttribute('data-level', 'warn');
  await expect(meter(page)).toContainText('8,1 GB de 10 GB (81 %)');
  await expect(meter(page)).toContainText('casi lleno');

  await fillR2(request, LIMIT - STARTING);
  await page.reload();
  await expect(meter(page)).toHaveAttribute('data-level', 'full');
  await expect(meter(page)).toContainText('10 GB de 10 GB (100 %)');
  await expect(meter(page)).toContainText('lleno: borra algo antes de subir más');
});

test('WAV → MP3 a −14 LUFS en el navegador, se sube a R2 y suena en la web', async ({ page, request }) => {
  await signInAsPau(page, 'mixes');
  await page.getByLabel(/archivo de audio/).setInputFiles({ name: 'set.wav', mimeType: 'audio/wav', buffer: wav(3) });
  await page.getByLabel('título *').fill('Sesión de otoño');
  await page.getByLabel(/carátula/).setInputFiles({ name: 'tapa.png', mimeType: 'image/png', buffer: await png(page) });
  await page.getByRole('button', { name: 'subir y guardar' }).click();
  await expect(toast(page)).toHaveText('Guardado.', { timeout: 30_000 });
  await expect(page.getByRole('heading', { name: '2 mixes' })).toBeVisible();

  // En R2: un MP3 de verdad (MPEG-1 capa III a 320 kbps, 44,1 kHz) y un JPEG.
  const state = await r2State(request);
  const audioKey = Object.keys(state.objects).find((key) => /^mixes\/sesion-de-otono-[0-9a-f]{8}\.mp3$/.test(key))!;
  expect(audioKey).toBeTruthy();
  expect(state.objects[audioKey]!.type).toBe('audio/mpeg');
  expect(state.objects[audioKey]!.head).toMatch(/^fffbe0/);
  // 3 s a 320 kbps ≈ 120 kB (el WAV pesaba 529 kB).
  expect(state.objects[audioKey]!.size).toBeGreaterThan(100_000);
  expect(state.objects[audioKey]!.size).toBeLessThan(140_000);
  const coverKey = Object.keys(state.objects).find((key) => /caratula-[0-9a-f]{8}\.jpg$/.test(key))!;
  expect(state.objects[coverKey]!.type).toBe('image/jpeg');
  expect(state.objects[coverKey]!.head).toMatch(/^ffd8ff/);
  // El tipo va en la firma de la URL de subida.
  const puts = state.log.filter((entry) => entry.method === 'PUT');
  expect(puts).toHaveLength(2);
  for (const put of puts) expect(put.signedHeaders).toBe('content-type;host');
  // Antes de subir se midió el bucket y, al guardar, se comprobó lo subido.
  expect(state.log.filter((entry) => entry.method === 'LIST').length).toBeGreaterThanOrEqual(3);
  expect(state.log.some((entry) => entry.method === 'HEAD' && entry.key === audioKey)).toBe(true);

  const mix = (await mockState(request)).tables.mixes.find((item) => item.title === 'Sesión de otoño')!;
  expect(mix.audio_url).toBe(audioKey);
  expect(mix.artwork_url).toBe(coverKey);
  expect(mix.duration_seconds).toBe(3);
  expect(mix.published).toBe(true);

  // La barra de arriba ya cuenta lo nuevo (audio + carátula).
  const added = state.objects[audioKey]!.size + state.objects[coverKey]!.size;
  await expect(meter(page)).toHaveAttribute('data-used-bytes', String(STARTING + added));

  // Carátula: cuadrada (800 × 800, el lado corto del original).
  const cover = await page.evaluate(async (url) => {
    const blob = await (await fetch(url)).blob();
    const bitmap = await createImageBitmap(blob);
    return [bitmap.width, bitmap.height];
  }, `${R2_URL}/e2e-bucket/${coverKey}`);
  expect(cover).toEqual([800, 800]);

  // En la web: el reproductor lo tiene y el navegador lo reproduce. (El dominio
  // público del bucket, PUBLIC_MEDIA_BASE_URL, se sirve desde el R2 simulado.)
  await page.route('http://localhost:4322/mixes/**', async (route) => {
    const key = new URL(route.request().url()).pathname.slice(1);
    const response = await route.fetch({ url: `${R2_URL}/e2e-bucket/${key}` });
    await route.fulfill({ response, headers: { ...response.headers(), 'access-control-allow-origin': '*' } });
  });
  await page.goto('/');
  const payload = await page.locator('script[data-mixes]').textContent();
  expect(payload).toContain(`http://localhost:4322/${audioKey}`);
  const played = await page.evaluate(async (src) => {
    const audio = new Audio(src);
    audio.muted = true;
    await new Promise((resolve, reject) => {
      audio.addEventListener('loadedmetadata', resolve, { once: true });
      audio.addEventListener('error', () => reject(new Error(`error ${audio.error?.code}`)), { once: true });
    });
    return audio.duration;
  }, `http://localhost:4322/${audioKey}`);
  expect(played).toBeGreaterThan(2.9);
  expect(played).toBeLessThan(3.2);
});

test('volumen: el MP3 sale a −14 LUFS (lo mide el mismo código que la conversión)', async ({ page, request }) => {
  await signInAsPau(page, 'mixes');
  // Muy bajo (amplitud 0,02 ≈ −34 LUFS): hay que subirlo 20 dB.
  await page.getByLabel(/archivo de audio/).setInputFiles({ name: 'bajo.wav', mimeType: 'audio/wav', buffer: wav(4, 48000, 2, 0.02) });
  await page.getByLabel('título *').fill('Bajito');
  await page.getByRole('button', { name: 'subir y guardar' }).click();
  await expect(toast(page)).toHaveText('Guardado.', { timeout: 30_000 });
  const key = Object.keys((await r2State(request)).objects).find((item) => item.startsWith('mixes/bajito-'))!;
  const lufs = await page.evaluate(async (url) => {
    const bytes = await (await fetch(url)).arrayBuffer();
    const buffer = await new OfflineAudioContext(2, 1, 48000).decodeAudioData(bytes);
    // BS.1770 simplificado para un tono de 997 Hz: la ponderación K casi no lo toca (+0,69 dB).
    let sum = 0;
    const start = Math.floor(buffer.sampleRate * 0.5);
    const end = buffer.length - Math.floor(buffer.sampleRate * 0.5);
    for (let c = 0; c < 2; c++) {
      const data = buffer.getChannelData(c);
      let channel = 0;
      for (let i = start; i < end; i++) channel += data[i]! * data[i]!;
      sum += channel / (end - start);
    }
    return -0.691 + 10 * Math.log10(sum) + 0.69;
  }, `${R2_URL}/e2e-bucket/${key}`);
  expect(lufs).toBeGreaterThan(-14.6);
  expect(lufs).toBeLessThan(-13.4);
});

test('si no cabe en R2, no se convierte ni se sube nada', async ({ page, request }) => {
  // Quedan 50 kB libres: un MP3 de 3 s (~120 kB) no cabe.
  await fillR2(request, LIMIT - STARTING - 50_000);
  await signInAsPau(page, 'mixes');
  await expect(meter(page)).toHaveAttribute('data-level', 'warn');
  await page.getByLabel(/archivo de audio/).setInputFiles({ name: 'set.wav', mimeType: 'audio/wav', buffer: wav(3) });
  await page.getByLabel('título *').fill('No cabe');
  await page.getByRole('button', { name: 'subir y guardar' }).click();
  await expect(page.locator('[data-error-for="audio"]')).toContainText('No cabe: R2 ya tiene');
  await expect(page.locator('[data-error-for="audio"]')).toContainText('Quedan 50 kB');
  const state = await r2State(request);
  expect(state.log.filter((entry) => entry.method === 'PUT')).toHaveLength(0);
  expect((await mockState(request)).tables.mixes).toHaveLength(1);
});

test('el servidor también lo comprueba: no firma una subida que no cabe', async ({ page, request }) => {
  await fillR2(request, LIMIT - STARTING - 1000);
  await signInAsPau(page, 'mixes');
  const result = await page.evaluate(async () => {
    const data = new FormData();
    data.set('titulo', 'Trampa');
    data.set('tipo', 'audio');
    data.set('contentType', 'audio/mpeg');
    data.set('size', '5000');
    const response = await fetch('/_actions/admin.mixUploadUrl', { method: 'POST', body: data });
    return { status: response.status, body: await response.text() };
  });
  expect(result.status).toBe(409);
  expect(result.body).toContain('No cabe');

  // Y un mix con un archivo que no está en R2 no se crea.
  const missing = await page.evaluate(async () => {
    const data = new FormData();
    data.set('titulo', 'Fantasma');
    data.set('audio', 'mixes/fantasma-12345678.mp3');
    data.set('publicado', 'on');
    const response = await fetch('/_actions/admin.createMix', { method: 'POST', body: data });
    return { status: response.status, body: await response.text() };
  });
  expect(missing.status).toBe(400);
  expect(missing.body).toContain('no ha llegado a R2');
});

test('borrar un mix borra su archivo de R2 y libera espacio en la barra', async ({ page, request }) => {
  await signInAsPau(page, 'mixes');
  await expect(meter(page)).toContainText('450 MB de 10 GB');
  const item = page.locator('[data-region="mixes"] .a-item', { has: page.locator('input[value="MIX DE PRUEBA"]') });
  await item.getByRole('button', { name: 'Borrar MIX DE PRUEBA' }).click();
  await page.locator('dialog[data-admin-dialog]').getByRole('button', { name: 'borrar' }).click();
  await expect(toast(page)).toHaveText('Borrado.');
  await expect(meter(page)).toContainText('300 MB de 10 GB (3 %)');
  expect((await r2State(request)).objects['mixes/mix-de-prueba-0000aaaa.mp3']).toBeUndefined();
});

test('lo que no es audio no se sube', async ({ page, request }) => {
  await signInAsPau(page, 'mixes');
  await page.getByLabel(/archivo de audio/).setInputFiles({ name: 'foto.png', mimeType: 'image/png', buffer: Buffer.from('png') });
  await page.getByLabel('título *').fill('Esto no es audio');
  await page.getByRole('button', { name: 'subir y guardar' }).click();
  await expect(page.locator('[data-error-for="audio"]')).toContainText('El navegador no sabe leer este archivo');
  expect((await r2State(request)).log.filter((entry) => entry.method === 'PUT')).toHaveLength(0);
});

test('sin ADMIN: la barra no sale en el login', async ({ page }) => {
  await page.goto(adminUrl());
  await expect(meter(page)).toHaveCount(0);
});
