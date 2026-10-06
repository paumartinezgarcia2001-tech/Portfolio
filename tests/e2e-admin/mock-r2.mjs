/**
 * R2 simulado para los e2e del panel (D64): lo justo de la API S3 que usan el
 * Worker y el navegador, en http://127.0.0.1:4325 (secreto `R2_ENDPOINT` de
 * tests/e2e-admin/dev-vars.mjs).
 *
 * - `GET /<bucket>?list-type=2` → ListObjectsV2 (XML, con páginas: `max-keys`
 *   y `continuation-token`), para medir lo que ocupa el bucket.
 * - `PUT /<bucket>/<clave>` (URL firmada desde el navegador, con CORS):
 *   guarda el archivo; exige la firma y que `content-type` vaya firmado.
 * - `HEAD` y `DELETE /<bucket>/<clave>`; `GET /<bucket>/<clave>` devuelve el
 *   archivo (los tests lo sirven como si fuera el dominio público del bucket).
 * - `/__r2/*`: estado para los tests (reiniciar, leer, rellenar con un objeto
 *   «virtual» de N bytes para probar el límite de 10 GB sin escribirlos).
 *
 * No comprueba la firma criptográfica (eso lo hacen los tests unitarios de
 * src/lib/admin/r2.ts contra el ejemplo de AWS).
 */
import { createServer } from 'node:http';

const args = process.argv.slice(2);
const portIndex = args.indexOf('--port');
const port = Number(portIndex === -1 ? process.env.E2E_R2_PORT || 4325 : args[portIndex + 1]);
export const BUCKET = 'e2e-bucket';

/** @type {Map<string, { size: number, type: string, body: Buffer | null }>} */
let objects = new Map();
/** @type {Array<{ method: string, key: string, type?: string, size?: number, signedHeaders?: string }>} */
let log = [];

function reset() {
  objects = new Map([
    // Lo que ya hay en el bucket de verdad: el vídeo de Media y algún mix.
    ['video/prueba/4x5/master.m3u8', { size: 512, type: 'application/vnd.apple.mpegurl', body: null }],
    ['video/prueba/4x5/seg-000.m4s', { size: 300_000_000, type: 'video/iso.segment', body: null }],
    ['mixes/mix-de-prueba-0000aaaa.mp3', { size: 150_000_000, type: 'audio/mpeg', body: null }],
  ]);
  log = [];
}
reset();

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, HEAD, PUT, DELETE',
  'access-control-allow-headers': 'content-type, cache-control, range',
  'access-control-expose-headers': 'etag, content-length',
};

function send(response, status, body = '', headers = {}) {
  response.writeHead(status, { ...CORS, ...headers });
  response.end(body);
}

const xmlEscape = (text) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function listObjects(url) {
  const max = Math.max(1, Math.min(1000, Number(url.searchParams.get('max-keys') ?? 1000)));
  const keys = [...objects.keys()].sort();
  const after = url.searchParams.get('continuation-token');
  const start = after ? keys.findIndex((key) => key > after) : 0;
  const page = start === -1 ? [] : keys.slice(start, start + max);
  const truncated = start !== -1 && start + max < keys.length;
  const contents = page
    .map((key) => `<Contents><Key>${xmlEscape(key)}</Key><Size>${objects.get(key).size}</Size><StorageClass>STANDARD</StorageClass></Contents>`)
    .join('');
  return (
    `<?xml version="1.0" encoding="UTF-8"?><ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">` +
    `<Name>${BUCKET}</Name><KeyCount>${page.length}</KeyCount><MaxKeys>${max}</MaxKeys>` +
    `<IsTruncated>${truncated}</IsTruncated>${contents}` +
    (truncated ? `<NextContinuationToken>${xmlEscape(page.at(-1))}</NextContinuationToken>` : '') +
    `</ListBucketResult>`
  );
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    request.on('data', (chunk) => chunks.push(chunk));
    request.on('end', () => resolve(Buffer.concat(chunks)));
    request.on('error', reject);
  });
}

createServer(async (request, response) => {
  const url = new URL(request.url ?? '/', `http://${request.headers.host}`);
  const path = decodeURIComponent(url.pathname);

  // Preflight: deja pasar las cabeceras que pida el navegador (los tests añaden
  // `CF-Connecting-IP` a todas las peticiones; el CORS de verdad está en r2/cors.json).
  if (request.method === 'OPTIONS') {
    return send(response, 204, '', {
      'access-control-allow-headers': request.headers['access-control-request-headers'] ?? CORS['access-control-allow-headers'],
    });
  }

  // --- Estado para los tests
  if (path === '/__r2/health') return send(response, 200, 'ok');
  if (path === '/__r2/reset' && request.method === 'POST') {
    reset();
    return send(response, 204);
  }
  if (path === '/__r2/fill' && request.method === 'POST') {
    const bytes = Number(url.searchParams.get('bytes') ?? 0);
    objects.set('relleno/virtual.bin', { size: bytes, type: 'application/octet-stream', body: null });
    return send(response, 204);
  }
  if (path === '/__r2/state') {
    const state = Object.fromEntries(
      [...objects].map(([key, value]) => [key, { size: value.size, type: value.type, head: value.body?.subarray(0, 4).toString('hex') ?? null }]),
    );
    return send(response, 200, JSON.stringify({ objects: state, log }), { 'content-type': 'application/json' });
  }

  // --- API S3 (estilo «path»: /<bucket>/<clave>)
  const [, bucket, ...rest] = path.split('/');
  if (bucket !== BUCKET) return send(response, 404, '<Error><Code>NoSuchBucket</Code></Error>');
  const key = rest.join('/');

  if (!key && request.method === 'GET' && url.searchParams.get('list-type') === '2') {
    if (!url.searchParams.get('X-Amz-Signature')) return send(response, 403, '<Error><Code>AccessDenied</Code></Error>');
    log.push({ method: 'LIST', key: '' });
    return send(response, 200, listObjects(url), { 'content-type': 'application/xml' });
  }
  if (!key) return send(response, 400, '<Error><Code>InvalidRequest</Code></Error>');

  if (request.method === 'PUT') {
    const signedHeaders = url.searchParams.get('X-Amz-SignedHeaders') ?? '';
    if (!url.searchParams.get('X-Amz-Signature')) return send(response, 403, '<Error><Code>AccessDenied</Code></Error>');
    const body = await readBody(request);
    const type = request.headers['content-type'] ?? 'application/octet-stream';
    log.push({ method: 'PUT', key, type, size: body.length, signedHeaders });
    if (!signedHeaders.split(';').includes('content-type')) {
      return send(response, 403, '<Error><Code>SignatureDoesNotMatch</Code></Error>');
    }
    objects.set(key, { size: body.length, type, body });
    return send(response, 200, '', { etag: '"e2e"' });
  }
  const object = objects.get(key);
  if (request.method === 'HEAD') {
    log.push({ method: 'HEAD', key });
    if (!object) return send(response, 404);
    return send(response, 200, '', { 'content-length': String(object.size), 'content-type': object.type });
  }
  if (request.method === 'DELETE') {
    log.push({ method: 'DELETE', key });
    objects.delete(key);
    return send(response, 204);
  }
  if (request.method === 'GET') {
    if (!object?.body) return send(response, 404);
    return send(response, 200, object.body, { 'content-type': object.type, 'content-length': String(object.size) });
  }
  return send(response, 405);
}).listen(port, '127.0.0.1', () => {
  console.log(`[e2e] R2 simulado en http://127.0.0.1:${port}`);
});
