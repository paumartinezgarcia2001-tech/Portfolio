/**
 * Barajado del reproductor (C06). Funciones puras: el generador aleatorio se
 * inyecta (por defecto, `crypto.getRandomValues`), así que en los tests se
 * puede fijar con una semilla.
 */

/** Devuelve un número en [0, 1). */
export type RandomSource = () => number;

/** Aleatorio criptográfico en [0, 1): el de verdad en la web. */
export function cryptoRandom(): number {
  const buffer = new Uint32Array(1);
  globalThis.crypto.getRandomValues(buffer);
  return (buffer[0] ?? 0) / 4_294_967_296;
}

/** Generador con semilla (mulberry32), para los tests. */
export function seededRandom(seed: number): RandomSource {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

/** Entero en [0, max). */
export function randomInt(max: number, random: RandomSource = cryptoRandom): number {
  return Math.min(max - 1, Math.floor(random() * max));
}

/** Fisher–Yates: una permutación nueva, sin tocar la original. */
export function shuffle<T>(items: readonly T[], random: RandomSource = cryptoRandom): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = randomInt(i + 1, random);
    [out[i], out[j]] = [out[j] as T, out[i] as T];
  }
  return out;
}

/**
 * Vuelve a barajar al acabar la lista sin que el primero sea el último que ha
 * sonado (C06). Si coincide, se cambia por otro elegido al azar.
 */
export function reshuffleAvoiding<T extends { id: string }>(
  items: readonly T[],
  lastId: string | null | undefined,
  random: RandomSource = cryptoRandom,
): T[] {
  const out = shuffle(items, random);
  if (out.length > 1 && lastId != null && out[0]?.id === lastId) {
    const j = 1 + randomInt(out.length - 1, random);
    [out[0], out[j]] = [out[j] as T, out[0] as T];
  }
  return out;
}
