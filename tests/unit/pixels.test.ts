import { describe, expect, it } from 'vitest';
import { clearedCount, pixelGrid, shuffledOrder } from '../../src/lib/pixels';

/** Generador pseudoaleatorio con semilla (mulberry32), para tests deterministas. */
function seeded(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('pixelGrid', () => {
  it('cuadrados de 24 px que cubren el panel (sobran por abajo y se recortan)', () => {
    expect(pixelGrid(720, 900, 24)).toEqual({ cols: 30, rows: 38 });
    expect(pixelGrid(375, 812, 24)).toEqual({ cols: 16, rows: 34 });
  });

  it('nunca menos de un cuadrado', () => {
    expect(pixelGrid(0, 0, 24)).toEqual({ cols: 1, rows: 1 });
  });
});

describe('shuffledOrder', () => {
  it('es una permutación de 0…n−1', () => {
    const order = shuffledOrder(1140, seeded(1));
    expect(order).toHaveLength(1140);
    expect([...order].sort((a, b) => a - b)).toEqual(Array.from({ length: 1140 }, (_, i) => i));
  });

  it('con la misma semilla sale igual y con otra, distinto', () => {
    expect([...shuffledOrder(50, seeded(7))]).toEqual([...shuffledOrder(50, seeded(7))]);
    expect([...shuffledOrder(50, seeded(7))]).not.toEqual([...shuffledOrder(50, seeded(8))]);
  });

  it('está bien repartido: cada posición recibe cualquier índice con frecuencia parecida', () => {
    const n = 8;
    const runs = 8000;
    const random = seeded(42);
    const counts = Array.from({ length: n }, () => new Array<number>(n).fill(0));
    for (let r = 0; r < runs; r++) {
      const order = shuffledOrder(n, random);
      order.forEach((value, position) => counts[position]![value]!++);
    }
    const expected = runs / n;
    for (const row of counts) for (const count of row) expect(Math.abs(count - expected)).toBeLessThan(expected * 0.15);
  });
});

describe('clearedCount', () => {
  it('reparte los cuadrados a lo largo de la duración y no se pasa', () => {
    expect(clearedCount(0, 450, 1140)).toBe(0);
    expect(clearedCount(225, 450, 1140)).toBe(570);
    expect(clearedCount(450, 450, 1140)).toBe(1140);
    expect(clearedCount(900, 450, 1140)).toBe(1140);
    expect(clearedCount(-5, 450, 1140)).toBe(0);
    expect(clearedCount(10, 0, 1140)).toBe(1140);
  });
});
