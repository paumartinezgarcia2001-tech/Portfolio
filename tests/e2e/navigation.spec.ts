import { expect, test } from '@playwright/test';
import {
  MENU_FG_RGB,
  SECTION_CASES,
  accentOf,
  backButton,
  expectAccent,
  isMobile,
  isMobileViewport,
  markNode,
  menu,
  menuLink,
  openMobileMenu,
  pathRegExp,
  readMark,
} from './helpers';

test.describe('Info por defecto', () => {
  test('se abre Info con el acento rosa', async ({ page }, testInfo) => {
    await page.goto('/');
    const html = page.locator('html');
    await expect(html).toHaveAttribute('data-section', 'info');
    await expect(html).toHaveAttribute('lang', 'es');
    await expectAccent(page, 'rgb(255, 0, 255)');
    await expect(page).toHaveTitle('info — travest15m0');

    // La barra de noticias usa el acento.
    await expect(page.locator('[data-ticker]')).toHaveCSS('background-color', 'rgb(255, 0, 255)');

    if (isMobile(testInfo)) {
      // Móvil: se ve la página con su título y el botón atrás; el menú no.
      await expect(page.getByRole('heading', { level: 1, name: 'info' })).toBeVisible();
      await expect(backButton(page)).toBeVisible();
      await expect(backButton(page)).toHaveAttribute('aria-label', 'Volver al menú');
      await expect(menu(page)).toBeHidden();
    } else {
      const info = menuLink(page, 'info');
      await expect(info).toHaveAttribute('aria-current', 'page');
      await expect(info).toHaveCSS('color', 'rgb(255, 0, 255)');
      await expect(backButton(page)).toBeHidden();
    }
  });
});

test.describe('Menú (escritorio)', () => {
  test.skip(({ viewport }) => isMobileViewport(viewport), 'Solo escritorio');

  test('al pasar el ratón cada ítem toma su propio color', async ({ page }) => {
    await page.goto('/');
    for (const section of SECTION_CASES) {
      const link = menuLink(page, section.label);
      await link.hover();
      await expect(link).toHaveCSS('color', section.rgb);
      // El activo (info) conserva su color aunque el ratón esté en otro.
      if (section.key !== 'info') {
        await expect(menuLink(page, 'info')).toHaveCSS('color', 'rgb(255, 0, 255)');
      }
    }
    // Al salir, los inactivos vuelven al gris del menú.
    await page.mouse.move(1200, 450);
    await expect(menuLink(page, 'archive')).toHaveCSS('color', MENU_FG_RGB);
  });

  test('el reproductor se pone violeta al pasar el ratón', async ({ page }) => {
    await page.goto('/');
    const player = page.getByRole('region', { name: 'Reproductor de mixes' });
    await expect(player).toContainText('reproductor');
    await player.hover();
    await expect(player.getByRole('button')).toHaveCSS('color', 'rgb(191, 0, 255)');
  });

  test('pulsar el ítem activo no navega', async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => {
      document.addEventListener('astro:before-preparation', () => {
        (window as unknown as { __navigated: boolean }).__navigated = true;
      });
    });
    await menuLink(page, 'info').click();
    await page.waitForTimeout(300);
    expect(await page.evaluate(() => (window as unknown as { __navigated?: boolean }).__navigated)).toBeUndefined();
    await expect(page).toHaveURL(/\/$/);
  });
});

test.describe('Navegación entre secciones', () => {
  test('cada sección cambia la URL, data-section, aria-current y el foco sin recargar', async ({
    page,
  }, testInfo) => {
    const mobile = isMobile(testInfo);
    await page.goto('/');
    await markNode(page, '#left', 'persist');
    await page.evaluate(() => {
      (window as unknown as { __noReload: boolean }).__noReload = true;
    });

    // Recorre las secciones en orden y vuelve a info.
    const route = [...SECTION_CASES.slice(1), SECTION_CASES[0]!];
    for (const section of route) {
      if (mobile) await openMobileMenu(page);
      await menuLink(page, section.label).click();

      await expect(page).toHaveURL(pathRegExp(section.path));
      const html = page.locator('html');
      await expect(html).toHaveAttribute('data-section', section.key);
      await expect(html).toHaveAttribute('data-view', 'page');
      await expectAccent(page, section.rgb);
      await expect(page).toHaveTitle(`${section.label} — travest15m0`);

      // aria-current solo en el ítem de la sección.
      const current = page.locator('[data-menu-link][aria-current="page"]');
      await expect(current).toHaveCount(1);
      await expect(current).toHaveAttribute('data-menu-link', section.key);

      // Foco en el <h1> de la sección y panel arriba del todo.
      await expect(page.locator('#panel h1')).toBeFocused();
      expect(await page.locator('#panel').evaluate((el) => el.scrollTop)).toBe(0);

      // Sin recarga: la columna izquierda es el mismo nodo.
      expect(await readMark(page, '#left')).toBe('persist');
      expect(await page.evaluate(() => (window as unknown as { __noReload?: boolean }).__noReload)).toBe(true);

      if (mobile) {
        await expect(page.getByRole('heading', { level: 1, name: section.label })).toBeVisible();
        await expect(menu(page)).toBeHidden();
      }
    }
  });

  test('el acento cambia con una transición de 0,5 s', async ({ page }) => {
    await page.goto('/');
    const duration = await page.evaluate(() => getComputedStyle(document.documentElement).transitionDuration);
    expect(duration).toContain('0.5s');
    expect(await accentOf(page)).toBe('rgb(255, 0, 255)');
  });

  test('una ruta desconocida da 404 dentro del layout', async ({ page }) => {
    const response = await page.goto('/esto-no-existe');
    expect(response?.status()).toBe(404);
    await expect(page.locator('html')).toHaveAttribute('data-section', 'none');
    await expect(page.getByText('Esta página no existe.')).toBeVisible();
    await expect(page.getByRole('link', { name: 'volver a info' })).toBeVisible();
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex,nofollow');
  });

  test('el enlace «Saltar al contenido» lleva el foco al panel', async ({ page }, testInfo) => {
    test.skip(isMobile(testInfo), 'Teclado: escritorio');
    await page.goto('/');
    await page.keyboard.press('Tab');
    const skip = page.getByRole('link', { name: 'Saltar al contenido' });
    await expect(skip).toBeFocused();
    await expect(skip).toBeInViewport();
    await page.keyboard.press('Enter');
    await expect(page.locator('#panel')).toBeFocused();
  });
});

