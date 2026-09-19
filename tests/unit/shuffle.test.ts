import { describe, expect, it } from 'vitest';
import { MAX_HISTORY, MixQueue } from '../../src/lib/mix-queue';
import { cryptoRandom, randomInt, reshuffleAvoiding, seededRandom, shuffle } from '../../src/lib/shuffle';

const mixes = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `m${i + 1}` }));
const ids = (items: { id: string }[]) => items.map((m) => m.id);

describe('shuffle (Fisher–Yates)', () => {
  it('devuelve una permutación y no toca la lista original', () => {
    const list = mixes(12);
    const copy = [...list];
    const out = shuffle(list, seededRandom(1));
    expect(list).toEqual(copy);
    expect(ids(out).sort()).toEqual(ids(list).sort());
  });

  it('con la misma semilla sale igual; con otra, distinto (dos cargas pueden dar órdenes distintos)', () => {
    const list = mixes(10);
    expect(ids(shuffle(list, seededRandom(7)))).toEqual(ids(shuffle(list, seededRandom(7))));
    expect(ids(shuffle(list, seededRandom(7)))).not.toEqual(ids(shuffle(list, seededRandom(8))));
  });

  it('reparte bien: las 6 permutaciones de 3 elementos salen con frecuencia parecida', () => {
    const random = seededRandom(2026);
    const counts = new Map<string, number>();
    const runs = 60_000;
    for (let i = 0; i < runs; i++) {
      const key = shuffle(['a', 'b', 'c'], random).join('');
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    expect(counts.size).toBe(6);
    for (const count of counts.values()) expect(Math.abs(count - runs / 6)).toBeLessThan((runs / 6) * 0.05);
  });

  it('cada posición recibe cualquier elemento con frecuencia parecida (8 elementos)', () => {
    const random = seededRandom(99);
    const n = 8;
    const runs = 16_000;
    const hits = Array.from({ length: n }, () => new Array<number>(n).fill(0));
    for (let r = 0; r < runs; r++) {
      shuffle([...Array(n).keys()], random).forEach((value, position) => hits[position]![value]!++);
    }
    for (const row of hits) for (const count of row) expect(Math.abs(count - runs / n)).toBeLessThan((runs / n) * 0.12);
  });

  it('listas de 0 y 1 elementos', () => {
    expect(shuffle([], seededRandom(1))).toEqual([]);
    expect(shuffle(['x'], seededRandom(1))).toEqual(['x']);
  });

  it('el aleatorio por defecto es crypto.getRandomValues, en [0, 1)', () => {
    for (let i = 0; i < 1000; i++) {
      const value = cryptoRandom();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
    expect(randomInt(3, () => 0.999_999_999)).toBe(2);
  });
});

describe('reshuffleAvoiding', () => {
  it('al volver a barajar, nunca empieza por el último que ha sonado', () => {
    const random = seededRandom(5);
    const list = mixes(4);
    for (let i = 0; i < 2000; i++) {
      const out = reshuffleAvoiding(list, 'm3', random);
      expect(out[0]!.id).not.toBe('m3');
      expect(ids(out).sort()).toEqual(ids(list));
    }
  });

  it('el primero se reparte entre los demás', () => {
    const random = seededRandom(11);
    const firsts = new Map<string, number>();
    const runs = 9_000;
    for (let i = 0; i < runs; i++) {
      const first = reshuffleAvoiding(mixes(4), 'm1', random)[0]!.id;
      firsts.set(first, (firsts.get(first) ?? 0) + 1);
    }
    expect([...firsts.keys()].sort()).toEqual(['m2', 'm3', 'm4']);
    for (const count of firsts.values()) expect(Math.abs(count - runs / 3)).toBeLessThan((runs / 3) * 0.06);
  });

  it('con un solo mix no hay otro remedio que repetirlo', () => {
    expect(ids(reshuffleAvoiding(mixes(1), 'm1', seededRandom(1)))).toEqual(['m1']);
  });
});

describe('MixQueue', () => {
  it('recorre una vuelta entera sin repetir y luego baraja otra que no empieza por el último', () => {
    for (let seed = 1; seed <= 200; seed++) {
      const queue = new MixQueue(mixes(5), seededRandom(seed));
      const round = [queue.current()!.id];
      for (let i = 1; i < 5; i++) round.push(queue.next()!.id);
      expect([...round].sort()).toEqual(['m1', 'm2', 'm3', 'm4', 'm5']);
      const firstOfNext = queue.next()!.id;
      expect(firstOfNext).not.toBe(round[4]);
    }
  });

  it('«anterior» vuelve por el mismo camino, también después de volver a barajar', () => {
    const queue = new MixQueue(mixes(3), seededRandom(3));
    const played = [queue.current()!.id];
    for (let i = 0; i < 7; i++) played.push(queue.next()!.id);
    for (let i = played.length - 2; i >= 0; i--) expect(queue.previous()!.id).toBe(played[i]);
    expect(queue.hasPrevious()).toBe(false);
    expect(queue.previous()).toBeUndefined();
    expect(queue.current()!.id).toBe(played[0]);
    // Y hacia delante repite lo mismo.
    expect(queue.next()!.id).toBe(played[1]);
  });

  it('empieza por el mix que sonaba antes de recargar', () => {
    for (let seed = 1; seed <= 50; seed++) {
      const queue = new MixQueue(mixes(6), seededRandom(seed), 'm4');
      expect(queue.current()!.id).toBe('m4');
      const rest = [1, 2, 3, 4, 5].map(() => queue.next()!.id);
      expect(rest.sort()).toEqual(['m1', 'm2', 'm3', 'm5', 'm6']);
    }
  });

  it('ignora un mix de inicio que ya no existe', () => {
    const queue = new MixQueue(mixes(3), seededRandom(1), 'borrado');
    expect(['m1', 'm2', 'm3']).toContain(queue.current()!.id);
  });

  it('dos cargas pueden dar órdenes distintos', () => {
    const orders = new Set<string>();
    for (let seed = 1; seed <= 20; seed++) {
      const queue = new MixQueue(mixes(5), seededRandom(seed));
      orders.add([queue.current(), queue.next(), queue.next()].map((m) => m!.id).join());
    }
    expect(orders.size).toBeGreaterThan(10);
  });

  it('con un mix, «siguiente» lo repite; sin mixes, no hay nada', () => {
    const one = new MixQueue(mixes(1), seededRandom(1));
    expect(one.next()!.id).toBe('m1');
    const none = new MixQueue([], seededRandom(1));
    expect(none.current()).toBeUndefined();
    expect(none.next()).toBeUndefined();
    expect(none.previous()).toBeUndefined();
    expect(none.size).toBe(0);
  });

  it('no crece sin fin: recuerda como mucho MAX_HISTORY hacia atrás', () => {
    const queue = new MixQueue(mixes(3), seededRandom(9));
    for (let i = 0; i < MAX_HISTORY * 3; i++) queue.next();
    let back = 0;
    while (queue.previous()) back++;
    expect(back).toBeLessThanOrEqual(MAX_HISTORY);
    expect(back).toBeGreaterThan(MAX_HISTORY - 3);
  });
});
