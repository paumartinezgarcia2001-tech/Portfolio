/**
 * Verificación de Cloudflare Turnstile en el servidor (C17). El token del
 * navegador solo vale si Cloudflare lo confirma: sin esta llamada, Turnstile
 * no protege nada.
 *
 * - Pasa la IP de quien envía (`remoteip`) y una `idempotency_key`, que
 *   permite reintentar sin que el token cuente como «ya usado».
 * - Si Cloudflare no responde, se reintenta una vez; si sigue sin responder,
 *   el envío se rechaza (nunca se deja pasar sin verificar).
 * - Con las claves de prueba de Cloudflare, el token es `XXXX.DUMMY.TOKEN.XXXX`
 *   y la respuesta no trae `action`: por eso la acción solo se compara cuando
 *   viene.
 */
import { CONTACT_LIMITS } from '../../config/contact';

export const TURNSTILE_VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

export type TurnstileVerdict =
  | { ok: true }
  | { ok: false; reason: 'missing' | 'rejected' | 'unavailable'; errorCodes: string[] };

export interface VerifyTurnstileOptions {
  token: string | undefined;
  secret: string;
  remoteIp?: string | undefined;
  /** Acción con la que se pintó el widget (p. ej. `contact`). */
  expectedAction?: string | undefined;
  idempotencyKey?: string | undefined;
  /** Por defecto, la API de Cloudflare. Los e2e usan un servidor simulado. */
  endpoint?: string | undefined;
  fetch?: typeof fetch;
  timeoutMs?: number;
}

interface SiteverifyResponse {
  success?: unknown;
  'error-codes'?: unknown;
  action?: unknown;
}

type Attempt = { ok: true; body: SiteverifyResponse } | { ok: false; retry: boolean; errorCodes: string[] };

async function callSiteverify(options: VerifyTurnstileOptions, token: string): Promise<Attempt> {
  const form = new URLSearchParams({ secret: options.secret, response: token });
  if (options.remoteIp) form.set('remoteip', options.remoteIp);
  if (options.idempotencyKey) form.set('idempotency_key', options.idempotencyKey);

  let response: Response;
  try {
    response = await (options.fetch ?? fetch)(options.endpoint ?? TURNSTILE_VERIFY_URL, {
      method: 'POST',
      body: form,
      signal: AbortSignal.timeout(options.timeoutMs ?? 8_000),
    });
  } catch (error) {
    return { ok: false, retry: true, errorCodes: [`network: ${error instanceof Error ? error.message : String(error)}`] };
  }
  if (!response.ok) {
    return { ok: false, retry: response.status >= 500, errorCodes: [`http-${response.status}`] };
  }
  try {
    return { ok: true, body: (await response.json()) as SiteverifyResponse };
  } catch {
    return { ok: false, retry: false, errorCodes: ['invalid-json'] };
  }
}

export async function verifyTurnstile(options: VerifyTurnstileOptions): Promise<TurnstileVerdict> {
  const token = options.token?.trim();
  if (!token) return { ok: false, reason: 'missing', errorCodes: ['missing-input-response'] };
  if (token.length > CONTACT_LIMITS.turnstileTokenMax) {
    return { ok: false, reason: 'rejected', errorCodes: ['invalid-input-response'] };
  }

  let attempt = await callSiteverify(options, token);
  if (!attempt.ok && attempt.retry) attempt = await callSiteverify(options, token);
  if (!attempt.ok) return { ok: false, reason: 'unavailable', errorCodes: attempt.errorCodes };

  const { body } = attempt;
  const errorCodes = Array.isArray(body['error-codes'])
    ? body['error-codes'].filter((code): code is string => typeof code === 'string')
    : [];
  if (body.success !== true) return { ok: false, reason: 'rejected', errorCodes };

  const action = typeof body.action === 'string' ? body.action : '';
  if (options.expectedAction && action && action !== options.expectedAction) {
    return { ok: false, reason: 'rejected', errorCodes: [`action-mismatch: ${action}`] };
  }
  return { ok: true };
}
