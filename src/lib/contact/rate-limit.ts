/**
 * Límite de envíos del formulario de contacto: 5 por hora por IP (C17).
 *
 * El binding de Rate Limiting de Workers solo admite ventanas de 10 o 60 s,
 * así que se usa un contador en Workers KV (la otra opción de la fase 5):
 * cada IP guarda la hora de sus últimos envíos (ventana deslizante de 1 h).
 *
 * - La clave no es la IP: es un HMAC-SHA256 de la IP con un secreto del
 *   servidor, y la entrada caduca sola a la hora (minimización de datos).
 * - Solo cuentan los envíos que pasan Turnstile (los que gastan cuota de
 *   Resend); los errores de validación no.
 * - KV es «eventualmente consistente»: dos envíos simultáneos desde la misma
 *   IP podrían pasar a la vez. Para un formulario de contacto basta.
 */

/** Lo que se usa de un namespace de KV (así se puede probar sin Cloudflare). */
export interface RateLimitStore {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
}

export interface RateLimitOptions {
  max: number;
  windowSeconds: number;
}

export interface RateLimitState {
  key: string;
  /** Envíos dentro de la ventana (milisegundos desde 1970), del más antiguo al más reciente. */
  recent: number[];
  limited: boolean;
  /** Segundos hasta que vuelva a haber hueco (0 si no hay límite). */
  retryAfterSeconds: number;
}

const KEY_PREFIX = 'contact:v1:';
/** KV no admite caducidades de menos de 60 s. */
const MIN_TTL_SECONDS = 60;

function toHex(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** Clave de KV para una IP: `contact:v1:` + HMAC-SHA256(ip) (32 caracteres). */
export async function rateLimitKey(ip: string, secret: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(ip));
  return `${KEY_PREFIX}${toHex(signature).slice(0, 32)}`;
}

function parseTimestamps(raw: string | null): number[] {
  if (!raw) return [];
  try {
    const value: unknown = JSON.parse(raw);
    return Array.isArray(value) ? value.filter((item): item is number => typeof item === 'number' && Number.isFinite(item)) : [];
  } catch {
    return [];
  }
}

export async function checkRateLimit(
  store: RateLimitStore,
  key: string,
  now: number,
  options: RateLimitOptions,
): Promise<RateLimitState> {
  const windowMs = options.windowSeconds * 1000;
  const recent = parseTimestamps(await store.get(key))
    .filter((time) => time > now - windowMs && time <= now)
    .sort((a, b) => a - b);
  const limited = recent.length >= options.max;
  // Hay hueco cuando el envío más antiguo de los que cuentan sale de la ventana.
  const oldestCounted = recent[recent.length - options.max];
  const retryAfterSeconds = limited && oldestCounted !== undefined ? Math.max(1, Math.ceil((oldestCounted + windowMs - now) / 1000)) : 0;
  return { key, recent, limited, retryAfterSeconds };
}

/** Apunta un envío (tras pasar Turnstile). */
export async function recordSend(
  store: RateLimitStore,
  state: Pick<RateLimitState, 'key' | 'recent'>,
  now: number,
  options: RateLimitOptions,
): Promise<void> {
  const times = [...state.recent, now].slice(-options.max);
  await store.put(state.key, JSON.stringify(times), {
    expirationTtl: Math.max(MIN_TTL_SECONDS, options.windowSeconds),
  });
}
