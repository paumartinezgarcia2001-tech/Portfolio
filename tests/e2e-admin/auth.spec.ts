import { expect } from '@playwright/test';
import { ADMIN_PATH, adminUrl, INTRUDER, mockState, PAU, resetSupabase, signIn, signInAsPau, test } from './helpers';

/**
 * C19 · Acceso al panel: ruta secreta, login, errores genéricos, cabeceras,
 * nada del panel sin sesión.
 */

test.beforeEach(async ({ request }) => {
  await resetSupabase(request);
});

test('sin sesión: solo el login, sin datos del panel', async ({ page }) => {
  await page.goto(adminUrl());
  await expect(page.getByRole('heading', { level: 1, name: 'panel' })).toBeVisible();
  await expect(page.getByLabel('usuario')).toBeVisible();
  const html = await page.content();
  // Ningún dato: ni bolos, ni el texto de la barra, ni el menú del panel.
  expect(html).not.toContain('SIROCO');
  expect(html).not.toContain('BORRADOR');
  expect(html).not.toContain('travest15m0 · DJ · Madrid');
  await expect(page.getByRole('navigation', { name: 'Panel' })).toHaveCount(0);
});

test('sin sesión, las subpáginas también piden entrar', async ({ page }) => {
  for (const path of ['archivo', 'mixes', 'info', 'video']) {
    await page.goto(adminUrl(path));
    await expect(page.getByLabel('usuario')).toBeVisible();
    expect(await page.content()).not.toContain('ARCHIVO 01');
  }
});

test('credenciales incorrectas → error genérico', async ({ page }) => {
  await signIn(page, { email: PAU.email, password: 'no-es-esta' });
  await expect(page.getByRole('alert')).toHaveText('Usuario o contraseña incorrectos.');
  // Un usuario que no existe da exactamente el mismo mensaje.
  await page.getByLabel('usuario').fill('nadie@e2e.test');
  await page.getByLabel('contraseña').fill('lo-que-sea');
  await page.getByRole('button', { name: 'entrar' }).click();
  await expect(page.getByRole('alert')).toHaveText('Usuario o contraseña incorrectos.');
  await expect(page.getByRole('button', { name: 'cerrar sesión' })).toHaveCount(0);
});

test('inyección SQL en el usuario o la contraseña: error genérico y nada cambia', async ({ page, request }) => {
  // El login no escribe SQL: el usuario y la contraseña van como datos a
  // Supabase Auth, y las consultas del panel usan el cliente de Supabase
  // (parámetros, nunca texto concatenado). Esto comprueba el comportamiento.
  const before = JSON.stringify((await mockState(request)).tables);
  for (const attempt of [
    { email: "' OR '1'='1", password: "' OR '1'='1" },
    { email: `${PAU.email}'--`, password: 'x' },
    { email: PAU.email, password: "' OR 1=1; DROP TABLE gigs; --" },
  ]) {
    await signIn(page, attempt);
    await expect(page.getByRole('alert')).toHaveText('Usuario o contraseña incorrectos.');
    await expect(page.getByRole('button', { name: 'cerrar sesión' })).toHaveCount(0);
  }
  // Ni una fila cambiada.
  expect(JSON.stringify((await mockState(request)).tables)).toBe(before);
});

test('más de 5 intentos por minuto desde la misma IP → bloqueado, también con la contraseña buena', async ({ page }) => {
  // El contador va por minutos de reloj (como en Cloudflare): si queda poco
  // para el siguiente, se espera a que empiece, para que los 6 intentos caigan
  // en el mismo minuto.
  const secondsLeft = 60 - (Date.now() / 1000) % 60;
  if (secondsLeft < 15) await page.waitForTimeout(secondsLeft * 1000 + 200);
  await page.goto(adminUrl());
  for (let i = 0; i < 5; i += 1) {
    await signIn(page, { email: PAU.email, password: `mala-${i}` });
    await expect(page.getByRole('alert')).toHaveText('Usuario o contraseña incorrectos.');
  }
  await signIn(page, PAU);
  await expect(page.getByRole('alert')).toHaveText('Demasiados intentos. Espera un rato antes de volver a probar.');
  await expect(page.getByRole('button', { name: 'cerrar sesión' })).toHaveCount(0);
});

