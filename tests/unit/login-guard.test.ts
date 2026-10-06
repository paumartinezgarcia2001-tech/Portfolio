import { describe, expect, it, vi } from 'vitest';
import {
  LOGIN_FAILURE_MIN_MS,
  allowLoginAttempt,
  loginRateKey,
  waitUntilElapsed,
  type LoginRateLimiter,
} from '../../src/lib/admin/login-guard';

/** C19 · protección del login contra fuerza bruta. */
describe('límite de intentos de login', () => {
  /** Un limitador como el de Workers: `max` intentos por clave. */
  function limiter(max: number): LoginRateLimiter & { keys: string[] } {
    const counts = new Map<string, number>();
    const keys: string[] = [];
    return {
      keys,
      async limit({ key }) {
        keys.push(key);
        const n = (counts.get(key) ?? 0) + 1;
        counts.set(key, n);
        return { success: n <= max };
      },
    };
  }

  it('cuenta por IP', async () => {
    const l = limiter(5);
    for (let i = 0; i < 5; i += 1) expect(await allowLoginAttempt(l, '203.0.113.7')).toBe(true);
    expect(await allowLoginAttempt(l, '203.0.113.7')).toBe(false);
    // Otra IP sigue pudiendo.
    expect(await allowLoginAttempt(l, '198.51.100.1')).toBe(true);
    expect(l.keys[0]).toBe('login:203.0.113.7');
  });

  it('sin IP, un contador común (no se salta el límite)', () => {
    expect(loginRateKey(undefined)).toBe('login:sin-ip');
    expect(loginRateKey('  ')).toBe('login:sin-ip');
  });

  it('sin binding o si el binding falla, deja pasar (queda el límite de Supabase)', async () => {
    expect(await allowLoginAttempt(undefined, '203.0.113.7')).toBe(true);
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const broken: LoginRateLimiter = { limit: () => Promise.reject(new Error('caído')) };
    expect(await allowLoginAttempt(broken, '203.0.113.7')).toBe(true);
    error.mockRestore();
  });
});

describe('tiempo mínimo de los fallos', () => {
  it('espera lo que falte hasta el mínimo', async () => {
    vi.useFakeTimers();
    let done = false;
    const start = 1_000;
    const promise = waitUntilElapsed(start, LOGIN_FAILURE_MIN_MS, () => start + 300).then(() => {
      done = true;
    });
    await vi.advanceTimersByTimeAsync(LOGIN_FAILURE_MIN_MS - 301);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(2);
    expect(done).toBe(true);
    await promise;
    vi.useRealTimers();
  });

  it('no espera si ya ha pasado el mínimo', async () => {
    const started = Date.now();
    await waitUntilElapsed(0, LOGIN_FAILURE_MIN_MS, () => LOGIN_FAILURE_MIN_MS + 5);
    expect(Date.now() - started).toBeLessThan(50);
  });
});
