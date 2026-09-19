/**
 * Cola del reproductor (C06): orden aleatorio en cada visita, «anterior» y
 * «siguiente», y otra vuelta barajada al acabar la lista.
 *
 * La cola guarda lo que ya ha sonado, así que «anterior» funciona también
 * después de volver a barajar. Pura: se prueba sin navegador.
 */
import { cryptoRandom, reshuffleAvoiding, shuffle, type RandomSource } from './shuffle';

/** Canciones que se recuerdan hacia atrás como mucho. */
export const MAX_HISTORY = 200;

export class MixQueue<T extends { id: string }> {
  readonly #items: readonly T[];
  readonly #random: RandomSource;
  /** Lo que ya ha sonado, lo que suena y lo que queda de esta vuelta. */
  #order: T[];
  #index = 0;

  /**
   * @param items    Los mixes publicados.
   * @param random   Generador aleatorio (inyectable para los tests).
   * @param startId  Mix con el que empezar (el que sonaba antes de recargar).
   */
  constructor(items: readonly T[], random: RandomSource = cryptoRandom, startId?: string | null) {
    this.#items = [...items];
    this.#random = random;
    this.#order = shuffle(this.#items, random);
    if (startId) {
      const at = this.#order.findIndex((item) => item.id === startId);
      if (at > 0) {
        const [first] = this.#order.splice(at, 1);
        this.#order.unshift(first as T);
      }
    }
  }

  get size(): number {
    return this.#items.length;
  }

  current(): T | undefined {
    return this.#order[this.#index];
  }

  hasPrevious(): boolean {
    return this.#index > 0;
  }

  /** Pasa al siguiente. Al acabar la vuelta, baraja otra sin repetir el último. */
  next(): T | undefined {
    if (this.#items.length === 0) return undefined;
    this.#index++;
    if (this.#index >= this.#order.length) {
      const last = this.#order[this.#order.length - 1];
      this.#order.push(...reshuffleAvoiding(this.#items, last?.id, this.#random));
      this.#trim();
    }
    return this.current();
  }

  /** Vuelve al anterior; `undefined` si es el primero que ha sonado. */
  previous(): T | undefined {
    if (this.#index === 0) return undefined;
    this.#index--;
    return this.current();
  }

  /** Olvida lo más antiguo para que la cola no crezca sin fin. */
  #trim(): void {
    const excess = this.#index - MAX_HISTORY;
    if (excess > 0) {
      this.#order.splice(0, excess);
      this.#index -= excess;
    }
  }
}
