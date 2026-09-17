import { describe, expect, it } from 'vitest';
import {
  TICKER_MIN_CHARS,
  TICKER_SEPARATOR,
  buildTickerCopy,
  charLength,
  normalizeTickerText,
  tickerDurationSeconds,
} from '../../src/lib/ticker';

describe('normalizeTickerText', () => {
  it('recorta y colapsa espacios sin cambiar mayúsculas', () => {
    expect(normalizeTickerText('  travest15m0   ·  DJ \n Madrid ')).toBe('travest15m0 · DJ Madrid');
    expect(normalizeTickerText('  PRÓXIMA  fecha ')).toBe('PRÓXIMA fecha');
  });
});

describe('buildTickerCopy', () => {
  it('devuelve una cadena vacía si no hay texto', () => {
    expect(buildTickerCopy('   ')).toBe('');
  });

  it('repite el texto con el separador hasta llegar al mínimo', () => {
    const copy = buildTickerCopy('travest15m0 · DJ · Madrid');
    const unit = `travest15m0 · DJ · Madrid${TICKER_SEPARATOR}`;
    expect(copy.startsWith(unit)).toBe(true);
    expect(charLength(copy)).toBeGreaterThanOrEqual(TICKER_MIN_CHARS);
    expect(copy.split(TICKER_SEPARATOR).filter(Boolean).every((part) => part === 'travest15m0 · DJ · Madrid')).toBe(true);
    // No repite de más: quitando una repetición ya no llega al mínimo.
    expect(charLength(copy) - charLength(unit)).toBeLessThan(TICKER_MIN_CHARS);
  });

  it('no repite un texto que ya es largo', () => {
    const long = 'x'.repeat(TICKER_MIN_CHARS + 10);
    expect(buildTickerCopy(long)).toBe(`${long}${TICKER_SEPARATOR}`);
  });

  it('termina siempre en separador, para que el bucle no pegue las copias', () => {
    expect(buildTickerCopy('hola').endsWith(TICKER_SEPARATOR)).toBe(true);
  });
});

describe('tickerDurationSeconds', () => {
  it('aplica el mínimo de 20 s', () => {
    expect(tickerDurationSeconds('corto')).toBe(20);
  });

  it('usa 0,18 s por carácter en textos largos', () => {
    expect(tickerDurationSeconds('a'.repeat(200))).toBe(36);
    expect(tickerDurationSeconds('a'.repeat(181))).toBe(32.6);
  });

  it('cuenta los símbolos como un carácter', () => {
    expect(charLength('✦✦✦')).toBe(3);
    expect(charLength('🎧')).toBe(1);
  });
});