test.describe('Móvil', () => {
  test.skip(({ viewport }) => !isMobileViewport(viewport), 'Solo móvil');

  test('atrás → menú → sección → página', async ({ page }) => {
    await page.goto('/');
    const html = page.locator('html');
    await expect(html).toHaveAttribute('data-view', 'page');

    // Atrás: se abre el menú y el foco va al primer enlace.
    await backButton(page).click();
    await expect(html).toHaveAttribute('data-view', 'menu');
    await expect(backButton(page)).toHaveAttribute('aria-expanded', 'true');
    await expect(backButton(page)).toHaveAttribute('aria-label', 'Cerrar menú');
    await expect(menuLink(page, 'info')).toBeFocused();
    await expect(menu(page)).toBeInViewport({ ratio: 0.9 });
    // La barra de noticias está dentro de la capa del menú.
    await expect(page.locator('[data-ticker]')).toBeVisible();
    // El panel sale del foco cuando el menú termina de entrar.
    await expect(page.locator('#panel')).toBeHidden();

    // Elegir una sección: el menú sale y aparece la página.
    await menuLink(page, 'archive').click();
    await expect(page).toHaveURL(/\/archive\/?$/);
    await expect(html).toHaveAttribute('data-view', 'page');
    await expect(page.getByRole('heading', { level: 1, name: 'archive' })).toBeVisible();
    await expect(menu(page)).toBeHidden();
    await expect(backButton(page)).toHaveAttribute('aria-expanded', 'false');
    await expect(backButton(page)).toHaveAttribute('aria-label', 'Volver al menú');
  });

  test('el menú entra y sale deslizándose (300 ms)', async ({ page }) => {
    await page.goto('/');
    // Cada vez que cambia data-view se anota si la capa del menú arranca una
    // transición de `left` (y cuánto dura). No depende de la velocidad de la
    // máquina: getAnimations() crea la transición en ese mismo instante.
    await page.evaluate(() => {
      const w = window as unknown as { __views: { view?: string; duration: unknown }[] };
      w.__views = [];
      new MutationObserver(() => {
        const left = document.getElementById('left')!;
        const slide = left
          .getAnimations()
          .find((a) => (a as CSSTransition).transitionProperty === 'left');
        w.__views.push({
          view: document.documentElement.dataset.view,
          duration: slide ? (slide.effect as KeyframeEffect).getTiming().duration : null,
        });
      }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-view'] });
    });
    const records = () =>
      page.evaluate(() => (window as unknown as { __views: { view?: string; duration: unknown }[] }).__views);

    // Entrada.
    await backButton(page).click();
    await expect.poll(records).toContainEqual({ view: 'menu', duration: 300 });
    await expect(menu(page)).toBeInViewport({ ratio: 0.9 });

    // Salida al elegir otra sección (la columna persiste entre páginas).
    await menuLink(page, 'contact').click();
    await expect(page.locator('html')).toHaveAttribute('data-section', 'contact');
    await expect.poll(async () => (await records()).at(-1)).toEqual({ view: 'page', duration: 300 });
    await expect(menu(page)).toBeHidden();
  });

  test('el botón × y la tecla Esc cierran el menú', async ({ page }) => {
    await page.goto('/next-dates');
    await openMobileMenu(page);
    await backButton(page).click();
    await expect(page.locator('html')).toHaveAttribute('data-view', 'page');
    await expect(menu(page)).toBeHidden();

    await openMobileMenu(page);
    await page.keyboard.press('Escape');
    await expect(page.locator('html')).toHaveAttribute('data-view', 'page');
    await expect(backButton(page)).toBeFocused();
    await expect(page).toHaveURL(/\/next-dates\/?$/);
  });

  test('pulsar la sección actual vuelve a la página sin navegar', async ({ page }) => {
    await page.goto('/media');
    await openMobileMenu(page);
    await menuLink(page, 'media').click();
    await expect(page.locator('html')).toHaveAttribute('data-view', 'page');
    await expect(page).toHaveURL(/\/media\/?$/);
    await expect(page.getByRole('heading', { level: 1, name: 'media' })).toBeVisible();
  });

  test('el botón atrás tiene un área táctil de al menos 48 × 48 px dentro de la pantalla', async ({ page }) => {
    await page.goto('/');
    const box = await backButton(page).boundingBox();
    expect(box).not.toBeNull();
    const visibleWidth = Math.min(box!.x + box!.width, 375) - Math.max(box!.x, 0);
    const visibleHeight = Math.min(box!.y + box!.height, 812) - Math.max(box!.y, 0);
    expect(visibleWidth).toBeGreaterThanOrEqual(48);
    expect(visibleHeight).toBeGreaterThanOrEqual(48);
  });
});
