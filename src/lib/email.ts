/**
 * Email del formulario de contacto (C17, fase 5), enviado con la API de Resend.
 *
 * - Texto plano + HTML, con todo lo que escribe la persona escapado (§11).
 * - `reply_to` = quien escribe: al pulsar «responder», se le contesta a ella.
 * - Asunto: `[web] mensaje de {email}`.
 * - Un único reintento si Resend devuelve un 5xx (o no responde), con la misma
 *   `Idempotency-Key`: si el primer intento sí llegó, Resend no lo duplica.
 *
 * Sin el SDK de Resend: es una sola petición HTTP, pesa menos en el Worker y
 * la URL se puede cambiar en los tests e2e (RESEND_API_URL).
 */
import type { ContactMessage } from './contact/schema';
import { SITE_TIME_ZONE } from './dates';

export const RESEND_API_URL = 'https://api.resend.com/emails';

const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

/** Escapa un texto para meterlo en HTML (contenido o atributo entre comillas). */
export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => HTML_ESCAPES[char] ?? char);
}

/** Una sola línea: sin saltos ni caracteres de control, con los espacios colapsados. */
export function singleLine(value: string): string {
  // eslint-disable-next-line no-control-regex
  return value.replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, ' ').replace(/\s+/g, ' ').trim();
}

export function contactSubject(message: Pick<ContactMessage, 'email'>): string {
  return `[web] mensaje de ${singleLine(message.email)}`;
}

/** Cuerpo de la petición a Resend (POST /emails). */
export interface EmailPayload {
  from: string;
  to: string[];
  reply_to: string;
  subject: string;
  text: string;
  html: string;
}

const sentAtFormatter = new Intl.DateTimeFormat('es-ES', {
  timeZone: SITE_TIME_ZONE,
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

function formatSentAt(date: Date): string {
  const parts = sentAtFormatter.formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? '';
  return `${get('day')}-${get('month')}-${get('year')} a las ${get('hour')}:${get('minute')}`;
}

/** Filas de datos del mensaje: [etiqueta, valor]. */
function detailRows(message: ContactMessage): Array<[string, string]> {
  const rows: Array<[string, string]> = [['Email', message.email]];
  if (message.phone) rows.push(['Teléfono', singleLine(message.phone)]);
  return rows;
}

export function buildContactEmail(
  message: ContactMessage,
  options: { from: string; to: string; sentAt?: Date },
): EmailPayload {
  const sentAt = formatSentAt(options.sentAt ?? new Date());
  const rows = detailRows(message);
  const footer = `Enviado el ${sentAt} (hora de Madrid). Responde a este email para contestar a ${singleLine(message.email)}.`;

  const text = [
    'Mensaje desde el formulario de contacto de la web.',
    '',
    ...rows.map(([label, value]) => `${label}: ${value}`),
    '',
    'Mensaje:',
    message.message,
    '',
    '—',
    footer,
  ].join('\n');

  const cell = 'padding:2px 12px 2px 0;vertical-align:top;';
  const html = [
    '<!doctype html>',
    '<html lang="es"><head><meta charset="utf-8"></head>',
    '<body style="margin:0;padding:16px;font-family:Helvetica,Arial,sans-serif;font-size:15px;line-height:1.4;color:#27272b;">',
    '<p style="margin:0 0 12px;">Mensaje desde el formulario de contacto de la web.</p>',
    '<table role="presentation" style="border-collapse:collapse;margin:0 0 16px;">',
    ...rows.map(
      ([label, value]) =>
        `<tr><th scope="row" style="${cell}text-align:left;font-weight:700;">${escapeHtml(label)}</th>` +
        `<td style="${cell}">${escapeHtml(value)}</td></tr>`,
    ),
    '</table>',
    '<p style="margin:0 0 4px;font-weight:700;">Mensaje</p>',
    `<div style="white-space:pre-wrap;margin:0 0 16px;">${escapeHtml(message.message)}</div>`,
    `<p style="margin:0;color:#5c5c66;font-size:13px;">${escapeHtml(footer)}</p>`,
    '</body></html>',
  ].join('\n');

  return {
    from: options.from,
    to: [options.to],
    reply_to: message.email,
    subject: contactSubject(message),
    text,
    html,
  };
}

export type SendResult =
  | { ok: true; id: string | undefined; attempts: number }
  | { ok: false; status: number | undefined; attempts: number; error: string };

export interface SendEmailOptions {
  apiKey: string;
  /** Por defecto, la API de Resend. Los e2e usan un servidor simulado. */
  endpoint?: string | undefined;
  fetch?: typeof fetch;
  /** Misma clave en el reintento: Resend no envía dos veces el mismo email. */
  idempotencyKey?: string | undefined;
  timeoutMs?: number;
  retryDelayMs?: number;
  /** Para los tests: esperar sin temporizadores reales. */
  sleep?: (ms: number) => Promise<void>;
}

type Attempt = { ok: true; id: string | undefined } | { ok: false; status: number | undefined; error: string; retry: boolean };

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function attemptSend(payload: EmailPayload, options: SendEmailOptions): Promise<Attempt> {
  const doFetch = options.fetch ?? fetch;
  const headers: Record<string, string> = {
    Authorization: `Bearer ${options.apiKey}`,
    'Content-Type': 'application/json',
  };
  if (options.idempotencyKey) headers['Idempotency-Key'] = options.idempotencyKey;

  let response: Response;
  try {
    response = await doFetch(options.endpoint ?? RESEND_API_URL, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(options.timeoutMs ?? 10_000),
    });
  } catch (error) {
    // Sin respuesta (red o tiempo agotado): como un 5xx, se reintenta.
    return { ok: false, status: undefined, error: error instanceof Error ? error.message : String(error), retry: true };
  }

  const body = (await response.json().catch(() => null)) as { id?: unknown; name?: unknown; message?: unknown } | null;
  if (response.ok) {
    return { ok: true, id: typeof body?.id === 'string' ? body.id : undefined };
  }
  const detail = [body?.name, body?.message].filter((part) => typeof part === 'string').join(': ');
  return {
    ok: false,
    status: response.status,
    error: detail || `HTTP ${response.status}`,
    // 4xx (clave, dominio o límite de Resend): reintentar no lo arregla.
    retry: response.status >= 500,
  };
}

/** Envía el email; si Resend devuelve un 5xx (o no responde), lo reintenta una vez. */
export async function sendEmail(payload: EmailPayload, options: SendEmailOptions): Promise<SendResult> {
  const first = await attemptSend(payload, options);
  if (first.ok) return { ok: true, id: first.id, attempts: 1 };
  if (!first.retry) return { ok: false, status: first.status, error: first.error, attempts: 1 };

  await (options.sleep ?? wait)(options.retryDelayMs ?? 500);
  const second = await attemptSend(payload, options);
  if (second.ok) return { ok: true, id: second.id, attempts: 2 };
  return { ok: false, status: second.status, error: second.error, attempts: 2 };
}
