import { describe, expect, it, vi } from 'vitest';
import type { ContactMessage } from '../../src/lib/contact/schema';
import { RESEND_API_URL, buildContactEmail, contactSubject, escapeHtml, sendEmail, singleLine } from '../../src/lib/email';

/** C17 · el email que llega a Pau: texto + HTML escapado, y un solo reintento. */

const MESSAGE: ContactMessage = {
  email: 'ana@example.com',
  phone: '+34 600 11 22 33',
  message: 'Hola:\n<script>alert(1)</script>\n¿Fecha libre en "LA MARIQUEEN" & sala 2?',
};

const OPTIONS = { from: 'web@travest15m0.test', to: 'pau@travest15m0.test', sentAt: new Date('2026-09-19T20:30:00Z') };

describe('escapeHtml', () => {
  it('escapa lo que podría cerrar una etiqueta o un atributo', () => {
    expect(escapeHtml('<script>"x" & \'y\'</script>')).toBe('&lt;script&gt;&quot;x&quot; &amp; &#39;y&#39;&lt;/script&gt;');
  });

  it('no toca el texto normal, con acentos incluidos', () => {
    expect(escapeHtml('¿Qué tal, Pau? ñ á')).toBe('¿Qué tal, Pau? ñ á');
  });
});

describe('singleLine', () => {
  it('quita saltos y caracteres de control y colapsa espacios', () => {
    expect(singleLine('Ana\r\nPrueba\t  de\u0000 nombre')).toBe('Ana Prueba de nombre');
  });
});

describe('contactSubject', () => {
  it('«[web] mensaje de {email}»', () => {
    expect(contactSubject({ email: 'ana@example.com' })).toBe('[web] mensaje de ana@example.com');
  });

  it('un email con saltos de línea no rompe el asunto', () => {
    expect(contactSubject({ email: 'ana@example.com\nBcc: alguien@example.com' })).toBe(
      '[web] mensaje de ana@example.com Bcc: alguien@example.com',
    );
  });
});

describe('buildContactEmail', () => {
  const payload = buildContactEmail(MESSAGE, OPTIONS);

  it('se responde a quien escribe, no a la web', () => {
    expect(payload.reply_to).toBe('ana@example.com');
    expect(payload.from).toBe('web@travest15m0.test');
    expect(payload.to).toEqual(['pau@travest15m0.test']);
  });

  it('el texto lleva los datos y el mensaje tal cual', () => {
    expect(payload.text).toContain('Email: ana@example.com');
    expect(payload.text).toContain('Teléfono: +34 600 11 22 33');
    expect(payload.text).toContain('<script>alert(1)</script>');
    expect(payload.text).toContain('Enviado el 19-09-2026 a las 22:30 (hora de Madrid)');
  });

  it('el HTML va escapado: nada de lo que escriba nadie se interpreta', () => {
    expect(payload.html).not.toContain('<script>alert(1)</script>');
    expect(payload.html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(payload.html).toContain('&quot;LA MARIQUEEN&quot; &amp; sala 2');
  });

  it('sin teléfono, esa fila no aparece', () => {
    const simple = buildContactEmail({ ...MESSAGE, phone: undefined }, OPTIONS);
    expect(simple.text).toContain('Email: ana@example.com');
    expect(simple.text).not.toContain('Teléfono');
  });
});

/** Argumentos con los que se llamó al `fetch` de mentira (los tipos de vi.fn no los conservan). */
function callArgs(mock: { mock: { calls: unknown[] } }, index = 0): { url: string; init: RequestInit } {
  const [url, init] = mock.mock.calls[index] as unknown as [string, RequestInit];
  return { url, init };
}

/** Respuesta de Resend de mentira. */
function response(status: number, body: unknown = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

const payload = buildContactEmail(MESSAGE, OPTIONS);
const sleep = () => Promise.resolve();

describe('sendEmail', () => {
  it('envía a la API de Resend con la clave, el JSON y la clave de idempotencia', async () => {
    const fetchMock = vi.fn(async () => response(200, { id: 'abc' }));
    const result = await sendEmail(payload, { apiKey: 're_test', idempotencyKey: 'clave-1', fetch: fetchMock, sleep });
    expect(result).toEqual({ ok: true, id: 'abc', attempts: 1 });
    const { url, init } = callArgs(fetchMock);
    expect(url).toBe(RESEND_API_URL);
    expect(init.method).toBe('POST');
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer re_test');
    expect(headers['Idempotency-Key']).toBe('clave-1');
    expect(JSON.parse(String(init.body)).subject).toBe(payload.subject);
  });

  it('usa otra URL si se le pasa (servidor simulado de los e2e)', async () => {
    const fetchMock = vi.fn(async () => response(200, { id: 'abc' }));
    await sendEmail(payload, { apiKey: 're_test', endpoint: 'http://127.0.0.1:4323/emails', fetch: fetchMock, sleep });
    expect(callArgs(fetchMock).url).toBe('http://127.0.0.1:4323/emails');
  });

  it('reintenta una vez si Resend devuelve un 5xx, con la misma clave de idempotencia', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(response(500, { name: 'application_error', message: 'boom' }))
      .mockResolvedValueOnce(response(200, { id: 'abc' }));
    const result = await sendEmail(payload, { apiKey: 're_test', idempotencyKey: 'clave-2', fetch: fetchMock, sleep });
    expect(result).toEqual({ ok: true, id: 'abc', attempts: 2 });
    const keys = [0, 1].map((index) => callArgs(fetchMock, index).init.headers as Record<string, string>);
    expect(keys.map((header) => header['Idempotency-Key'])).toEqual(['clave-2', 'clave-2']);
  });

  it('un solo reintento: si el segundo intento también falla, devuelve el error', async () => {
    const fetchMock = vi.fn(async () => response(503, { name: 'service_unavailable', message: 'nope' }));
    const result = await sendEmail(payload, { apiKey: 're_test', fetch: fetchMock, sleep });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result).toEqual({ ok: false, status: 503, error: 'service_unavailable: nope', attempts: 2 });
  });

  it('no reintenta un 4xx (clave mal, dominio sin verificar, límite de Resend)', async () => {
    const fetchMock = vi.fn(async () => response(422, { name: 'validation_error', message: 'from no válido' }));
    const result = await sendEmail(payload, { apiKey: 're_test', fetch: fetchMock, sleep });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ ok: false, status: 422, error: 'validation_error: from no válido', attempts: 1 });
  });

  it('si no hay respuesta (red o tiempo agotado), reintenta una vez', async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce(response(200, { id: 'abc' }));
    const result = await sendEmail(payload, { apiKey: 're_test', fetch: fetchMock, sleep });
    expect(result).toEqual({ ok: true, id: 'abc', attempts: 2 });
  });
});
