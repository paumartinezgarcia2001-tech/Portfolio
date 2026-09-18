#!/usr/bin/env node
// @ts-check
/**
 * Sube archivos a Cloudflare R2 con la API S3 (prompt maestro §7.5).
 *
 * Uso (desde Portfolio/):
 *   node scripts/upload-to-r2.mjs                                 → todo .media/
 *   node scripts/upload-to-r2.mjs video/prueba-media-4f47f141     → solo esa carpeta
 *   node scripts/upload-to-r2.mjs --root "<carpeta>" [--dry-run]
 *
 * - Las claves de R2 son las rutas relativas a la raíz (`--root`, por defecto
 *   `.media/`, donde deja la salida `video-to-hls.mjs`):
 *   `.media/video/<slug>-<hash>/4x5/master.m3u8` → `video/<slug>-<hash>/4x5/master.m3u8`.
 * - `Content-Type` según la extensión y `Cache-Control: public, max-age=31536000,
 *   immutable` (cada vídeo va en una carpeta con hash: nunca se sobrescribe).
 * - Idempotente: no vuelve a subir lo que ya está con el mismo tamaño, el mismo
 *   ETag (MD5) y las mismas cabeceras.
 * - Se salta los archivos y carpetas que empiezan por «.» o «_» (p. ej. `_src/`).
 *
 * Variables (se leen de `.env` si existe): R2_ACCOUNT_ID, R2_ACCESS_KEY_ID,
 * R2_SECRET_ACCESS_KEY y R2_BUCKET (token de API de R2 con permiso de escritura
 * en ese bucket). Opcionales: R2_ENDPOINT (otro endpoint S3, p. ej. la
 * jurisdicción UE: https://<cuenta>.eu.r2.cloudflarestorage.com) y
 * PUBLIC_MEDIA_BASE_URL (para imprimir las URLs públicas al terminar).
 */
import { createHash } from 'node:crypto';
import { createReadStream, existsSync } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { CACHE_IMMUTABLE, contentTypeFor, etagMatches, formatBytes, objectKey } from './lib/video.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const HELP = `Uso: node scripts/upload-to-r2.mjs [ruta …] [opciones]

  ruta                 carpeta o archivo dentro de la raíz (por defecto, toda la raíz)
  --root <carpeta>     raíz de las claves (por defecto, .media/)
  --prefix <prefijo>   prefijo para las claves (por defecto, ninguno)
  --dry-run            enseña qué subiría, sin subir nada
  --concurrency 6      subidas en paralelo
  --force              sube aunque ya esté igual en R2`;

const { values: opts, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    root: { type: 'string' },
    prefix: { type: 'string', default: '' },
    'dry-run': { type: 'boolean', default: false },
    concurrency: { type: 'string', default: '6' },
    force: { type: 'boolean', default: false },
    help: { type: 'boolean', short: 'h', default: false },
  },
});

if (opts.help) {
  console.log(HELP);
  process.exit(0);
}

/**
 * @param {string} message
 * @returns {never}
 */
function fail(message) {
  console.error(`✗ ${message}`);
  process.exit(1);
}

// `.env` del repo (Node ≥ 20.12). Las variables que ya estén definidas mandan.
const envFile = path.join(ROOT, '.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);

const root = opts.root ? path.resolve(opts.root) : path.join(ROOT, '.media');
if (!existsSync(root)) fail(`No existe la carpeta ${root}. Genera antes el vídeo con scripts/video-to-hls.mjs.`);

const dryRun = opts['dry-run'];
const concurrency = Math.max(1, Math.min(16, Number(opts.concurrency) || 6));
const { R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET, R2_ENDPOINT, PUBLIC_MEDIA_BASE_URL } =
  process.env;

const missing = Object.entries({ R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET })
  .filter(([, value]) => !value)
  .map(([name]) => name);
if (!R2_ENDPOINT && !R2_ACCOUNT_ID) missing.unshift('R2_ACCOUNT_ID');
const canConnect = missing.length === 0;
if (!canConnect && !dryRun) fail(`Faltan variables en .env: ${missing.join(', ')} (ver .env.example).`);
if (!canConnect) console.log(`· Sin credenciales (${missing.join(', ')}): solo se listan los archivos.`);

const client = canConnect
  ? new S3Client({
      region: 'auto',
      endpoint: R2_ENDPOINT || `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      forcePathStyle: Boolean(R2_ENDPOINT),
      credentials: {
        accessKeyId: /** @type {string} */ (R2_ACCESS_KEY_ID),
        secretAccessKey: /** @type {string} */ (R2_SECRET_ACCESS_KEY),
      },
      // R2 no admite todas las sumas de comprobación nuevas del SDK: solo las necesarias.
      requestChecksumCalculation: 'WHEN_REQUIRED',
      responseChecksumValidation: 'WHEN_REQUIRED',
    })
  : null;
