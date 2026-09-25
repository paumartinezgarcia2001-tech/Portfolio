/**
 * Envío del formulario por Web3Forms (D58), el camino del build estático.
 *
 * En GitHub Pages no hay servidor: nadie puede validar Turnstile ni llamar a
 * Resend. Así que el propio navegador manda el mensaje a la API de Web3Forms,
 * que lo reenvía por correo a la cuenta que Pau tenga configurada allí.
 *
 * Qué se pierde respecto al camino de Cloudflare (src/lib/contact/handler.ts),
 * dicho claro porque importa:
 * - no hay límite de 5 envíos por hora (vivía en KV);
 * - no hay Turnstile (Web3Forms solo lo verifica en su plan de pago);
 * - el asunto y el cuerpo del correo los compone Web3Forms, no src/lib/email.ts.
 * Lo que sí queda: el honeypot `botcheck`, que Web3Forms comprueba en su
 * servidor, y su propio filtro anti-spam, que va incluido.
 *
 * La clave de acceso (`access_key`) es pública por diseño: va escrita en el
 * HTML. No es un secreto, pero tampoco se escribe en el repo: llega como
 * variable de compilación PUBLIC_WEB3FORMS_KEY.
 *
 * Documentación: https://docs.web3forms.com
 */
import { CONTACT_FIELDS } from '../../config/contact';
import type { ContactMessage } from './schema';

export const WEB3FORMS_ENDPOINT = 'https://api.web3forms.com/submit';

/** Campos reservados de Web3Forms (los que no son del formulario). */
export const WEB3FORMS_FIELDS = {
  accessKey: 'access_key',
  subject: 'subject',
  fromName: 'from_name',
  /**
   * A quién se responde. Web3Forms ya usa el campo `email` si existe, pero se
   * manda explícito para no depender de ese comportamiento.
   */
  replyTo: 'replyto',
  /**
   * Solo para el envío sin JavaScript: al acabar, Web3Forms lleva el navegador
   * a esta dirección en vez de a su página de «gracias». Tiene que ser
   * absoluta, con https y del mismo dominio (en su plan gratuito).
   */
  redirect: 'redirect',
} as const;

/** Asunto y remitente del correo que compone Web3Forms. */
export const WEB3FORMS_SUBJECT = '[web] mensaje desde el formulario de contacto';
export const WEB3FORMS_FROM_NAME = 'travest15m0 web';

export interface Web3FormsPayload {
  access_key: string;
  subject: string;
  from_name: string;
  replyto: string;
  email: string;
  telefono?: string;
  mensaje: string;
  botcheck?: boolean;
}

/**
 * Cuerpo de la petición. Solo se mandan los campos que interesan: Web3Forms
 * incluye en el correo todo lo que reciba, así que un campo suelto de más
 * saldría como una línea vacía en el mensaje de Pau.
 *
 * (Sin JavaScript no se pasa por aquí: el navegador manda el formulario entero,
 * así que si el teléfono va vacío, el correo llevará esa línea en blanco.)
 */
export function buildWeb3FormsPayload(message: ContactMessage, accessKey: string): Web3FormsPayload {
  return {
    [WEB3FORMS_FIELDS.accessKey]: accessKey,
    [WEB3FORMS_FIELDS.subject]: WEB3FORMS_SUBJECT,
    [WEB3FORMS_FIELDS.fromName]: WEB3FORMS_FROM_NAME,
    [WEB3FORMS_FIELDS.replyTo]: message.email,
    [CONTACT_FIELDS.email]: message.email,
    ...(message.phone ? { [CONTACT_FIELDS.phone]: message.phone } : {}),
    [CONTACT_FIELDS.message]: message.message,
  } as Web3FormsPayload;
}

export type Web3FormsResult = { ok: true } | { ok: false; status: number | undefined; error: string };

export interface Web3FormsOptions {
  /** Por defecto, la API de Web3Forms. Otra URL para los tests. */
  endpoint?: string | undefined;
  fetch?: typeof fetch;
  timeoutMs?: number;
}

/**
 * Manda el mensaje. Sin reintentos: si falla, la persona ve el aviso y puede
 * pulsar «reintentar» (un reintento automático podría duplicar el correo,
 * porque aquí no hay clave de idempotencia como en Resend).
 */
export async function submitToWeb3Forms(payload: Web3FormsPayload, options: Web3FormsOptions = {}): Promise<Web3FormsResult> {
  const doFetch = options.fetch ?? fetch;
  let response: Response;
  try {
    response = await doFetch(options.endpoint ?? WEB3FORMS_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(options.timeoutMs ?? 15_000),
    });
  } catch (error) {
    return { ok: false, status: undefined, error: error instanceof Error ? error.message : String(error) };
  }

  const body = (await response.json().catch(() => null)) as { success?: unknown; message?: unknown } | null;
  if (response.ok && body?.success !== false) return { ok: true };
  return {
    ok: false,
    status: response.status,
    error: typeof body?.message === 'string' ? body.message : `HTTP ${response.status}`,
  };
}
