import { expect, test, type Page } from '@playwright/test';
import { adminUrl, mockState, openAdmin, resetSupabase, signInAsPau, toast, waitReady } from './helpers';

/**
 * C19 · Barra de noticias y bolos: lo que se guarda en el panel aparece en la
 * web pública (que lee del mismo Supabase simulado).
 */

test.beforeEach(async ({ request }) => {
  await resetSupabase(request);
});

async function tickerText(page: Page): Promise<string> {
  return (await page.locator('#left [data-ticker] .visually-hidden').textContent()) ?? '';
}

test('cambiar el ticker → vista previa en vivo, contador y aparece en la web', async ({ page }) => {
  await signInAsPau(page);
  const textarea = page.getByLabel('texto', { exact: true });
  await textarea.fill('NUEVO DISCO YA DISPONIBLE');
  await expect(page.locator('[data-counter]').first()).toHaveText('25 / 500');
  const preview = page.locator('[data-ticker-preview] .visually-hidden');
  await expect(preview).toHaveText(/^NUEVO DISCO YA DISPONIBLE ✦ PRÓXIMA FECHA: 30 SEPTIEMBRE 2099 · SIROCO, Madrid$/);
  await page.getByLabel('añadir la próxima fecha automáticamente').uncheck();
  await expect(preview).toHaveText('NUEVO DISCO YA DISPONIBLE');
  await page.getByRole('button', { name: 'guardar' }).click();
  await expect(toast(page)).toHaveText('Guardado.');

  await page.goto('/');
  expect(await tickerText(page)).toBe('NUEVO DISCO YA DISPONIBLE');
  await page.goto('/archive');
  expect(await tickerText(page)).toBe('NUEVO DISCO YA DISPONIBLE');
});

test('el ticker no admite más de 500 caracteres', async ({ page }) => {
  await signInAsPau(page);
  await page.getByLabel('texto', { exact: true }).fill('x'.repeat(501));
  await expect(page.locator('[data-counter]').first()).toHaveAttribute('data-over', '');
  await page.getByRole('button', { name: 'guardar' }).click();
  await expect(page.locator('[data-error-for="texto"]')).toHaveText('Máximo 500 caracteres.');
});

test('crear un bolo futuro → next dates; editarlo; borrarlo', async ({ page, request }) => {
  await signInAsPau(page);
  const form = page.locator('[data-gig-form]');
  await form.getByLabel('fecha *').fill('2099-12-24');
  await form.getByLabel(/nombre de la fiesta/).fill('NOCHEBUENA E2E');
  await form.getByLabel('sala *').fill('  SALA  E2E ');
  await form.getByLabel('ciudad *').fill('Madrid');
  await form.getByLabel(/lineup/).fill('TRAVEST15M0,  INVITADA , ');
  await form.getByLabel(/enlace de entradas/).fill('https://example.com/e2e');
  await form.getByRole('button', { name: 'añadir' }).click();
  await expect(toast(page)).toHaveText('Guardado.');
  // El formulario se vacía y la lista de próximos se actualiza sola.
  await expect(form.getByLabel('sala *')).toHaveValue('');
  const item = page.locator('[data-region="upcoming"] .a-item', { hasText: 'NOCHEBUENA E2E' });
  await expect(item).toContainText('24 DICIEMBRE 2099');
  await expect(item).toContainText('SALA E2E, Madrid · TRAVEST15M0, INVITADA');

  const state = await mockState(request);
  const saved = state.tables.gigs.find((gig) => gig.party_name === 'NOCHEBUENA E2E')!;
  expect(saved).toMatchObject({ venue: 'SALA E2E', lineup: ['TRAVEST15M0', 'INVITADA'], ticket_url: 'https://example.com/e2e' });
  expect(saved.updated_by).toBe('11111111-1111-4111-8111-111111111111');

  // En móvil la web abre en el menú (D44): el bolo está en la página, aunque no a la vista.
  await page.goto('/next-dates');
  await expect(page.locator('.event', { hasText: 'NOCHEBUENA E2E' })).toContainText('24 DICIEMBRE 2099');

  // Editar
  await openAdmin(page);
  await page.locator('[data-region="upcoming"] .a-item', { hasText: 'NOCHEBUENA E2E' }).getByRole('link', { name: /Editar/ }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'editar bolo' })).toBeVisible();
  await waitReady(page);
  await page.getByLabel(/nombre de la fiesta/).fill('NOCHEBUENA EDITADA');
  await page.getByRole('button', { name: 'guardar cambios' }).click();
  await expect(toast(page)).toHaveText('Guardado.');
  await expect(page).toHaveURL(new RegExp(`${adminUrl()}$`));
  await page.goto('/next-dates');
  await expect(page.locator('.event', { hasText: 'NOCHEBUENA EDITADA' })).toBeAttached();

  // Borrar (con el <dialog>, nunca confirm())
  await openAdmin(page);
  page.on('dialog', () => {
    throw new Error('No debería salir un diálogo nativo');
  });
  const row = page.locator('[data-region="upcoming"] .a-item', { hasText: 'NOCHEBUENA EDITADA' });
  await row.getByRole('button', { name: /Borrar/ }).click();
  const dialog = page.locator('dialog[data-admin-dialog]');
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('¿Borrar NOCHEBUENA EDITADA del 24 DICIEMBRE 2099 en SALA E2E?');
  await dialog.getByRole('button', { name: 'cancelar' }).click();
  await expect(row).toBeVisible();
  await row.getByRole('button', { name: /Borrar/ }).click();
  await dialog.getByRole('button', { name: 'borrar' }).click();
  await expect(toast(page)).toHaveText('Borrado.');
  await expect(row).toHaveCount(0);
  await page.goto('/next-dates');
  await expect(page.locator('.event', { hasText: 'NOCHEBUENA' })).toHaveCount(0);
});

