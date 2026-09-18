#!/usr/bin/env node
// @ts-check
/**
 * Servidor local de `.media/` que imita al bucket de R2: CORS, `Range` y el
 * `Content-Type` de cada archivo. Sirve para ver el vídeo sin R2:
 *
 *   node scripts/serve-media.mjs            → http://localhost:4322
 *   PUBLIC_MEDIA_BASE_URL=http://localhost:4322 en .env y `npm run dev`
 *
 * Los tests e2e lo arrancan solos (playwright.config.ts).
 *
 * Opciones: --port 4322 · --root .media
 */
import { createReadStream, existsSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { contentTypeFor } from './lib/video.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const { values: opts } = parseArgs({
  options: {
    port: { type: 'string', default: process.env.MEDIA_PORT ?? '4322' },
    root: { type: 'string' },
  },
});

const root = opts.root ? path.resolve(opts.root) : path.join(ROOT, '.media');
const port = Number(opts.port);

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, HEAD',
  'Access-Control-Allow-Headers': 'Range',
  'Access-Control-Expose-Headers': 'Content-Length, Content-Range, Accept-Ranges, ETag',
  'Access-Control-Max-Age': '86400',
};

/**
 * `bytes=inicio-fin` (un solo rango) → posiciones, o `null` si no se puede servir.
 * @param {string} header
 * @param {number} size
 */
function parseRange(header, size) {
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match || (match[1] === '' && match[2] === '')) return null;
  let start;
  let end;
  if (match[1] === '') {
    // Sufijo: los últimos N bytes.
    const suffix = Number(match[2]);
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(match[1]);
    end = match[2] === '' ? size - 1 : Math.min(Number(match[2]), size - 1);
  }
  return start <= end && start < size ? { start, end } : null;
}

const server = createServer(async (req, res) => {
  for (const [name, value] of Object.entries(CORS)) res.setHeader(name, value);

  if (req.method === 'OPTIONS') {
    res.writeHead(204).end();
    return;
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { Allow: 'GET, HEAD, OPTIONS' }).end();
    return;
  }

  const url = new URL(req.url ?? '/', 'http://localhost');
  if (url.pathname === '/') {
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' }).end('media: ok\n');
    return;
  }

  // Nada fuera de la raíz ni ocultos (`.stamp`, `_src/`).
  const relative = decodeURIComponent(url.pathname).replace(/^\/+/, '');
  const file = path.resolve(root, relative);
  const hidden = relative.split('/').some((part) => part.startsWith('.') || part.startsWith('_'));
  if (hidden || !file.startsWith(root + path.sep) || !existsSync(file)) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('No existe\n');
    return;
  }
  const info = await stat(file);
  if (!info.isFile()) {
    res.writeHead(404).end();
    return;
  }

  const headers = {
    'Content-Type': contentTypeFor(file),
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'no-cache',
    ETag: `"${info.size.toString(16)}-${Math.floor(info.mtimeMs).toString(16)}"`,
  };

  const rangeHeader = req.headers.range;
  if (rangeHeader) {
    const range = parseRange(rangeHeader, info.size);
    if (!range) {
      res.writeHead(416, { ...headers, 'Content-Range': `bytes */${info.size}` }).end();
      return;
    }
    res.writeHead(206, {
      ...headers,
      'Content-Range': `bytes ${range.start}-${range.end}/${info.size}`,
      'Content-Length': range.end - range.start + 1,
    });
    if (req.method === 'HEAD') res.end();
    else createReadStream(file, range).pipe(res);
    return;
  }

  res.writeHead(200, { ...headers, 'Content-Length': info.size });
  if (req.method === 'HEAD') res.end();
  else createReadStream(file).pipe(res);
});

server.listen(port, () => {
  console.log(`Sirviendo ${root} en http://localhost:${port} (Ctrl+C para parar)`);
});
