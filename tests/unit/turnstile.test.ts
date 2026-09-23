import { describe, expect, it, vi } from 'vitest';
import { TURNSTILE_VERIFY_URL, verifyTurnstile } from '../../src/lib/contact/turnstile';

/** C17 · verificación de Turnstile en el servidor (siteverify, con la IP). */

const SECRET = '1x0000000000000000000000000000000AA';
const TOKEN = 'XXXX.DUMMY.TOKEN.XXXX';

/** Argumentos con los que se llamó al `fetch` de mentira (los tipos de vi.fn no los conservan). */
function callArgs(mock: { mock: { calls: unknown[] } }, index = 0): { url: string; init: RequestInit } {
  const [url, init] = mock.mock.calls[index] as unknown as [string, RequestInit];
  return { url, init };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

describe('verifyTurnstile', () => {
  it('sin token no llama a Cloudflare', async () => {
    const fetchMock = vi.fn();
    const verdict = await verifyTurnstile({ token: '  ', secret: SECRET, fetch: fetchMock });
    expect(verdict).toEqual({ ok: false, reason: 'missing', errorCodes: ['missing-input-response'] });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('un token larguísimo se rechaza sin llamar a Cloudflare', async () => {
    const fetchMock = vi.fn();
    const verdict = await verifyTurnstile({ token: 'x'.repeat(3000), secret: SECRET, fetch: fetchMock });
    expect(verdict).toMatchObject({ ok: false, reason: 'rejected' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('manda el secreto, el token, la IP y una clave de idempotencia', async () => {
    const fetchMock = vi.fn(async () => json({ success: true }));
    const verdict = await verifyTurnstile({
      token: TOKEN,
      secret: SECRET,
      remoteIp: '203.0.113.10',
      idempotencyKey: 'clave-1',
      fetch: fetchMock,
    });
    expect(verdict).toEqual({ ok: true });
    const { url, init } = callArgs(fetchMock);
    expect(url).toBe(TURNSTILE_VERIFY_URL);
    const body = init.body as URLSearchParams;
    expect(Object.fromEntries(body)).toEqual({
      secret: SECRET,
      response: TOKEN,
      remoteip: '203.0.113.10',
      idempotency_key: 'clave-1',
    });
  });

  it('usa otra URL si se le pasa (servidor simulado de los e2e)', async () => {
    const fetchMock = vi.fn(async () => json({ success: true }));
    await verifyTurnstile({ token: TOKEN, secret: SECRET, endpoint: 'http://127.0.0.1:4323/turnstile/v0/siteverify', fetch: fetchMock });
    expect(callArgs(fetchMock).url).toBe('http://127.0.0.1:4323/turnstile/v0/siteverify');
  });

  it('si Cloudflare dice que no, devuelve sus códigos', async () => {
    const fetchMock = vi.fn(async () => json({ success: false, 'error-codes': ['timeout-or-duplicate'] }));
    const verdict = await verifyTurnstile({ token: TOKEN, secret: SECRET, fetch: fetchMock });
    expect(verdict).toEqual({ ok: false, reason: 'rejected', errorCodes: ['timeout-or-duplicate'] });
  });

  it('rechaza un token de otro widget (acción distinta)', async () => {
    const fetchMock = vi.fn(async () => json({ success: true, action: 'login' }));
    const verdict = await verifyTurnstile({ token: TOKEN, secret: SECRET, expectedAction: 'contact', fetch: fetchMock });
    expect(verdict).toMatchObject({ ok: false, reason: 'rejected' });
  });

  it('acepta la respuesta sin acción (claves de prueba de Cloudflare)', async () => {
    const fetchMock = vi.fn(async () => json({ success: true, action: '' }));
    const verdict = await verifyTurnstile({ token: TOKEN, secret: SECRET, expectedAction: 'contact', fetch: fetchMock });
    expect(verdict).toEqual({ ok: true });
  });

  it('si Cloudflare no responde, reintenta una vez y al final no deja pasar', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('network'));
    const verdict = await verifyTurnstile({ token: TOKEN, secret: SECRET, fetch: fetchMock });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(verdict).toMatchObject({ ok: false, reason: 'unavailable' });
  });

  it('un 5xx se reintenta; si el segundo intento va bien, pasa', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(json({}, 500)).mockResolvedValueOnce(json({ success: true }));
    const verdict = await verifyTurnstile({ token: TOKEN, secret: SECRET, fetch: fetchMock });
    expect(verdict).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('un 4xx no se reintenta', async () => {
    const fetchMock = vi.fn(async () => json({}, 400));
    const verdict = await verifyTurnstile({ token: TOKEN, secret: SECRET, fetch: fetchMock });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(verdict).toMatchObject({ ok: false, reason: 'unavailable', errorCodes: ['http-400'] });
  });
});