test('validación: fecha, sala, ciudad y enlace https', async ({ page }) => {
  await signInAsPau(page);
  const form = page.locator('[data-gig-form]');
  await form.getByLabel(/enlace de entradas/).fill('http://inseguro.example.com');
  await form.getByRole('button', { name: 'añadir' }).click();
  await expect(form.locator('[data-error-for="fecha"]')).toHaveText('Escribe una fecha válida.');
  await expect(form.locator('[data-error-for="sala"]')).toHaveText('Escribe la sala.');
  await expect(form.locator('[data-error-for="ciudad"]')).toHaveText('Escribe la ciudad.');
  await expect(form.locator('[data-error-for="entradas"]')).toHaveText('El enlace tiene que empezar por https://');
  await expect(form.getByLabel('fecha *')).toBeFocused();
  await expect(form.getByLabel('sala *')).toHaveAttribute('aria-invalid', 'true');
});

test('aviso de duplicado: cancelar o guardar igualmente', async ({ page, request }) => {
  await signInAsPau(page);
  const form = page.locator('[data-gig-form]');
  const fill = async () => {
    await form.getByLabel('fecha *').fill('2099-09-30');
    await form.getByLabel(/nombre de la fiesta/).fill('OTRA FIESTA');
    await form.getByLabel('sala *').fill('siroco');
    await form.getByLabel('ciudad *').fill('Madrid');
  };
  await fill();
  await form.getByRole('button', { name: 'añadir' }).click();
  const dialog = page.locator('dialog[data-admin-dialog]');
  await expect(dialog).toContainText('Ya hay un bolo en esa fecha y sala. ¿Quieres guardarlo igualmente?');
  await expect(dialog).toContainText('30 SEPTIEMBRE 2099 · INSULTO CLUB · SIROCO');
  await dialog.getByRole('button', { name: 'cancelar' }).click();
  expect((await mockState(request)).tables.gigs.filter((gig) => gig.event_date === '2099-09-30')).toHaveLength(1);

  await form.getByRole('button', { name: 'añadir' }).click();
  await dialog.getByRole('button', { name: 'guardar igualmente' }).click();
  await expect(toast(page)).toHaveText('Guardado.');
  expect((await mockState(request)).tables.gigs.filter((gig) => gig.event_date === '2099-09-30')).toHaveLength(2);

  // Exactamente el mismo bolo (fecha, sala y fiesta): no se puede.
  await fill();
  await form.getByRole('button', { name: 'añadir' }).click();
  await expect(toast(page)).toHaveText('Ese bolo ya existe: misma fecha, sala y fiesta.');
});