const bucket = /** @type {string} */ (R2_BUCKET);

/** @param {string} name */
const hidden = (name) => name.startsWith('.') || name.startsWith('_');

/**
 * Archivos bajo `target` (carpeta o archivo), sin los ocultos.
 * @param {string} target
 * @returns {Promise<string[]>}
 */
async function listFiles(target) {
  const info = await stat(target);
  if (info.isFile()) return [target];
  /** @type {string[]} */
  const files = [];
  for (const entry of await readdir(target, { withFileTypes: true })) {
    if (hidden(entry.name)) continue;
    const full = path.join(target, entry.name);
    if (entry.isDirectory()) files.push(...(await listFiles(full)));
    else if (entry.isFile()) files.push(full);
  }
  return files;
}

/** @param {string} file */
async function md5(file) {
  const hash = createHash('md5');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest();
}

/**
 * @param {unknown} error
 */
function isNotFound(error) {
  const e = /** @type {{ name?: string, $metadata?: { httpStatusCode?: number } }} */ (error);
  return e?.name === 'NotFound' || e?.name === 'NoSuchKey' || e?.$metadata?.httpStatusCode === 404;
}

const targets = positionals.length > 0 ? positionals.map((p) => path.resolve(root, p)) : [root];
/** @type {string[]} */
const files = [];
for (const target of targets) {
  const relative = path.relative(root, target);
  if (relative.startsWith('..') || path.isAbsolute(relative)) fail(`${target} no está dentro de ${root}`);
  if (!existsSync(target)) fail(`No existe ${target}`);
  files.push(...(await listFiles(target)));
}
if (files.length === 0) fail('No hay nada que subir.');

console.log(`${dryRun ? 'Simulación: ' : ''}${files.length} archivos de ${root} → R2${canConnect ? ` (${bucket})` : ''}\n`);

let uploaded = 0;
let uploadedBytes = 0;
let unchanged = 0;
let failed = 0;

/** @param {string} file */
async function handle(file) {
  const key = objectKey(path.relative(root, file), opts.prefix);
  const { size } = await stat(file);
  const contentType = contentTypeFor(file);
  const digest = await md5(file);

  if (client && !opts.force) {
    try {
      const head = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
      const same =
        head.ContentLength === size &&
        etagMatches(head.ETag, digest.toString('hex')) &&
        head.ContentType === contentType &&
        head.CacheControl === CACHE_IMMUTABLE;
      if (same) {
        unchanged++;
        console.log(`  = ${key}`);
        return;
      }
    } catch (error) {
      if (!isNotFound(error)) throw error;
    }
  }

  if (dryRun || !client) {
    uploaded++;
    uploadedBytes += size;
    console.log(`  ↑ ${key} (${formatBytes(size)}, ${contentType}) [simulación]`);
    return;
  }

  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: createReadStream(file),
      ContentLength: size,
      ContentType: contentType,
      CacheControl: CACHE_IMMUTABLE,
      // R2 comprueba que llega entero.
      ContentMD5: digest.toString('base64'),
    }),
  );
  uploaded++;
  uploadedBytes += size;
  console.log(`  ↑ ${key} (${formatBytes(size)})`);
}

// Cola con `concurrency` subidas a la vez.
const queue = [...files];
await Promise.all(
  Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
    for (let file = queue.shift(); file; file = queue.shift()) {
      try {
        await handle(file);
      } catch (error) {
        failed++;
        console.error(`  ✗ ${path.relative(root, file)}: ${/** @type {Error} */ (error).message}`);
      }
    }
  }),
);

console.log(
  `\n${dryRun ? 'Se subirían' : 'Subidos'}: ${uploaded} (${formatBytes(uploadedBytes)}) · sin cambios: ${unchanged}` +
    (failed ? ` · con error: ${failed}` : ''),
);

const masters = files.filter((f) => path.basename(f) === 'master.m3u8');
if (PUBLIC_MEDIA_BASE_URL && masters.length > 0) {
  const base = PUBLIC_MEDIA_BASE_URL.replace(/\/+$/, '');
  console.log('\nURLs públicas:');
  for (const m of masters) console.log(`  ${base}/${objectKey(path.relative(root, m), opts.prefix)}`);
}
if (failed) process.exit(1);
