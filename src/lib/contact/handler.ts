/**
 * Lo que hace el servidor con un mensaje del formulario de contacto (C17),
 * ya validado por el esquema. Sin dependencias de Astro ni de Cloudflare:
 * todo llega por `deps`, así que se prueba con tests unitarios.
 *
 * Orden:
 * 1. Honeypot relleno → se descarta sin avisar (la persona ve «enviado»).
 * 2. Falta configuración → error (y un aviso en el registro del Worker).
 * 3. Límite de 5 envíos por hora por IP.
 * 4. Turnstile, verificado en el servidor con la IP de quien envía.
 * 5. Envío con Resend (con un reintento si falla del lado de Resend).
 * 6. Se apunta el envío para el límite.
 *
 * El mensaje no se guarda en ningún sitio: solo llega al email de Pau.
 */
import { CONTACT_ERROR_CODES, CONTACT_RATE_LIMIT, TURNSTILE_ACTION, type ContactErrorCode } from '../../config/contact';
import { buildContactEmail, sendEmail } from '../email';
import { checkRateLimit, rateLimitKey, recordSend, type RateLimitState, type RateLimitStore } from './rate-limit';
import { isHoneypotFilled, toContactMessage, type ContactInput } from './schema';
import { verifyTurnstile } from './turnstile';

export interface ContactConfig {
  turnstileSecret?: string | undefined;
  resendApiKey?: string | undefined;
  /** Email de Pau (secret CONTACT_TO_EMAIL). Nunca va al HTML. */
  to?: string | undefined;
  /** Remitente verificado en Resend, p. ej. `web@<dominio>` (CONTACT_FROM_EMAIL). */
  from?: string | undefined;
  /** Solo para los tests e2e: servidores simulados. */
  turnstileVerifyUrl?: string | undefined;
  resendApiUrl?: string | undefined;
}

export interface ContactDeps {
  config: ContactConfig;
  /** Namespace de KV del límite de envíos. Sin él, no hay límite (y se avisa). */
  store?: RateLimitStore | undefined;
  clientIp?: string | undefined;
  fetch?: typeof fetch;
  now?: () => Date;
  randomId?: () => string;
  logger?: Pick<Console, 'info' | 'warn' | 'error'>;
}

export type ContactOutcome =
  | { status: 'sent'; id: string | undefined }
  | { status: 'discarded' }
  | { status: 'not-configured'; missing: string[] }
  | { status: 'rate-limited'; retryAfterSeconds: number }
  | { status: 'turnstile-missing' }
  | { status: 'turnstile-failed' }
  | { status: 'turnstile-unavailable' }
  | { status: 'send-failed' };

const REQUIRED_CONFIG = {
  turnstileSecret: 'TURNSTILE_SECRET_KEY',
  resendApiKey: 'RESEND_API_KEY',
  to: 'CONTACT_TO_EMAIL',
  from: 'CONTACT_FROM_EMAIL',
} as const;

export function missingContactConfig(config: ContactConfig): string[] {
  return Object.entries(REQUIRED_CONFIG)
    .filter(([key]) => !config[key as keyof typeof REQUIRED_CONFIG]?.trim())
    .map(([, envName]) => envName);
}

let warnedNoStore = false;

