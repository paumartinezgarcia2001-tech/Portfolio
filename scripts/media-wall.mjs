#!/usr/bin/env node
// @ts-check
/**
 * Prepara una pieza del muro de Media (`<media-wall>`, D65) a partir de un vídeo
 * o una imagen, lista para subir a R2.
 *
 * Uso (desde Portfolio/):
 *   node scripts/media-wall.mjs "<archivo>" --slug <nombre> --title "…" [opciones]
 *
 * Genera en `<salida>/wall/<slug>-<hash>/`:
 *   still.jpg, still.avif   imagen de la pieza (y póster del vídeo), 720 px de ancho
 *   loop.mp4                si es vídeo: bucle mudo en H.264 (todos los navegadores)
 *   loop-av1.mp4            si es vídeo: el mismo bucle en AV1 (más ligero; Chrome,
 *                           Firefox, Edge y Safari con AV1 por hardware lo prefieren)
 *
 * - El muro es mudo (la banda sonora de Media es el reproductor de mixes): los
 *   bucles no llevan audio.
 * - Con `--image` se saca solo la imagen (de una foto, o de un fotograma del
 *   vídeo con `--still-at`): así un mismo vídeo da también «fotos» al muro.
 * - Las piezas son pequeñas en pantalla (un carril del muro): 480 px de ancho
 *   bastan para el bucle, incluso en pantallas de alta densidad.
 * - El hash (del archivo y de las opciones) va en el nombre de la carpeta, como en
 *   `video-to-hls.mjs`: R2 puede cachear todo como inmutable.
 * - Al terminar imprime la entrada para `MEDIA_WALL.items` en
 *   `src/config/media-wall.ts`.
 *
 * Después: `npm run media:upload -- wall/<slug>-<hash>`.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { formatBytes, versionedFolder } from './lib/video.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FFMPEG = process.env.FFMPEG_PATH || 'ffmpeg';
const FFPROBE = process.env.FFPROBE_PATH || 'ffprobe';
/** Súbelo si cambia la receta: cambia el hash de todas las carpetas. */
const RECIPE_VERSION = 1;

const FILTERS = ['pixel', 'duotone', 'dither', 'rgb', 'halftone', 'scan'];

const { values: opts, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    slug: { type: 'string' },
    title: { type: 'string' },
    caption: { type: 'string' },
    image: { type: 'boolean', default: false },
    start: { type: 'string', default: '0' },
    duration: { type: 'string', default: '6' },
    'still-at': { type: 'string' },
    width: { type: 'string', default: '480' },
    'still-width': { type: 'string', default: '720' },
    filter: { type: 'string' },
    'focus-x': { type: 'string', default: '0.5' },
    'focus-y': { type: 'string', default: '0.5' },
    out: { type: 'string' },
    'no-hash': { type: 'boolean', default: false },
    'no-av1': { type: 'boolean', default: false },
    force: { type: 'boolean', default: false },
    quiet: { type: 'boolean', default: false },
    help: { type: 'boolean', short: 'h', default: false },
  },
});

const HELP = `Uso: node scripts/media-wall.mjs "<archivo>" --slug <nombre> --title "…" [opciones]

  --title "…"        nombre de la pieza (lo leen los lectores de pantalla)
  --caption "…"      rótulo corto bajo la pieza (por defecto, el título)
  --image            solo imagen (foto, o un fotograma del vídeo con --still-at)
  --start <s>        inicio del bucle (vídeo), por defecto 0
  --duration <s>     duración del bucle, por defecto 6
  --still-at <s>     segundo del fotograma para la imagen (por defecto, la mitad del bucle)
  --width <px>       ancho del bucle, por defecto 480
  --still-width <px> ancho de la imagen, por defecto 720
  --filter <nombre>  filtro fijo (${FILTERS.join(', ')}); si no, el muro los reparte
  --focus-x/-y <0–1> punto que se mantiene a la vista si la pieza se recorta
  --out <carpeta>    salida, por defecto .media/
  --no-av1           sin la versión AV1
  --force            rehace la carpeta aunque exista`;

