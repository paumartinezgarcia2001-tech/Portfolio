import { describe, expect, it, vi } from 'vitest';
import type { ContactMessage } from '../../src/lib/contact/schema';
import {
  WEB3FORMS_ENDPOINT,
  WEB3FORMS_FROM_NAME,
  WEB3FORMS_SUBJECT,
  buildWeb3FormsPayload,
  submitToWeb3Forms,
} from '../../src/lib/contact/web3forms';

/** D58 · envío por Web3Forms, el camino del build estático (GitHub Pages). */

const MESSAGE: ContactMessage = {
  email: 'ana@example.com',
  phone: '+34 600 11 22 33',
  message: 'Hola, quiero proponerte una fecha.',
};

/** Argumentos con los que se llamó al `fetch` de mentira (los tipos de vi.fn no los conservan). */
function callArgs(mock: { mock: { calls: unknown[] } }, index = 0): { url: string; init: RequestInit } {
  const [url, init] = mock.mock.calls[index] as unknown as [string, RequestInit];
  return { url, init };
}

function response(status: number, body: unknown = { success: true }): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

describe('buildWeb3FormsPayload', () => {
  it('lleva la clave, el asunto, el remitente y a quién se responde', () => {
    expect(buildWeb3FormsPayload(MESSAGE, 'clave-1')).toEqual({
      access_key: 'clave-1',
      subject: WEB3FORMS_SUBJECT,
      from_name: WEB3FORMS_FROM_NAME,
      replyto: 'ana@example.com',
      email: 'ana@example.com',
      telefono: '+34 600 11 22 33',
      mensaje: 'Hola, quiero proponerte una fecha.',
    });
  });

  it('sin teléfono, ese campo no se manda: Web3Forms escribe en el correo todo lo que recibe', () => {
    const payload = buildWeb3FormsPayload({ ...MESSAGE, phone: undefined }, 'clave-1');
    expect(payload).not.toHaveProperty('telefono');
  });

  it('no manda el `redirect`: eso es solo para el envío sin JavaScript', () => {
    expect(buildWeb3FormsPayload(MESSAGE, 'clave-1')).not.toHaveProperty('redirect');
  });
});

describe('submitToWeb3Forms', () => {
  const payload = buildWeb3FormsPayload(MESSAGE, 'clave-1');

  it('manda el JSON a la API, pidiendo JSON de vuelta', async () => {
    const fetchMock = vi.fn(async () => response(200));
    expect(await submitToWeb3Forms(payload, { fetch: fetchMock })).toEqual({ ok: true });
    const { url, init } = callArgs(fetchMock);
    expect(url).toBe(WEB3FORMS_ENDPOINT);
    expect(init.method).toBe('POST');
    expect(init.headers).toMatchObject({ 'Content-Type': 'application/json', Accept: 'application/json' });
    expect(JSON.parse(String(init.body))).toEqual(payload);
  });

  it('usa otra URL si se le pasa', async () => {
    const fetchMock = vi.fn(async () => response(200));
    await submitToWeb3Forms(payload, { endpoint: 'http://127.0.0.1:4323/submit', fetch: fetchMock });
    expect(callArgs(fetchMock).url).toBe('http://127.0.0.1:4323/submit');
  });

  it('un error de Web3Forms llega con su mensaje', async () => {
    const fetchMock = vi.fn(async () => response(400, { success: false, message: 'Access key is invalid' }));
    expect(await submitToWeb3Forms(payload, { fetch: fetchMock })).toEqual({
      ok: false,
      status: 400,
      error: 'Access key is invalid',
    });
  });

  it('un 200 con `success: false` tampoco cuenta como enviado', async () => {
    const fetchMock = vi.fn(async () => response(200, { success: false, message: 'Spam' }));
    expect(await submitToWeb3Forms(payload, { fetch: fetchMock })).toMatchObject({ ok: false, error: 'Spam' });
  });

  it('sin respuesta (red o tiempo agotado) no reintenta: reintentar duplicaría el correo', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('network'));
    expect(await submitToWeb3Forms(payload, { fetch: fetchMock })).toEqual({
      ok: false,
      status: undefined,
      error: 'network',
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
