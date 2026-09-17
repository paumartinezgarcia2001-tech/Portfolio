/**
 * Utilidades puras de la barra vertical de noticias (C04).
 */

/** Separador entre repeticiones del texto. */
export const TICKER_SEPARATOR = ' ✦ ';

/**
 * Caracteres mínimos por copia. A 2,25rem una letra de Helvetica Light ocupa
 * unos 16–18 px, así que 180 caracteres dan ≈3.000 px: más que el alto de
 * cualquier pantalla razonable (incluidos monitores en vertical).
 */
export const TICKER_MIN_CHARS = 180;

/** Segundos por carácter (§5 · C04). */
export const TICKER_SECONDS_PER_CHAR = 0.18;

/** Duración mínima del bucle, en segundos. */
export const TICKER_MIN_SECONDS = 20;

/** Recorta y colapsa espacios. Respeta mayúsculas y minúsculas. */
export function normalizeTickerText(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/** Longitud en caracteres visibles (cuenta los emojis y símbolos como uno). */
export function charLength(text: string): number {
  return [...text].length;
}

/**
 * Construye UNA copia de la pista: el texto seguido del separador, repetido
 * hasta llegar a `minChars`. La pista pinta dos copias idénticas y se desplaza
 * un 50 %, así que el bucle no da saltos.
 */
export function buildTickerCopy(text: string, minChars: number = TICKER_MIN_CHARS): string {
  const clean = normalizeTickerText(text);
  if (!clean) return '';
  const unit = `${clean}${TICKER_SEPARATOR}`;
  const repeats = Math.max(1, Math.ceil(minChars / charLength(unit)));
  return unit.repeat(repeats);
}

/**
 * Duración de un ciclo: `max(20 s, nº de caracteres × 0,18 s)`, calculada
 * sobre la copia completa para que la velocidad sea siempre la misma.
 */
export function tickerDurationSeconds(copy: string): number {
  const seconds = charLength(copy) * TICKER_SECONDS_PER_CHAR;
  return Math.max(TICKER_MIN_SECONDS, Math.round(seconds * 10) / 10);
}
