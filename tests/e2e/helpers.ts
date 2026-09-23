import { expect, type Locator, type Page, type TestInfo } from '@playwright/test';

export type SectionKey = 'info' | 'next' | 'media' | 'archive' | 'contact';

export interface SectionCase {
  key: SectionKey;
  label: string;
  path: string;
  /** Color propio, tal como lo devuelve getComputedStyle. */
  rgb: string;
}

/** Tabla del prompt maestro (§4.1 y C05). */
export const SECTION_CASES: SectionCase[] = [
  { key: 'info', label: 'info', path: '/', rgb: 'rgb(255, 0, 255)' },
  { key: 'next', label: 'next dates', path: '/next-dates', rgb: 'rgb(0, 255, 255)' },
  { key: 'media', label: 'media', path: '/media', rgb: 'rgb(255, 255, 0)' },
  { key: 'archive', label: 'archive', path: '/archive', rgb: 'rgb(0, 255, 0)' },
  { key: 'contact', label: 'contact', path: '/contact', rgb: 'rgb(255, 95, 31)' },
];

export const PLAYER_RGB = 'rgb(191, 0, 255)';
export const MENU_FG_RGB = 'rgb(197, 199, 214)';
export const PANEL_FG_RGB = 'rgb(39, 39, 43)';

/** ¿El proyecto usa el layout móvil (<1024 px)? */
export function isMobile(testInfo: TestInfo): boolean {
  return isMobileViewport(testInfo.project.use.viewport);
}

export function isMobileViewport(viewport: { width: number } | null | undefined): boolean {
  return (viewport?.width ?? 1280) < 1024;
}

export function pathRegExp(path: string): RegExp {
  const escaped = path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return path === '/' ? /\/$/ : new RegExp(`${escaped}/?$`);
}

export function menu(page: Page): Locator {
  return page.getByRole('navigation', { name: 'Secciones' });
}

export function menuLink(page: Page, label: string): Locator {
  return menu(page).getByRole('link', { name: label, exact: true });
}

export function backButton(page: Page): Locator {
  return page.locator('[data-back-button]');
}

/** Valor calculado del acento en <html>. */
export async function accentOf(page: Page): Promise<string> {
  return page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--accent').trim());
}

/** Espera a que el acento termine su transición y valga `rgb`. */
export async function expectAccent(page: Page, rgb: string): Promise<void> {
  await expect.poll(() => accentOf(page), { timeout: 3_000 }).toBe(rgb);
}

/** Marca un nodo para comprobar después que es el mismo (transition:persist). */
export async function markNode(page: Page, selector: string, value: string): Promise<void> {
  await page.evaluate(
    ([sel, val]) => {
      const el = document.querySelector(sel!) as (Element & { __e2eMark?: string }) | null;
      if (!el) throw new Error(`No existe ${sel}`);
      el.__e2eMark = val;
    },
    [selector, value],
  );
}

export async function readMark(page: Page, selector: string): Promise<string | undefined> {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel) as (Element & { __e2eMark?: string }) | null;
    return el?.__e2eMark;
  }, selector);
}

/**
 * Capa visible en móvil, ya quieta: tras navegar desde el menú abierto, la web
 * lo cierra con su animación (C08), así que `data-view` cambia solo durante un
 * momento. Se espera a que dos lecturas seguidas coincidan.
 */
export async function settledView(page: Page): Promise<string | null> {
  const html = page.locator('html');
  let previous = await html.getAttribute('data-view');
  for (let i = 0; i < 10; i++) {
    await page.waitForTimeout(150);
    const current = await html.getAttribute('data-view');
    if (current === previous) return current;
    previous = current;
  }
  return previous;
}

/**
 * Abre el menú en móvil con el botón atrás. Si ya está abierto (las secciones
 * abren en el menú en móvil, D44), no hace nada.
 */
export async function openMobileMenu(page: Page): Promise<void> {
  const html = page.locator('html');
  if ((await settledView(page)) !== 'menu') await backButton(page).click();
  await expect(html).toHaveAttribute('data-view', 'menu');
  await expect(menu(page)).toBeVisible();
}