/**
 * @param {string} message
 * @returns {never}
 */
function fail(message) {
  console.error(`✗ ${message}`);
  process.exit(1);
}

/** @param {string} message */
function log(message) {
  if (!opts.quiet) console.log(message);
}

if (opts.help) {
  console.log(HELP);
  process.exit(0);
}

const input = positionals[0] ?? fail(`Falta el archivo.\n\n${HELP}`);
if (!existsSync(input)) fail(`No existe: ${input}`);
if (!opts.slug) fail('Falta --slug.');
if (!opts.title) fail('Falta --title.');
if (opts.filter && !FILTERS.includes(opts.filter)) fail(`Filtro desconocido: ${opts.filter} (${FILTERS.join(', ')})`);

const start = Number(opts.start);
const duration = Number(opts.duration);
const width = Number(opts.width);
const stillWidth = Number(opts['still-width']);
if (![start, duration, width, stillWidth].every(Number.isFinite) || duration <= 0 || width < 64 || stillWidth < 64) {
  fail('--start, --duration, --width y --still-width tienen que ser números válidos.');
}

/** @param {string} command @param {string[]} args */
function run(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (result.status !== 0) fail(`${path.basename(command)} ha fallado:\n${(result.stderr || '').trim().split('\n').slice(-6).join('\n')}`);
  return result.stdout;
}

/** @param {string} name */
function hasEncoder(name) {
  const result = spawnSync(FFMPEG, ['-hide_banner', '-encoders'], { encoding: 'utf8' });
  return result.status === 0 && new RegExp(`\\s${name}\\s`).test(result.stdout);
}

