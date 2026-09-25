import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CONTACT_ERROR_CODES, CONTACT_RATE_LIMIT } from '../../src/config/contact';
import {
  contactOutcomeError,
  handleContact,
  missingContactConfig,
  type ContactConfig,
  type ContactDeps,
} from '../../src/lib/contact/handler';
import type { RateLimitStore } from '../../src/lib/contact/rate-limit';
import { contactSchema, type ContactInput } from '../../src/lib/contact/schema';

/** C17 · orden de comprobaciones del servidor: honeypot, límite, Turnstile, envío. */

const CONFIG: ContactConfig = {
  turnstileSecret: '1x0000000000000000000000000000000AA',
  resendApiKey: 're_test',
  to: 'pau@example.test',
  from: 'web@example.test',
  turnstileVerifyUrl: 'https://turnstile.test/siteverify',
  resendApiUrl: 'https://resend.test/emails',
};

const NOW = new Date('2026-09-19T20:00:00Z');

function input(overrides: Partial<ContactInput> = {}): ContactInput {
  return contactSchema.parse({
    email: 'ana@example.com',
    telefono: '600112233',
    mensaje: 'Hola, quiero proponerte una fecha.',
    'cf-turnstile-response': 'XXXX.DUMMY.TOKEN.XXXX',
    ...overrides,
  });
}

class MemoryStore implements RateLimitStore {
  constructor(private readonly values = new Map<string, string>()) {}
  puts = 0;
  async get(key: string): Promise<string | null> {
    return this.values.get(key) ?? null;
  }
  async put(key: string, value: string): Promise<void> {
    this.puts += 1;
    this.values.set(key, value);
  }
}

const silent = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

/** fetch de mentira: responde a Turnstile y a Resend. */
function fakeFetch(options: { verify?: unknown; send?: { status: number; body?: unknown } } = {}) {
  return vi.fn(async (url: RequestInfo | URL) => {
    const target = String(url);
    if (target.includes('siteverify')) {
      return new Response(JSON.stringify(options.verify ?? { success: true }), {
        headers: { 'content-type': 'application/json' },
      });
    }
    const send = options.send ?? { status: 200, body: { id: 'email-1' } };
    return new Response(JSON.stringify(send.body ?? {}), {
      status: send.status,
      headers: { 'content-type': 'application/json' },
    });
  });
}

function deps(overrides: Partial<ContactDeps> = {}): ContactDeps {
  return {
    config: CONFIG,
    clientIp: '203.0.113.10',
    now: () => NOW,
    randomId: () => 'id-fijo',
    logger: silent,
    fetch: fakeFetch(),
    ...overrides,
  };
}

beforeEach(() => {
  silent.info.mockClear();
  silent.warn.mockClear();
  silent.error.mockClear();
});

describe('missingContactConfig', () => {
  it('nombra los secrets que faltan', () => {
    expect(missingContactConfig({})).toEqual([
      'TURNSTILE_SECRET_KEY',
      'RESEND_API_KEY',
      'CONTACT_TO_EMAIL',
      'CONTACT_FROM_EMAIL',
    ]);
    expect(missingContactConfig({ ...CONFIG, to: '  ' })).toEqual(['CONTACT_TO_EMAIL']);
    expect(missingContactConfig(CONFIG)).toEqual([]);
  });
});