test('añadir varias fechas (residencia)', async ({ page, request }) => {
  await signInAsPau(page);
  const form = page.locator('[data-gig-form]');
  await form.getByLabel('fecha *').fill('2099-03-06');
  await form.getByLabel('añadir varias fechas').check();
  await expect(form.getByLabel('fecha *')).toBeHidden();
  await form.getByRole('button', { name: '+ la misma, una semana después' }).click();
  await form.getByRole('button', { name: '+ la misma, una semana después' }).click();
  await expect(form.getByLabel('Fecha', { exact: true })).toHaveCount(3);
  await expect(form.getByLabel('Fecha', { exact: true }).nth(2)).toHaveValue('2099-03-20');
  await form.getByLabel(/nombre de la fiesta/).fill('LA MARI');
  await form.getByLabel('sala *').fill('LA MARIQUEEN');
  await form.getByLabel('ciudad *').fill('Madrid');
  await form.getByLabel(/lineup/).fill('MANUELAC0RE, TRAVEST15M0');
  await form.getByRole('button', { name: 'añadir' }).click();
  await expect(toast(page)).toHaveText('Guardado. 3 fechas.');
  const gigs = (await mockState(request)).tables.gigs.filter((gig) => gig.party_name === 'LA MARI');
  expect(gigs.map((gig) => gig.event_date).sort()).toEqual(['2099-03-06', '2099-03-13', '2099-03-20']);
  // Tras guardar, el formulario vuelve a una sola fecha.
  await expect(form.getByLabel('fecha *')).toBeVisible();

  // Repetir con una fecha nueva: avisa de las que ya existen y salta esas.
  await form.getByLabel('añadir varias fechas').check();
  await form.getByLabel('Fecha', { exact: true }).first().fill('2099-03-13');
  await form.getByRole('button', { name: '+ la misma, una semana después' }).click();
  await form.getByRole('button', { name: '+ la misma, una semana después' }).click();
  await form.getByLabel(/nombre de la fiesta/).fill('LA MARI');
  await form.getByLabel('sala *').fill('LA MARIQUEEN');
  await form.getByLabel('ciudad *').fill('Madrid');
  await form.getByRole('button', { name: 'añadir' }).click();
  const dialog = page.locator('dialog[data-admin-dialog]');
  await expect(dialog).toContainText('Algunas fechas ya tienen un bolo en esa sala');
  await dialog.getByRole('button', { name: 'guardar igualmente' }).click();
  await expect(toast(page)).toHaveText('Guardado. 1 fecha (2 ya existían).');
  expect((await mockState(request)).tables.gigs.filter((gig) => gig.party_name === 'LA MARI')).toHaveLength(4);
});

test('los bolos sin publicar se ven en el panel pero no en la web', async ({ page }) => {
  await signInAsPau(page);
  await expect(page.locator('[data-region="upcoming"] .a-item', { hasText: 'BORRADOR' })).toContainText('sin publicar');
  await page.goto('/next-dates');
  await expect(page.locator('.event', { hasText: 'BORRADOR' })).toHaveCount(0);
});

test('archivo en páginas de 50, editable', async ({ page }) => {
  await signInAsPau(page, 'archivo');
  await expect(page.getByRole('heading', { name: '60 bolos' })).toBeVisible();
  await expect(page.locator('[data-region="archive"] .a-item')).toHaveCount(50);
  await expect(page.locator('[data-region="archive"] .a-item').first()).toContainText('ARCHIVO 60');
  await page.getByRole('link', { name: 'más antiguos →' }).click();
  await expect(page).toHaveURL(/pagina=2/);
  await waitReady(page);
  await expect(page.locator('[data-region="archive"] .a-item')).toHaveCount(10);
  const item = page.locator('[data-region="archive"] .a-item', { hasText: 'ARCHIVO 01' });
  await item.getByRole('link', { name: /Editar/ }).click();
  await waitReady(page);
  await page.getByLabel(/nombre de la fiesta/).fill('ARCHIVO 01 CORREGIDO');
  await page.getByRole('button', { name: 'guardar cambios' }).click();
  await expect(page).toHaveURL(/archivo\?pagina=2$/);
  await expect(page.locator('[data-region="archive"] .a-item', { hasText: 'ARCHIVO 01 CORREGIDO' })).toBeVisible();
  await page.goto('/archive');
  await expect(page.locator('.event', { hasText: 'ARCHIVO 01 CORREGIDO' })).toBeAttached();
});