const probe = JSON.parse(
  run(FFPROBE, ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height,codec_type:format=duration', '-of', 'json', input]),
);
const stream = probe.streams?.[0];
if (!stream) fail('El archivo no tiene imagen.');
const sourceDuration = Number(probe.format?.duration);
const isStill = !Number.isFinite(sourceDuration) || sourceDuration < 0.5;
const kind = opts.image || isStill ? 'image' : 'video';
const wantedStill = opts['still-at'] !== undefined ? Number(opts['still-at']) : isStill ? 0 : start + Math.min(duration, sourceDuration - start) / 2;
// Nunca después del final del original (ffmpeg no daría ningún fotograma).
const stillAt = isStill ? 0 : Math.max(0, Math.min(wantedStill, sourceDuration - 0.1));

const settings = { RECIPE_VERSION, kind, start, duration, width, stillWidth, stillAt };
const hash = createHash('sha256').update(await readFile(input)).update(JSON.stringify(settings)).digest('hex');
const folder = versionedFolder(opts.slug, opts['no-hash'] ? null : hash);
const outRoot = opts.out ? path.resolve(opts.out) : path.join(ROOT, '.media');
const dir = path.join(outRoot, 'wall', folder);

if (existsSync(dir) && !opts.force) {
  log(`= ${path.relative(process.cwd(), dir)} ya existe (usa --force para rehacerla).`);
} else {
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });

  const common = ['-hide_banner', '-v', 'error', '-y'];
  const scale = (/** @type {number} */ w) => `scale=${w}:-2:flags=lanczos,format=yuv420p`;

  // Imagen (y póster del vídeo).
  const seek = isStill ? [] : ['-ss', String(stillAt)];
  run(FFMPEG, [...common, ...seek, '-i', input, '-frames:v', '1', '-vf', scale(stillWidth), '-q:v', '3', path.join(dir, 'still.jpg')]);
  if (!existsSync(path.join(dir, 'still.jpg')) && seek.length) {
    // Vídeos con muy pocos fotogramas: el primero.
    seek.length = 0;
    run(FFMPEG, [...common, '-i', input, '-frames:v', '1', '-vf', scale(stillWidth), '-q:v', '3', path.join(dir, 'still.jpg')]);
  }
  if (!existsSync(path.join(dir, 'still.jpg'))) fail(`No sale ningún fotograma en el segundo ${stillAt}.`);
  const avifEncoder = hasEncoder('libaom-av1') ? 'libaom-av1' : hasEncoder('libsvtav1') ? 'libsvtav1' : null;
  if (avifEncoder) {
    run(FFMPEG, [
      ...common, ...seek, '-i', input, '-frames:v', '1', '-vf', scale(stillWidth),
      ...(avifEncoder === 'libaom-av1'
        ? ['-c:v', 'libaom-av1', '-still-picture', '1', '-crf', '32', '-b:v', '0', '-cpu-used', '6']
        : ['-c:v', 'libsvtav1', '-crf', '34', '-preset', '6']),
      '-f', 'avif', path.join(dir, 'still.avif'),
    ]);
  }

  if (kind === 'video') {
    const cut = ['-ss', String(start), '-t', String(duration)];
    // Un fotograma clave cada segundo: el bucle vuelve al principio sin saltos.
    run(FFMPEG, [
      ...common, ...cut, '-i', input, '-an', '-vf', `${scale(width)},fps=30`,
      '-c:v', 'libx264', '-profile:v', 'main', '-preset', 'slow', '-crf', '27', '-g', '30',
      '-movflags', '+faststart', path.join(dir, 'loop.mp4'),
    ]);
    const av1 = opts['no-av1'] ? null : hasEncoder('libsvtav1') ? 'libsvtav1' : hasEncoder('libaom-av1') ? 'libaom-av1' : null;
    if (av1) {
      run(FFMPEG, [
        ...common, ...cut, '-i', input, '-an', '-vf', `${scale(width)},fps=30`,
        ...(av1 === 'libsvtav1'
          ? ['-c:v', 'libsvtav1', '-preset', '6', '-crf', '40', '-g', '30']
          : ['-c:v', 'libaom-av1', '-cpu-used', '6', '-row-mt', '1', '-crf', '40', '-b:v', '0', '-g', '30']),
        '-movflags', '+faststart', path.join(dir, 'loop-av1.mp4'),
      ]);
    }
  }
}

const still = JSON.parse(run(FFPROBE, ['-v', 'error', '-show_entries', 'stream=width,height', '-of', 'json', path.join(dir, 'still.jpg')])).streams[0];
const files = ['still.jpg', 'still.avif', 'loop.mp4', 'loop-av1.mp4'].filter((f) => existsSync(path.join(dir, f)));
for (const file of files) log(`  ${file.padEnd(14)} ${formatBytes((await stat(path.join(dir, file))).size)}`);

const base = `wall/${folder}`;
const lines = [
  '{',
  `  id: '${opts.slug}',`,
  `  kind: '${kind}',`,
  `  title: ${JSON.stringify(opts.title)},`,
  ...(opts.caption ? [`  caption: ${JSON.stringify(opts.caption)},`] : []),
  `  image: { jpg: '${base}/still.jpg'${files.includes('still.avif') ? `, avif: '${base}/still.avif'` : ''} },`,
  ...(kind === 'video'
    ? [`  video: { mp4: '${base}/loop.mp4'${files.includes('loop-av1.mp4') ? `, av1: '${base}/loop-av1.mp4'` : ''} },`]
    : []),
  `  width: ${still.width},`,
  `  height: ${still.height},`,
  ...(opts['focus-x'] !== '0.5' || opts['focus-y'] !== '0.5' ? [`  focusX: ${Number(opts['focus-x'])},`, `  focusY: ${Number(opts['focus-y'])},`] : []),
  ...(opts.filter ? [`  filter: '${opts.filter}',`] : []),
  '},',
];
log(`\n✓ ${path.relative(process.cwd(), dir)}\n\nPara src/config/media-wall.ts (MEDIA_WALL.items):\n`);
console.log(lines.join('\n'));