describe('handleContact', () => {
  it('envía el email y apunta el envío para el límite', async () => {
    const store = new MemoryStore();
    const fetchMock = fakeFetch();
    const outcome = await handleContact(input(), deps({ store, fetch: fetchMock }));
    expect(outcome).toEqual({ status: 'sent', id: 'email-1' });
    expect(store.puts).toBe(1);
    const urls = fetchMock.mock.calls.map((call) => String(call[0]));
    expect(urls).toEqual(['https://turnstile.test/siteverify', 'https://resend.test/emails']);
  });

  it('con el honeypot marcado no verifica, no envía y no gasta límite', async () => {
    const store = new MemoryStore();
    const fetchMock = fakeFetch();
    const outcome = await handleContact(input({ botcheck: true }), deps({ store, fetch: fetchMock }));
    expect(outcome).toEqual({ status: 'discarded' });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(store.puts).toBe(0);
    expect(silent.info).toHaveBeenCalled();
  });

  it('sin secrets no envía nada y lo deja en el registro', async () => {
    const fetchMock = fakeFetch();
    const outcome = await handleContact(input(), deps({ config: { ...CONFIG, resendApiKey: '' }, fetch: fetchMock }));
    expect(outcome).toEqual({ status: 'not-configured', missing: ['RESEND_API_KEY'] });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(silent.error).toHaveBeenCalled();
  });

  it('pasado el límite, ni verifica ni envía', async () => {
    const store = new MemoryStore();
    // Cinco envíos recientes de esta IP.
    const first = await handleContact(input(), deps({ store }));
    expect(first.status).toBe('sent');
    for (let i = 0; i < CONTACT_RATE_LIMIT.max; i++) await handleContact(input(), deps({ store }));

    const fetchMock = fakeFetch();
    const outcome = await handleContact(input(), deps({ store, fetch: fetchMock }));
    expect(outcome.status).toBe('rate-limited');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('otra IP tiene su propio límite', async () => {
    const store = new MemoryStore();
    for (let i = 0; i < CONTACT_RATE_LIMIT.max; i++) await handleContact(input(), deps({ store }));
    expect((await handleContact(input(), deps({ store }))).status).toBe('rate-limited');
    expect((await handleContact(input(), deps({ store, clientIp: '203.0.113.99' }))).status).toBe('sent');
  });

  it('sin binding de KV avisa una vez y sigue enviando', async () => {
    const outcome = await handleContact(input(), deps({ store: undefined }));
    expect(outcome.status).toBe('sent');
  });

  it('si KV falla, no bloquea el formulario', async () => {
    const broken: RateLimitStore = {
      get: () => Promise.reject(new Error('KV caído')),
      put: () => Promise.resolve(),
    };
    const outcome = await handleContact(input(), deps({ store: broken }));
    expect(outcome.status).toBe('sent');
    expect(silent.error).toHaveBeenCalled();
  });

  it('sin token de Turnstile no llama a Cloudflare ni envía', async () => {
    const fetchMock = fakeFetch();
    const outcome = await handleContact(input({ 'cf-turnstile-response': '' }), deps({ fetch: fetchMock }));
    expect(outcome).toEqual({ status: 'turnstile-missing' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('si Turnstile rechaza el token, no se envía nada', async () => {
    const fetchMock = fakeFetch({ verify: { success: false, 'error-codes': ['invalid-input-response'] } });
    const outcome = await handleContact(input(), deps({ fetch: fetchMock }));
    expect(outcome).toEqual({ status: 'turnstile-failed' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(silent.warn).toHaveBeenCalled();
  });

  it('si Cloudflare no responde, tampoco se envía (no se deja pasar sin verificar)', async () => {
    const fetchMock = vi.fn(async (url: RequestInfo | URL) => {
      if (String(url).includes('siteverify')) throw new Error('network');
      return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
    });
    const outcome = await handleContact(input(), deps({ fetch: fetchMock }));
    expect(outcome).toEqual({ status: 'turnstile-unavailable' });
  });

  it('si Resend falla, el envío no cuenta para el límite', async () => {
    const store = new MemoryStore();
    const fetchMock = fakeFetch({ send: { status: 500, body: { name: 'application_error', message: 'boom' } } });
    const outcome = await handleContact(input(), deps({ store, fetch: fetchMock }));
    expect(outcome).toEqual({ status: 'send-failed' });
    expect(store.puts).toBe(0);
    expect(silent.error).toHaveBeenCalled();
  });
});

describe('contactOutcomeError', () => {
  it('éxito y descartado no son error', () => {
    expect(contactOutcomeError({ status: 'sent', id: 'x' })).toBeNull();
    expect(contactOutcomeError({ status: 'discarded' })).toBeNull();
  });

  it('cada fallo tiene su código de estado y su texto', () => {
    expect(contactOutcomeError({ status: 'rate-limited', retryAfterSeconds: 60 })).toEqual({
      code: 'TOO_MANY_REQUESTS',
      message: CONTACT_ERROR_CODES.rateLimited,
    });
    expect(contactOutcomeError({ status: 'turnstile-missing' })).toEqual({
      code: 'FORBIDDEN',
      message: CONTACT_ERROR_CODES.turnstileMissing,
    });
    expect(contactOutcomeError({ status: 'turnstile-failed' })).toEqual({
      code: 'FORBIDDEN',
      message: CONTACT_ERROR_CODES.turnstileFailed,
    });
    expect(contactOutcomeError({ status: 'not-configured', missing: [] })).toEqual({
      code: 'SERVICE_UNAVAILABLE',
      message: CONTACT_ERROR_CODES.notConfigured,
    });
    expect(contactOutcomeError({ status: 'turnstile-unavailable' })).toEqual({
      code: 'SERVICE_UNAVAILABLE',
      message: CONTACT_ERROR_CODES.sendFailed,
    });
    expect(contactOutcomeError({ status: 'send-failed' })).toEqual({
      code: 'BAD_GATEWAY',
      message: CONTACT_ERROR_CODES.sendFailed,
    });
  });
});
