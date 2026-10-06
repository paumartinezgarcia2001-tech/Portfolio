/**
 * Colores de la web elegidos en el panel (src/config/theme.ts): validación
 * de lo guardado y el CSS que pinta BaseLayout (el contraste está en
 * src/lib/color.ts, que también usa el panel en el navegador). Funciones puras (las prueban los
 * tests); el texto del CSS solo lleva colores ya validados.
 */
import { z } from 'astro/zod';
import highlighterSvg from '../assets/highlighter.svg?raw';
import { DEFAULT_THEME, THEME_FIELDS, type Theme, type ThemeColorKey } from '../config/theme';
import { isHexColor, normalizeHex } from './color';

export { contrastRatio, isHexColor, normalizeHex, themeContrastIssues, type ContrastIssue } from './color';

const storedColor = z.string().refine(isHexColor).transform(normalizeHex);

const storedThemeSchema = z.object({
  info: storedColor.optional(),
  next: storedColor.optional(),
  media: storedColor.optional(),
  archive: storedColor.optional(),
  contact: storedColor.optional(),
  menuBg: storedColor.optional(),
  panelBg: storedColor.optional(),
  player: storedColor.optional(),
  playerFollowsSection: z.boolean().optional(),
});

/**
 * `site_settings.theme` → colores de la web, o `null` (los del código) si
 * está vacío o no es válido. Lo que falte sale de los del código.
 */
export function parseStoredTheme(raw: unknown): Theme | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const parsed = storedThemeSchema.safeParse(raw);
  if (!parsed.success) return null;
  const theme: Theme = { ...DEFAULT_THEME };
  for (const [key, value] of Object.entries(parsed.data)) {
    if (value !== undefined) (theme as unknown as Record<string, unknown>)[key] = value;
  }
  return theme;
}

/** Colores → JSON para `site_settings.theme`. */
export function toStoredTheme(theme: Theme): Record<string, string | boolean> {
  return { ...theme };
}

/** ¿Son los colores del código? */
export function isDefaultTheme(theme: Theme): boolean {
  return (Object.keys(DEFAULT_THEME) as (keyof Theme)[]).every((key) => theme[key] === DEFAULT_THEME[key]);
}

// --------------------------------------------------------------------------
// CSS
// --------------------------------------------------------------------------

/** Color de papel que pinta la textura del rotulador (src/assets/highlighter.svg). */
const SVG_PAPER = /#c5c7d6/gi;

/** Textura del rotulador con otro color de papel, como `url("data:…")`. */
export function highlighterTexture(paper: string): string {
  const svg = highlighterSvg.replace(SVG_PAPER, normalizeHex(paper));
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}

/**
 * CSS de los colores elegidos (BaseLayout lo pone en el <head>, sin capa, así
 * que manda sobre src/styles/tokens.css). Solo lleva colores validados.
 */
export function themeCss(theme: Theme): string {
  const tokens = Object.fromEntries(THEME_FIELDS.map((field) => [field.key, field.token])) as Record<ThemeColorKey, string>;
  const lines: string[] = [];
  for (const field of THEME_FIELDS) {
    if (field.key === 'player') continue;
    lines.push(`${tokens[field.key]}:${normalizeHex(theme[field.key])}`);
  }
  // Los textos son los fondos al revés (src/config/theme.ts).
  lines.push(`--c-menu-fg:${normalizeHex(theme.panelBg)}`);
  lines.push(`--c-panel-fg:${normalizeHex(theme.menuBg)}`);
  lines.push(`--c-player:${theme.playerFollowsSection ? 'var(--accent)' : normalizeHex(theme.player)}`);
  if (normalizeHex(theme.panelBg) !== DEFAULT_THEME.panelBg) lines.push(`--hl-texture:${highlighterTexture(theme.panelBg)}`);
  return `:root{${lines.join(';')}}`;
}