/**
 * Móvil: cierra el menú (botón ×) para ver la página. Si ya se ve, o en
 * escritorio (donde siempre se ve), no hace nada.
 */
export async function showMobilePage(page: Page): Promise<void> {
  if (!isMobileViewport(page.viewportSize())) return;
  const html = page.locator('html');
  if ((await settledView(page)) === 'menu') await backButton(page).click();
  await expect(html).toHaveAttribute('data-view', 'page');
}

/**
 * Lo que hacen Chrome, Firefox y Safari si no se ha tocado la página: `play()`
 * con sonido falla con NotAllowedError (sin sonido, sí arranca). No sirve
 * `navigator.userActivation`: con `page.goto`, Chromium ya la da por activada.
 */
export async function blockSoundWithoutInteraction(page: Page): Promise<void> {
  await page.addInitScript(() => {
    let touched = false;
    for (const type of ['pointerdown', 'keydown']) {
      addEventListener(type, (event) => {
        if (event.isTrusted) touched = true;
      }, { capture: true });
    }
    const play = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function (this: HTMLMediaElement) {
      if (!this.muted && !touched) {
        return Promise.reject(new DOMException('Hace falta tocar la página', 'NotAllowedError'));
      }
      return play.call(this);
    };
  });
}

// --- Reproductor (C06) -------------------------------------------------------

/** Clave de sessionStorage del reproductor (src/config/player.ts). */
export const PLAYER_STORAGE_KEY = 'travest15m0:player';

export function player(page: Page): Locator {
  return page.getByRole('region', { name: 'Reproductor de mixes' });
}

/**
 * Como si la persona hubiera pausado la música antes de recargar: el
 * reproductor no arranca solo (para probar lo demás sin música).
 */
export async function withMusicPaused(page: Page): Promise<void> {
  await page.addInitScript((key) => {
    sessionStorage.setItem(key, JSON.stringify({ paused: true }));
  }, PLAYER_STORAGE_KEY);
}

export interface AudioInfo {
  state: string | undefined;
  autoplay: string | undefined;
  mix: string | undefined;
  src: string;
  paused: boolean;
  time: number;
  count: number;
}

/** Estado del <audio> del reproductor (y cuántos <audio> hay en la página). */
export async function audioInfo(page: Page): Promise<AudioInfo> {
  return page.evaluate(() => {
    const element = document.querySelector<HTMLElement>('mix-player');
    const audio = element?.querySelector<HTMLAudioElement>('audio[data-audio]');
    return {
      state: element?.dataset.state,
      autoplay: element?.dataset.autoplay,
      mix: element?.dataset.mix,
      src: audio?.currentSrc || audio?.getAttribute('src') || '',
      paused: audio?.paused ?? true,
      time: audio?.currentTime ?? 0,
      count: document.querySelectorAll('audio').length,
    };
  });
}

/**
 * Que suene la música. Si el navegador no ha dejado arrancar sola (WebKit, o
 * sin el permiso de autoplay de playwright.config.ts), la arranca como lo
 * haría la persona: con el botón de reproducir.
 */
export async function ensureMusic(page: Page): Promise<AudioInfo> {
  const region = player(page);
  await expect
    .poll(async () => {
      const [state, autoplay] = await Promise.all([region.getAttribute('data-state'), region.getAttribute('data-autoplay')]);
      return state === 'playing' || autoplay === 'waiting';
    }, { timeout: 10_000 })
    .toBe(true);
  if ((await region.getAttribute('data-autoplay')) === 'waiting') {
    await region.getByRole('button', { name: 'Reproducir', exact: true }).click();
  }
  return expectMusicPlaying(page);
}

/** Espera a que suene un mix y a que el tiempo avance. */
export async function expectMusicPlaying(page: Page): Promise<AudioInfo> {
  await expect(player(page)).toHaveAttribute('data-state', 'playing', { timeout: 10_000 });
  const first = await audioInfo(page);
  await expect.poll(async () => (await audioInfo(page)).time, { timeout: 5_000 }).toBeGreaterThan(first.time + 0.2);
  return audioInfo(page);
}
