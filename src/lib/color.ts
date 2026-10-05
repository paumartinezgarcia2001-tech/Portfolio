/**
 * Colores en sRGB: funciones puras para el cambio de acento (src/scripts/accent.ts).
 */

export type Rgb = [number, number, number];

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
