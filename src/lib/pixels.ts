/**
 * C11c · Transición de píxeles: funciones puras (las prueban los tests).
 */

/** Rejilla de cuadrados de `block` px que cubre una caja de `width` × `height`. */
export function pixelGrid(width: number, height: number, block: number): { cols: number; rows: number } {
  const size = Math.max(1, block);
  return { cols: Math.max(1, Math.ceil(width / size)), rows: Math.max(1, Math.ceil(height / size)) };
}

/**
 * Los índices 0…n−1 en orden aleatorio (Fisher–Yates). `random` se puede
 * inyectar para que los tests sean deterministas.
 */
export function shuffledOrder(n: number, random: () => number = Math.random): Uint32Array {
  const order = new Uint32Array(n);
  for (let i = 0; i < n; i++) order[i] = i;
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    const tmp = order[i] as number;
    order[i] = order[j] as number;
    order[j] = tmp;
  }
  return order;
}

/** Cuántos cuadrados tienen que haber desaparecido a los `elapsed` ms (reparto lineal). */
export function clearedCount(elapsed: number, duration: number, total: number): number {
  if (duration <= 0) return total;
  return Math.min(total, Math.max(0, Math.floor((elapsed / duration) * total)));
}
