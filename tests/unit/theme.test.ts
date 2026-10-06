import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEFAULT_THEME, THEME_FIELDS, type Theme } from '../../src/config/theme';
import { themeRestoreSchema, themeSchema } from '../../src/lib/admin/schemas';
import { contrastRatio, isHexColor, normalizeHex, themeContrastIssues } from '../../src/lib/color';
import { highlighterTexture, isDefaultTheme, parseStoredTheme, themeCss, toStoredTheme } from '../../src/lib/theme';

/** Colores del panel (Luna, 06-10-2026). */

const tokens = readFileSync(path.resolve(__dirname, '../../src/styles/tokens.css'), 'utf8');

function tokenValue(name: string): string {
  const match = new RegExp(`${name}:\\s*(#[0-9a-fA-F]{3,6})\\s*;`).exec(tokens);
  if (!match) throw new Error(`No está ${name} en tokens.css`);
  return normalizeHex(match[1]!);
}

describe('colores por defecto', () => {
  it('son los de src/styles/tokens.css', () => {
    for (const field of THEME_FIELDS) expect(DEFAULT_THEME[field.key], field.token).toBe(tokenValue(field.token));
    // Los textos son los fondos al revés.
    expect(tokenValue('--c-menu-fg')).toBe(DEFAULT_THEME.panelBg);
    expect(tokenValue('--c-panel-fg')).toBe(DEFAULT_THEME.menuBg);
  });

  it('se leen bien entre ellos', () => {
    expect(themeContrastIssues(DEFAULT_THEME)).toEqual([]);
  });
});

describe('códigos de color', () => {
  it('acepta #rgb y #rrggbb y los deja en minúsculas de 6 cifras', () => {
    expect(isHexColor('#FF00ff')).toBe(true);
    expect(isHexColor(' #0f0 ')).toBe(true);
    expect(isHexColor('ff00ff')).toBe(false);
    expect(isHexColor('#ff00f')).toBe(false);
    expect(isHexColor('red')).toBe(false);
    expect(isHexColor('#ff00ff; color: red')).toBe(false);
    expect(normalizeHex('#0F0')).toBe('#00ff00');
    expect(normalizeHex(' #ABCDEF ')).toBe('#abcdef');
  });

  it('contraste WCAG', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 5);
    expect(contrastRatio('#ffffff', '#ffffff')).toBeCloseTo(1, 5);
    expect(contrastRatio('#27272b', '#c5c7d6')).toBeGreaterThan(4.5);
  });

  it('avisa de lo que se leería mal', () => {
    const theme: Theme = { ...DEFAULT_THEME, panelBg: '#333333', info: '#202020', player: '#111111' };
    const labels = themeContrastIssues(theme).map((issue) => issue.label);
    expect(labels).toContain('los dos fondos (texto del menú y de la página)');
    expect(labels).toContain('info con el fondo del menú');
    expect(labels).toContain('reproductor con el fondo del menú');
    // Si el reproductor sigue a la sección, su color propio no cuenta.
    expect(themeContrastIssues({ ...theme, playerFollowsSection: true }).map((i) => i.label)).not.toContain(
      'reproductor con el fondo del menú',
    );
  });
});

describe('lo guardado en site_settings.theme', () => {
  it('vacío o inválido → los del código', () => {
    expect(parseStoredTheme(null)).toBeNull();
    expect(parseStoredTheme('rojo')).toBeNull();
    expect(parseStoredTheme([1, 2])).toBeNull();
    expect(parseStoredTheme({ info: 'red' })).toBeNull();
    expect(parseStoredTheme({ info: '#ff0000; } body { display: none' })).toBeNull();
  });

  it('lo que falta sale de los del código', () => {
    expect(parseStoredTheme({ info: '#F00' })).toEqual({ ...DEFAULT_THEME, info: '#ff0000' });
    expect(parseStoredTheme({ playerFollowsSection: true })).toEqual({ ...DEFAULT_THEME, playerFollowsSection: true });
    expect(parseStoredTheme(toStoredTheme(DEFAULT_THEME))).toEqual(DEFAULT_THEME);
  });

  it('sabe si son los del código', () => {
    expect(isDefaultTheme(DEFAULT_THEME)).toBe(true);
    expect(isDefaultTheme({ ...DEFAULT_THEME, playerFollowsSection: true })).toBe(false);
  });
});

describe('CSS de los colores', () => {
  it('redefine los tokens, con los textos al revés', () => {
    const css = themeCss({ ...DEFAULT_THEME, info: '#123456', menuBg: '#000000', panelBg: '#ffffff' });
    expect(css.startsWith(':root{')).toBe(true);
    expect(css).toContain('--c-info:#123456');
    expect(css).toContain('--c-menu-bg:#000000');
    expect(css).toContain('--c-panel-bg:#ffffff');
    expect(css).toContain('--c-menu-fg:#ffffff');
    expect(css).toContain('--c-panel-fg:#000000');
    expect(css).toContain('--c-player:#bf00ff');
    expect(css).not.toContain('</');
  });

  it('el reproductor puede seguir al color de la sección', () => {
    expect(themeCss({ ...DEFAULT_THEME, playerFollowsSection: true })).toContain('--c-player:var(--accent)');
  });

  it('con otro fondo de página, la textura del rotulador cambia de papel', () => {
    expect(themeCss(DEFAULT_THEME)).not.toContain('--hl-texture');
    const css = themeCss({ ...DEFAULT_THEME, panelBg: '#fafafa' });
    expect(css).toContain('--hl-texture:url("data:image/svg+xml,');
    const texture = decodeURIComponent(highlighterTexture('#fafafa'));
    expect(texture).toContain('#fafafa');
    expect(texture.toLowerCase()).not.toContain('#c5c7d6');
  });
});

describe('formulario del panel', () => {
  const valid = {
    info: '#FF00FF',
    next: '#0ff',
    media: '#ffff00',
    archive: '#00ff00',
    contact: '#ff5f1f',
    menuBg: '#27272b',
    panelBg: '#c5c7d6',
    player: '#bf00ff',
    reproductorSigueSeccion: false,
  };

  it('normaliza los códigos', () => {
    const parsed = themeSchema.parse(valid);
    expect(parsed.info).toBe('#ff00ff');
    expect(parsed.next).toBe('#00ffff');
  });

  it('rechaza lo que no es un color', () => {
    const result = themeSchema.safeParse({ ...valid, media: 'amarillo' });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(['media']);
    expect(result.error?.issues[0]?.message).toBe('Escribe un color en formato #RRGGBB (p. ej. #ff00ff).');
    expect(themeSchema.safeParse({ ...valid, player: null }).success).toBe(false);
  });

  it('restaurar', () => {
    expect(themeRestoreSchema.parse({ restaurar: true })).toEqual({ restaurar: true });
  });
});
