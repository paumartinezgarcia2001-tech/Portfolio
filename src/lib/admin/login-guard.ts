/**
 * Protección del login del panel contra fuerza bruta (C19).
 *
 * - **Límite de intentos por IP**, con el binding de Rate Limiting de Workers
 *   (`LOGIN_RATE_LIMIT` en wrangler.jsonc): 5 intentos por minuto y por IP.
 *   Supabase tiene su propio límite, pero ve la IP del Worker, no la de quien
 *   intenta entrar, así que no distingue a una atacante de Pau.
 * - **Tiempo mínimo en los fallos**: un intento fallido tarda siempre lo mismo
 *   (≈ 0,8 s), falle por el usuario, por la contraseña o porque la cuenta no
 *   está en `admins`. Así no se puede adivinar el alias por lo que tarda la
 *   respuesta, y cada intento cuesta más.
 *
 * Funciones puras (sin módulos de Astro ni de Cloudflare) para poder probarlas.
 */

/** Lo que usa el login del binding de Rate Limiting de Workers. */
export interface LoginRateLimiter {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

/** Duración mínima de una respuesta de login fallida, en ms. */
export const LOGIN_FAILURE_MIN_MS = 800;

/** Clave del contador: una por IP. Sin IP (no debería pasar en Cloudflare), un contador común. */
export function loginRateKey(ip: string | undefined): string {
  return `login:${ip?.trim() || 'sin-ip'}`;
}

/**
 * ¿Puede intentarlo? Cuenta el intento. Sin binding (p. ej. `astro dev` sin
 * wrangler) deja pasar; si el binding falla, también, para no dejar a Pau
 * fuera por un problema de Cloudflare (queda el límite de Supabase).
 */
export async function allowLoginAttempt(limiter: LoginRateLimiter | undefined, ip: string | undefined): Promise<boolean> {
  if (!limiter) return true;
  try {
    const { success } = await limiter.limit({ key: loginRateKey(ip) });
    return success;
  } catch (error) {
    console.error('[panel] Rate limiting del login no disponible', error);
    return true;
  }
}

/** Espera lo que falte para que, desde `startedAt`, hayan pasado `minMs`. */
export async function waitUntilElapsed(startedAt: number, minMs = LOGIN_FAILURE_MIN_MS, now = Date.now): Promise<void> {
  const remaining = minMs - (now() - startedAt);
  if (remaining > 0) await new Promise((resolve) => setTimeout(resolve, remaining));
}