export async function handleContact(input: ContactInput, deps: ContactDeps): Promise<ContactOutcome> {
  const log = deps.logger ?? console;

  if (isHoneypotFilled(input)) {
    log.info('[contact] Honeypot relleno: mensaje descartado.');
    return { status: 'discarded' };
  }

  const missing = missingContactConfig(deps.config);
  if (missing.length > 0) {
    log.error(`[contact] Falta configuración: ${missing.join(', ')}. El formulario no puede enviar.`);
    return { status: 'not-configured', missing };
  }
  const turnstileSecret = deps.config.turnstileSecret!;
  const now = (deps.now ?? (() => new Date()))();
  const randomId = deps.randomId ?? (() => crypto.randomUUID());
  const ip = deps.clientIp?.trim() || undefined;

  // 3. Límite por IP. Si KV falla, se sigue sin límite: Turnstile sigue
  //    protegiendo y el formulario no se queda inservible.
  let limit: RateLimitState | undefined;
  if (deps.store) {
    try {
      const key = await rateLimitKey(ip ?? 'desconocida', turnstileSecret);
      limit = await checkRateLimit(deps.store, key, now.getTime(), CONTACT_RATE_LIMIT);
    } catch (error) {
      log.error('[contact] No se ha podido leer el límite de envíos (KV); se sigue sin límite.', error);
    }
    if (limit?.limited) return { status: 'rate-limited', retryAfterSeconds: limit.retryAfterSeconds };
  } else if (!warnedNoStore) {
    warnedNoStore = true;
    log.warn('[contact] Sin el binding de KV CONTACT_RATE_LIMIT: no hay límite de envíos (ver wrangler.jsonc).');
  }

  // 4. Turnstile.
  const verdict = await verifyTurnstile({
    token: input['cf-turnstile-response'],
    secret: turnstileSecret,
    remoteIp: ip,
    expectedAction: TURNSTILE_ACTION,
    idempotencyKey: randomId(),
    endpoint: deps.config.turnstileVerifyUrl,
    ...(deps.fetch ? { fetch: deps.fetch } : {}),
  });
  if (!verdict.ok) {
    if (verdict.reason === 'missing') return { status: 'turnstile-missing' };
    log.warn(`[contact] Turnstile no ha validado el envío (${verdict.reason}: ${verdict.errorCodes.join(', ') || 'sin códigos'}).`);
    return verdict.reason === 'unavailable' ? { status: 'turnstile-unavailable' } : { status: 'turnstile-failed' };
  }

  // 5. Envío.
  const payload = buildContactEmail(toContactMessage(input), {
    from: deps.config.from!,
    to: deps.config.to!,
    sentAt: now,
  });
  const result = await sendEmail(payload, {
    apiKey: deps.config.resendApiKey!,
    endpoint: deps.config.resendApiUrl,
    idempotencyKey: randomId(),
    ...(deps.fetch ? { fetch: deps.fetch } : {}),
  });
  if (!result.ok) {
    log.error(
      `[contact] Resend no ha enviado el email (${result.status ?? 'sin respuesta'}, ${result.attempts} intento(s)): ${result.error}`,
    );
    return { status: 'send-failed' };
  }

  // 6. Cuenta para el límite.
  if (deps.store && limit) {
    try {
      await recordSend(deps.store, limit, now.getTime(), CONTACT_RATE_LIMIT);
    } catch (error) {
      log.error('[contact] No se ha podido apuntar el envío en el límite (KV).', error);
    }
  }
  return { status: 'sent', id: result.id };
}

/** Código de ActionError de Astro (su estado HTTP) para cada resultado. */
export type ContactActionErrorCode = 'TOO_MANY_REQUESTS' | 'FORBIDDEN' | 'SERVICE_UNAVAILABLE' | 'BAD_GATEWAY';

/**
 * `null` = éxito (también con el honeypot relleno: respuesta 200 sin envío).
 * `message` lleva el código que el formulario traduce a texto
 * (contactErrorText en src/config/contact.ts).
 */
export function contactOutcomeError(
  outcome: ContactOutcome,
): { code: ContactActionErrorCode; message: ContactErrorCode } | null {
  switch (outcome.status) {
    case 'sent':
    case 'discarded':
      return null;
    case 'rate-limited':
      return { code: 'TOO_MANY_REQUESTS', message: CONTACT_ERROR_CODES.rateLimited };
    case 'turnstile-missing':
      return { code: 'FORBIDDEN', message: CONTACT_ERROR_CODES.turnstileMissing };
    case 'turnstile-failed':
      return { code: 'FORBIDDEN', message: CONTACT_ERROR_CODES.turnstileFailed };
    case 'not-configured':
      return { code: 'SERVICE_UNAVAILABLE', message: CONTACT_ERROR_CODES.notConfigured };
    case 'turnstile-unavailable':
      return { code: 'SERVICE_UNAVAILABLE', message: CONTACT_ERROR_CODES.sendFailed };
    case 'send-failed':
      return { code: 'BAD_GATEWAY', message: CONTACT_ERROR_CODES.sendFailed };
  }
}
