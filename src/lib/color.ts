/**
 * Colores en sRGB: funciones puras para el cambio de acento
 * (src/scripts/accent.ts) y para los colores del panel (contraste).
 */
import { THEME_FIELDS, THEME_MIN_CONTRAST, THEME_MIN_ICON_CONTRAST, type Theme } from '../config/theme';

export type Rgb = [number, number, number];

const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

/** `#abc` o `#aabbcc` (con o sin espacios alrededor). */
export function isHexColor(value: unknown): value is string {
  return typeof value === 'string' && HEX.test(value.trim());
}

/** `#ABC` o `#aabbcc` → `#aabbcc` (minúsculas). */
export function normalizeHex(value: string): string {
  const hex = value.trim().toLowerCase().slice(1);
  const full = hex.length === 3 ? [...hex].map((c) => c + c).join('') : hex;
  return `#${full}`;
}

/** `#rgb`, `#rrggbb` o `rgb(r, g, b)` → [r, g, b]. */
export function parseColor(value: string): Rgb | null {
  const text = value.trim().toLowerCase();
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/.exec(text)?.[1];
  if (hex) {
    const full = hex.length === 3 ? [...hex].map((c) => c + c).join('') : hex;
    return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16)) as Rgb;
  }
  const rgb = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/.exec(text);
  if (rgb) return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])];
  return null;
}

/** Color en el formato que devuelve getComputedStyle: `rgb(r, g, b)`. */
export function formatColor([r, g, b]: Rgb): string {
  return `rgb(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)})`;
}

/** Mezcla lineal en sRGB; `t` entre 0 y 1. */
export function mixColor(from: Rgb, to: Rgb, t: number): Rgb {
  const k = Math.min(1, Math.max(0, t));
  return [0, 1, 2].map((i) => from[i]! + (to[i]! - from[i]!) * k) as Rgb;
}

// --------------------------------------------------------------------------
// Contraste (WCAG 2.x)
// --------------------------------------------------------------------------

function channel(value: number): number {
  const c = value / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string): number {
  const [r, g, b] = parseColor(normalizeHex(hex)) ?? [0, 0, 0];
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** Relación de contraste entre dos colores (1 a 21). */
export function contrastRatio(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (light + 0.05) / (dark + 0.05);
}

export interface ContrastIssue {
  /** Qué se lee mal, en palabras del panel. */
  label: string;
  ratio: number;
}

/**
 * Parejas de colores que se leen juntas en la web y no llegan al mínimo:
 * - los dos fondos (cada uno es el texto del otro);
 * - cada sección con el fondo del menú (el ítem del menú sobre el menú y el
 *   texto oscuro sobre la barra y el rotulador);
 * - el reproductor con el fondo del menú (si tiene color propio; son iconos,
 *   así que se pide menos).
 */
export function themeContrastIssues(theme: Theme, min: number = THEME_MIN_CONTRAST): ContrastIssue[] {
  const issues: ContrastIssue[] = [];
  const check = (label: string, a: string, b: string, needed: number = min) => {
    if (!isHexColor(a) || !isHexColor(b)) return;
    const ratio = contrastRatio(a, b);
    if (ratio < needed) issues.push({ label, ratio: Math.floor(ratio * 10) / 10 });
  };
  check('los dos fondos (texto del menú y de la página)', theme.menuBg, theme.panelBg);
  for (const field of THEME_FIELDS) {
    if (field.group === 'sections') check(`${field.label} con el fondo del menú`, theme[field.key], theme.menuBg);
  }
  // El reproductor son iconos, no texto: basta con 3:1 (WCAG 1.4.11).
  if (!theme.playerFollowsSection) {
    check('reproductor con el fondo del menú', theme.player, theme.menuBg, Math.min(min, THEME_MIN_ICON_CONTRAST));
  }
  return issues;
}
