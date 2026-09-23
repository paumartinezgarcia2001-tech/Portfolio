/**
 * Turnstile y Resend simulados para los tests e2e (fase 5).
 *
 * El contenedor de la nube donde se prueban estas fases no llega a
 * `challenges.cloudflare.com` ni a `api.resend.com`, y de todas formas los
 * tests no deberían enviar emails de verdad. Este servidor imita las dos APIs:
 *
 * - `POST /turnstile/v0/siteverify` con el comportamiento documentado de las
 *   **claves de prueba** de Cloudflare (1x… siempre pasa con el token
 *   `XXXX.DUMMY.TOKEN.XXXX`, 2x… siempre falla, 3x… «token ya usado»);
 * - `POST /emails` como la API de Resend (guarda lo que recibe en memoria);
 * - `GET /__e2e/emails?marker=…` para comprobar qué se ha enviado, y
 *   `DELETE /__e2e/emails` para vaciar la lista.
 *
 * El build de los e2e apunta aquí con TURNSTILE_VERIFY_URL y RESEND_API_URL
 * (playwright.config.ts). Con `E2E_TURNSTILE=real` no se usa: los tests van
 * contra Cloudflare de verdad, con sus claves de prueba.
 *
 * Uso: `node tests/e2e/mock-services.mjs --port 4323`
 */
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';

const DUMMY_TOKEN = 'XXXX.DUMMY.TOKEN.XXXX';
const TEST_SECRETS = {
  '1x0000000000000000000000000000000AA': 'pass',
  '2x0000000000000000000000000000000AA': 'fail',
  '3x0000000000000000000000000000000AA': 'spent',
};

/** Emails recibidos, en orden. */
const emails = [];
/** Intentos por Idempotency-Key (para probar el reintento de Resend). */
const attempts = new Map();

const args = process.argv.slice(2);
const portIndex = args.indexOf('--port');
const port = Number(portIndex === -1 ? process.env.E2E_SERVICES_PORT || 4323 : args[portIndex + 1]);

function json(response, status, body) {
  const payload = JSON.stringify(body);
  response.writeHead(status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) });
  response.end(payload);
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    request.on('data', (chunk) => chunks.push(chunk));
    request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    request.on('error', reject);
  });
}

function parseBody(request, raw) {
  const type = request.headers['content-type'] ?? '';
  if (type.includes('application/json')) {
    try {
      return JSON.parse(raw);
    } catch {
      return {};
    }
  }
  return Object.fromEntries(new URLSearchParams(raw));
}

/** Respuesta de `siteverify` con las claves de prueba de Cloudflare. */
function siteverify(body) {
  const secret = String(body.secret ?? '');
  const token = String(body.response ?? '');
  if (!secret) return { success: false, 'error-codes': ['missing-input-secret'] };
  const behaviour = TEST_SECRETS[secret];
  if (!behaviour) return { success: false, 'error-codes': ['invalid-input-secret'] };
  if (!token) return { success: false, 'error-codes': ['missing-input-response'] };
  if (behaviour === 'fail') return { success: false, 'error-codes': ['invalid-input-response'] };
  if (behaviour === 'spent') return { success: false, 'error-codes': ['timeout-or-duplicate'] };
  if (token !== DUMMY_TOKEN) return { success: false, 'error-codes': ['invalid-input-response'] };
  return {
    success: true,
    challenge_ts: new Date().toISOString(),
    hostname: 'localhost',
    // Como las claves de prueba: sin `action` (el servidor solo la compara si viene).
    action: '',
    cdata: '',
    'error-codes': [],
  };
}

const server = createServer((request, response) => {
  const url = new URL(request.url ?? '/', `http://localhost:${port}`);

  if (request.method === 'GET' && url.pathname === '/__e2e/health') {
    response.writeHead(200, { 'content-type': 'text/plain' });
    response.end('ok');
    return;
  }

  if (url.pathname === '/__e2e/emails') {
    if (request.method === 'DELETE') {
      emails.length = 0;
      attempts.clear();
      json(response, 200, { ok: true });
      return;
    }
    if (request.method === 'GET') {
      const marker = url.searchParams.get('marker');
      const list = marker ? emails.filter((email) => JSON.stringify(email.body).includes(marker)) : emails;
      json(response, 200, { emails: list, total: emails.length });
      return;
    }
  }

  if (request.method !== 'POST') {
    json(response, 405, { error: 'method-not-allowed' });
    return;
  }

  void readBody(request).then((raw) => {
    const body = parseBody(request, raw);

    if (url.pathname === '/turnstile/v0/siteverify') {
      json(response, 200, siteverify(body));
      return;
    }

    if (url.pathname === '/emails') {
      const auth = request.headers.authorization ?? '';
      if (!auth.startsWith('Bearer ')) {
        json(response, 401, { name: 'missing_api_key', message: 'Missing API key' });
        return;
      }
      const key = String(request.headers['idempotency-key'] ?? '');
      const attempt = (attempts.get(key) ?? 0) + 1;
      if (key) attempts.set(key, attempt);
      const text = `${body.subject ?? ''} ${body.text ?? ''}`;

      // Fallos a propósito, según lo que diga el mensaje.
      if (text.includes('[e2e:resend-500]')) {
        json(response, 500, { name: 'application_error', message: 'Simulado: Resend no está disponible.' });
        return;
      }
      if (text.includes('[e2e:resend-500-once]') && attempt === 1) {
        json(response, 500, { name: 'application_error', message: 'Simulado: falla el primer intento.' });
        return;
      }

      const id = randomUUID();
      emails.push({
        id,
        at: new Date().toISOString(),
        idempotencyKey: key,
        attempts: attempt,
        body,
      });
      json(response, 200, { id });
      return;
    }

    json(response, 404, { error: 'not-found' });
  });
});

server.listen(port, '127.0.0.1', () => {
  console.log(`[e2e] Turnstile y Resend simulados en http://127.0.0.1:${port}`);
});