test('una cuenta que no está en admins no entra (mismo error genérico)', async ({ page }) => {
  await signIn(page, INTRUDER);
  await expect(page.getByRole('alert')).toHaveText('Usuario o contraseña incorrectos.');
  await page.reload();
  await expect(page.getByLabel('usuario')).toBeVisible();
});

test('login correcto (con el email) → panel; cerrar sesión → login', async ({ page }) => {
  await signInAsPau(page);
  await expect(page.getByRole('heading', { level: 1, name: 'bolos y barra' })).toBeVisible();
  await expect(page.getByText('BORRADOR')).toBeVisible();
  await page.getByRole('button', { name: 'cerrar sesión' }).click();
  await expect(page.getByLabel('usuario')).toBeVisible();
  await page.goto(adminUrl('archivo'));
  await expect(page.getByLabel('usuario')).toBeVisible();
});

test('login con el alias (ADMIN_USERNAME), en mayúsculas', async ({ page }) => {
  await page.goto(adminUrl());
  await signIn(page, { email: PAU.alias.toUpperCase(), password: PAU.password });
  await expect(page.getByRole('heading', { level: 1, name: 'bolos y barra' })).toBeVisible();
});

test('sin JavaScript también se entra con el alias', async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto(adminUrl());
  await page.getByLabel('usuario').fill(PAU.alias);
  await page.getByLabel('contraseña').fill(PAU.password);
  await page.getByRole('button', { name: 'entrar' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'bolos y barra' })).toBeVisible();
  await context.close();
});

test('otro nombre de panel → 404 de verdad', async ({ page, request }) => {
  for (const path of ['/otro-slug', `/${ADMIN_PATH}x`, '/otro-slug/archivo', `/${ADMIN_PATH}/no-existe`]) {
    const response = await request.get(path);
    expect(response.status(), path).toBe(404);
    expect(await response.text()).toContain('Esta página no existe.');
  }
  const response = await page.goto('/otro-slug');
  expect(response?.status()).toBe(404);
  await expect(page.getByText('Esta página no existe.')).toBeVisible();
});

test('cabeceras: noindex, no-store y sin Referer hacia fuera', async ({ request }) => {
  const response = await request.get(adminUrl());
  expect(response.status()).toBe(200);
  const headers = response.headers();
  expect(headers['x-robots-tag']).toBe('noindex, nofollow');
  expect(headers['cache-control']).toContain('no-store');
  expect(headers['referrer-policy']).toBe('same-origin');
  expect(headers['content-security-policy']).toContain("frame-ancestors 'none'");
  expect(await response.text()).toContain('<meta name="robots" content="noindex,nofollow">');
});

test('robots.txt y la web pública no nombran el panel', async ({ request }) => {
  const robots = await request.get('/robots.txt');
  expect(await robots.text()).not.toContain(ADMIN_PATH);
  const sitemap = await request.get('/sitemap-index.xml');
  expect(await sitemap.text()).not.toContain(ADMIN_PATH);
  for (const path of ['/', '/next-dates', '/archive', '/media', '/contact']) {
    expect(await (await request.get(path)).text(), path).not.toContain(ADMIN_PATH);
  }
});

test('las Actions del panel no responden nada sin sesión', async ({ request }) => {
  const form = { texto: 'HACK', proximaFecha: 'true' };
  const response = await request.post('/_actions/admin.updateTicker', {
    multipart: form,
    headers: { Origin: 'http://localhost:4331' },
  });
  expect(response.status()).toBe(401);
  const body = await response.text();
  expect(body).not.toContain('travest15m0 · DJ · Madrid');
});
