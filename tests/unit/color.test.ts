import { describe, expect, it } from 'vitest';
import { formatColor, mixColor, parseColor } from '../../src/lib/color';

describe('parseColor', () => {
  it('lee hexadecimales y rgb()', () => {
    expect(parseColor('#ff00ff')).toEqual([255, 0, 255]);
    expect(parseColor(' #0F0 ')).toEqual([0, 255, 0]);
    expect(parseColor('rgb(255, 95, 31)')).toEqual([255, 95, 31]);
    expect(parseColor('rgba(1, 2, 3, 0.5)')).toEqual([1, 2, 3]);
    expect(parseColor('rgb(1 2 3)')).toEqual([1, 2, 3]);
  });

  it('devuelve null si no lo entiende', () => {
    expect(parseColor('magenta')).toBeNull();
    expect(parseColor('')).toBeNull();
  });
});

describe('mixColor', () => {
  it('mezcla en línea recta y se queda entre los extremos', () => {
    expect(mixColor([255, 0, 255], [0, 255, 0], 0)).toEqual([255, 0, 255]);
    expect(mixColor([255, 0, 255], [0, 255, 0], 1)).toEqual([0, 255, 0]);
    expect(formatColor(mixColor([255, 0, 255], [0, 255, 0], 0.5))).toBe('rgb(128, 128, 128)');
    expect(mixColor([0, 0, 0], [100, 100, 100], 2)).toEqual([100, 100, 100]);
    expect(mixColor([0, 0, 0], [100, 100, 100], -1)).toEqual([0, 0, 0]);
  });
});
