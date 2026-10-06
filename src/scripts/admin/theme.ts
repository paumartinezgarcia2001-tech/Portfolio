/**
 * Colores de la web (página «colores» del panel, Luna, 06-10-2026).
 *
 * - Cada color tiene la paleta del navegador y el código #RRGGBB, siempre
 *   iguales (el que se envía es el código).
 * - La vista previa cambia al momento, y al tocar una sección del menú de la
 *   vista previa se ven sus colores.
 * - Los avisos de contraste se recalculan con la misma función que usa el
 *   servidor (src/lib/color.ts).
 */
import { DEFAULT_THEME, THEME_FIELDS, THEME_MIN_CONTRAST, THEME_MIN_ICON_CONTRAST, type Theme } from '../../config/theme';
import { isHexColor, normalizeHex, themeContrastIssues } from '../../lib/color';

function escapeText(text: string): string {
  return text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

export function setupThemeEditor(): void {
  const form = document.querySelector<HTMLFormElement>('[data-theme-editor]');
  if (!form) return;
  const preview = form.querySelector<HTMLElement>('[data-theme-preview]');
  const contrast = form.querySelector<HTMLElement>('[data-contrast]');
  const follows = form.querySelector<HTMLInputElement>('[data-player-follows]');
  const ownPlayer = form.querySelector<HTMLElement>('[data-player-own]');

  const hexInput = (key: string) => form.querySelector<HTMLInputElement>(`[data-color-hex="${key}"]`);
  const picker = (key: string) => form.querySelector<HTMLInputElement>(`[data-color-picker="${key}"]`);

  /** Colores del formulario; los que no son válidos, los del código. */
  const current = (): Theme => {
    const theme: Theme = { ...DEFAULT_THEME, playerFollowsSection: Boolean(follows?.checked) };
    for (const field of THEME_FIELDS) {
      const value = hexInput(field.key)?.value ?? '';
      if (isHexColor(value)) theme[field.key] = normalizeHex(value);
    }
    return theme;
  };

  const render = () => {
    const theme = current();
    if (preview) {
      for (const field of THEME_FIELDS) preview.style.setProperty(`--p-${field.key}`, theme[field.key]);
      preview.toggleAttribute('data-player-follows', theme.playerFollowsSection);
    }
    if (ownPlayer) ownPlayer.hidden = theme.playerFollowsSection;
    if (contrast) {
      const issues = themeContrastIssues(theme);
      contrast.innerHTML = issues.length
        ? `<div class="a-alert"><p>Se leería mal (contraste por debajo de ${THEME_MIN_CONTRAST}:1 en textos y ${THEME_MIN_ICON_CONTRAST}:1 en iconos). Se puede guardar igualmente:</p><ul>${issues
            .map((issue) => `<li>${escapeText(issue.label)}: ${issue.ratio}:1</li>`)
            .join('')}</ul></div>`
        : '<p class="a-alert a-alert--ok">Todos los textos se leen bien.</p>';
    }
  };

  for (const field of THEME_FIELDS) {
    const hex = hexInput(field.key);
    const color = picker(field.key);
    color?.addEventListener('input', () => {
      if (hex) hex.value = color.value;
      render();
    });
    hex?.addEventListener('input', () => {
      if (color && isHexColor(hex.value)) color.value = normalizeHex(hex.value);
      render();
    });
    hex?.addEventListener('change', () => {
      if (isHexColor(hex.value)) hex.value = normalizeHex(hex.value);
    });
  }

  for (const button of form.querySelectorAll<HTMLButtonElement>('[data-color-default]')) {
    button.addEventListener('click', () => {
      const key = button.dataset.colorTarget!;
      const value = button.dataset.colorDefault!;
      const hex = hexInput(key);
      const color = picker(key);
      if (hex) hex.value = value;
      if (color) color.value = value;
      render();
    });
  }

  follows?.addEventListener('change', render);

  // Secciones de la vista previa.
  for (const item of form.querySelectorAll<HTMLButtonElement>('[data-preview-section]')) {
    item.addEventListener('click', () => {
      if (!preview) return;
      preview.dataset.section = item.dataset.previewSection!;
      for (const other of form.querySelectorAll('[data-preview-section]')) {
        other.setAttribute('aria-pressed', String(other === item));
      }
    });
  }

  render();
}
