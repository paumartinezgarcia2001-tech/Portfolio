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

/** Abre el menú en móvil con el botón atrás. */
export async function openMobileMenu(page: Page): Promise<void> {
  await backButton(page).click();
  await expect(page.locator('html')).toHaveAttribute('data-view', 'menu');
  await expect(menu(page)).toBeVisible();
}
