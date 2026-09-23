import { beforeEach, describe, expect, it } from 'vitest';
import { CONTACT_RATE_LIMIT } from '../../src/config/contact';
import { checkRateLimit, rateLimitKey, recordSend, type RateLimitStore } from '../../src/lib/contact/rate-limit';

/** C17 · 5 envíos por hora por IP, con ventana deslizante en KV. */

const HOUR = CONTACT_RATE_LIMIT.windowSeconds * 1000;
const NOW = Date.parse('2026-09-19T20:00:00Z');

class MemoryStore implements RateLimitStore {
  values = new Map<string, string>();
  puts: Array<{ key: string; value: string; expirationTtl: number | undefined }> = [];

  async get(key: string): Promise<string | null> {
    return this.values.get(key) ?? null;
  }

  async put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void> {
    this.values.set(key, value);
    this.puts.push({ key, value, expirationTtl: options?.expirationTtl });
  }
}

let store: MemoryStore;
beforeEach(() => {
  store = new MemoryStore();
});

describe('rateLimitKey', () => {
  it('no guarda la IP: es un HMAC con el secreto del servidor', async () => {
    const key = await rateLimitKey('203.0.113.10', 'secreto');
    expect(key).toMatch(/^contact:v1:[0-9a-f]{32}$/);
    expect(key).not.toContain('203.0.113.10');
  });

  it('la misma IP da la misma clave; otra IP u otro secreto, otra', async () => {
    const [a, b, c, d] = await Promise.all([
      rateLimitKey('203.0.113.10', 'secreto'),
      rateLimitKey('203.0.113.10', 'secreto'),
      rateLimitKey('203.0.113.11', 'secreto'),
      rateLimitKey('203.0.113.10', 'otro-secreto'),
    ]);
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a).not.toBe(d);
  });
});

describe('checkRateLimit y recordSend', () => {
  it('deja pasar cinco envíos y bloquea el sexto', async () => {
    let now = NOW;
    for (let i = 0; i < CONTACT_RATE_LIMIT.max; i++) {
      const state = await checkRateLimit(store, 'k', now, CONTACT_RATE_LIMIT);
      expect(state.limited).toBe(false);
      await recordSend(store, state, now, CONTACT_RATE_LIMIT);
      now += 60_000;
    }
    const sixth = await checkRateLimit(store, 'k', now, CONTACT_RATE_LIMIT);
    expect(sixth.limited).toBe(true);
    expect(sixth.recent).toHaveLength(CONTACT_RATE_LIMIT.max);
  });

  it('dice cuánto falta para que haya hueco (cuando caduque el más antiguo)', async () => {
    const times = [0, 1, 2, 3, 4].map((minutes) => NOW - HOUR + (minutes + 1) * 60_000);
    await store.put('k', JSON.stringify(times));
    const state = await checkRateLimit(store, 'k', NOW, CONTACT_RATE_LIMIT);
    expect(state.limited).toBe(true);
    // El más antiguo entró hace 59 minutos: queda 1 minuto.
    expect(state.retryAfterSeconds).toBe(60);
  });

  it('los envíos de hace más de una hora ya no cuentan', async () => {
    const old = Array.from({ length: CONTACT_RATE_LIMIT.max }, (_, i) => NOW - HOUR - i * 1000);
    await store.put('k', JSON.stringify(old));
    const state = await checkRateLimit(store, 'k', NOW, CONTACT_RATE_LIMIT);
    expect(state.limited).toBe(false);
    expect(state.recent).toEqual([]);
  });

  it('guarda solo las marcas que hacen falta y con caducidad de una hora', async () => {
    const state = await checkRateLimit(store, 'k', NOW, CONTACT_RATE_LIMIT);
    await recordSend(store, state, NOW, CONTACT_RATE_LIMIT);
    expect(store.puts.at(-1)).toEqual({ key: 'k', value: JSON.stringify([NOW]), expirationTtl: HOUR / 1000 });

    const many = Array.from({ length: 12 }, (_, i) => NOW - i * 1000);
    await recordSend(store, { key: 'k', recent: many }, NOW, CONTACT_RATE_LIMIT);
    expect(JSON.parse(store.puts.at(-1)!.value)).toHaveLength(CONTACT_RATE_LIMIT.max);
  });

  it('aguanta un valor corrupto en KV', async () => {
    await store.put('k', 'no-es-json');
    const state = await checkRateLimit(store, 'k', NOW, CONTACT_RATE_LIMIT);
    expect(state.limited).toBe(false);
    await store.put('k', JSON.stringify(['ayer', null, NOW]));
    const mixed = await checkRateLimit(store, 'k', NOW, CONTACT_RATE_LIMIT);
    expect(mixed.recent).toEqual([NOW]);
  });
});
