#!/usr/bin/env node
// @ts-check
/**
 * Pipeline de vídeo para Media (prompt maestro §5 · C15): convierte un vídeo en
 * HLS listo para subir a R2.
 *
 * Uso (desde Portfolio/):
 *   node scripts/video-to-hls.mjs "<vídeo>" --slug <nombre> [opciones]
 *
 * Por cada proporción (por defecto 4:5 para escritorio y 9:16 para móvil) genera:
 *   <salida>/video/<slug>-<hash>/<4x5|9x16>/
 *     master.m3u8           lista maestra (la que usa la web)
 *     <1080p|720p|…>/       un peldaño por calidad: index.m3u8, init.mp4, seg_000.m4s…
 *     fallback.mp4          respaldo en 720p con +faststart
 *     poster.jpg, poster.avif
 *   <salida>/video/<slug>-<hash>/info.json   resumen (tamaños, bitrates, códecs)
 *
 * - Siempre H.264 (High) + AAC: varios originales son HEVC y no todos los
 *   navegadores lo reproducen. Segmentos fMP4 de 4 s, lista VOD.
 * - Nunca amplía: si el original es pequeño, solo salen los peldaños que caben
 *   (más uno con su tamaño real).
 * - Si el original es HDR (HLG/PQ, típico de los iPhone), lo pasa a SDR.
 * - El hash (del archivo y de las opciones) va en el nombre de la carpeta: si
 *   se regenera con otro corte, cambia la carpeta y la caché inmutable de R2
 *   nunca sirve una versión vieja. Si la carpeta ya existe, no hace nada.
 * - Comprueba la salida con ffprobe y, al final, imprime el bloque para
 *   `src/config/media.ts`.
 *
 * Necesita ffmpeg y ffprobe en el PATH (Windows: `winget install Gyan.FFmpeg`)
 * o en las variables FFMPEG_PATH y FFPROBE_PATH.
 * Después: `node scripts/upload-to-r2.mjs` sube la carpeta de salida a R2.
 */
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream, existsSync } from 'node:fs';
import { mkdir, open, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import {
  DEFAULT_LADDER,
  FALLBACK_SHORT_SIDE,
  SEGMENT_SECONDS,
  audioCodecString,
  av1CodecString,
  avcCodecString,
  buildLadder,
  buildMasterPlaylist,
  computeCrop,
  formatBytes,
  isFastStart,
  masterOrder,
  maxBitrateKbps,
  parseAspect,
  parseMediaPlaylist,
  parseRate,
  playlistBandwidth,
  rungName,
  rungSize,
  shortSide,
  versionedFolder,
} from './lib/video.mjs';

/** Sube este número si cambia la forma de codificar: así cambia el hash y la carpeta. */
const PIPELINE_VERSION = 2;

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FFMPEG = process.env.FFMPEG_PATH || 'ffmpeg';
const FFPROBE = process.env.FFPROBE_PATH || 'ffprobe';

const HELP = `Uso: node scripts/video-to-hls.mjs "<vídeo>" --slug <nombre> [opciones]

  --slug <nombre>        nombre de la carpeta (minúsculas, números y guiones), p. ej. cuki-insulto
  --aspect 4:5,9:16      proporciones de salida, la primera para escritorio y la segunda
                         para pantallas estrechas; «source» = sin recortar
  --focus-x 0.5          encuadre del recorte en horizontal (0 izquierda · 0.5 centro · 1 derecha)
  --focus-y 0.5          encuadre del recorte en vertical (0 arriba · 0.5 centro · 1 abajo)
  --start <s>            inicio del fragmento, en segundos (por defecto, 0)
  --duration <s>         duración del fragmento, en segundos (por defecto, hasta el final)
  --no-audio             quita la pista de audio (vídeo solo visual)
  --poster-at <s>        segundo del fragmento que se usa como póster (por defecto, 0)
  --ladder 1080,720,480  lados cortos de la escalera de calidades
  --max-fps 30           fotogramas por segundo como máximo
  --out <carpeta>        carpeta de salida (por defecto, .media/, que está en .gitignore)
  --codec h264           h264 (la web). «av1» solo para los tests e2e: el Chromium de
                         Playwright no trae H.264 ni AAC
  --no-hash              carpeta sin hash (solo para los fixtures de los tests)
  --force                vuelve a generar aunque la carpeta ya exista
  --quiet                menos mensajes`;

const { values: opts, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    slug: { type: 'string' },
    aspect: { type: 'string', default: '4:5,9:16' },
    'focus-x': { type: 'string', default: '0.5' },
    'focus-y': { type: 'string', default: '0.5' },
    start: { type: 'string', default: '0' },
    duration: { type: 'string' },
    'no-audio': { type: 'boolean', default: false },
    'poster-at': { type: 'string', default: '0' },
    ladder: { type: 'string', default: DEFAULT_LADDER.join(',') },
    'max-fps': { type: 'string', default: '30' },
    out: { type: 'string' },
    codec: { type: 'string', default: 'h264' },
    'no-hash': { type: 'boolean', default: false },
    force: { type: 'boolean', default: false },
    quiet: { type: 'boolean', default: false },
    help: { type: 'boolean', short: 'h', default: false },
  },
});

if (opts.help || positionals.length === 0) {
  console.log(HELP);
  process.exit(opts.help ? 0 : 1);
}

/**
 * @param {string} message
 * @returns {never}
 */
function fail(message) {
  console.error(`\n✗ ${message}`);
  process.exit(1);
}

/** @param {string} message */
function log(message) {
  if (!opts.quiet) console.log(message);
}

/**
 * @param {string | undefined} value
 * @param {string} name
 * @param {{ min?: number, max?: number }} [range]
 */
function numberOption(value, name, range = {}) {
  const n = Number(value);
  if (value === undefined || value.trim() === '' || !Number.isFinite(n)) fail(`--${name} tiene que ser un número`);
  if (range.min !== undefined && n < range.min) fail(`--${name} tiene que ser ≥ ${range.min}`);
  if (range.max !== undefined && n > range.max) fail(`--${name} tiene que ser ≤ ${range.max}`);
  return n;
}

// --- Opciones -----------------------------------------------------------------

const input = path.resolve(/** @type {string} */ (positionals[0]));
if (!existsSync(input)) fail(`No existe el vídeo: ${input}`);
const slug = opts.slug ?? '';
if (!slug) fail('Falta --slug (p. ej. --slug cuki-insulto)');

const codec = opts.codec === 'av1' ? 'av1' : opts.codec === 'h264' ? 'h264' : fail('--codec: h264 o av1');
const aspects = /** @type {string} */ (opts.aspect)
  .split(',')
  .filter((a) => a.trim())
  .map((a) => {
    try {
      return parseAspect(a);
    } catch (error) {
      return fail(/** @type {Error} */ (error).message);
    }
  });
if (aspects.length === 0) fail('--aspect vacío');
const labels = aspects.map((a) => a.label);
if (new Set(labels).size !== labels.length) fail('--aspect repetido');

const focusX = numberOption(opts['focus-x'], 'focus-x', { min: 0, max: 1 });
const focusY = numberOption(opts['focus-y'], 'focus-y', { min: 0, max: 1 });
const start = numberOption(opts.start, 'start', { min: 0 });
const requestedDuration = opts.duration === undefined ? null : numberOption(opts.duration, 'duration', { min: 0.5 });
const posterAt = numberOption(opts['poster-at'], 'poster-at', { min: 0 });
const maxFps = numberOption(opts['max-fps'], 'max-fps', { min: 1, max: 120 });
const ladder = /** @type {string} */ (opts.ladder).split(',').map((s) => numberOption(s, 'ladder', { min: 64 }));
const keepAudio = !opts['no-audio'];
const outRoot = opts.out ? path.resolve(opts.out) : path.join(ROOT, '.media');

// --- Utilidades -----------------------------------------------------------------

/**
 * Ejecuta un comando y devuelve su salida. Si falla, muestra el final de stderr.
 * @param {string} command
 * @param {string[]} args
 * @param {{ onStdoutLine?: (line: string) => void }} [options]
 * @returns {Promise<{ stdout: string, stderr: string }>}
 */
function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let stdout = '';
    let stderr = '';
    let pending = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
      if (!options.onStdoutLine) return;
      pending += chunk;
      const lines = pending.split(/\r?\n/);
      pending = lines.pop() ?? '';
      for (const line of lines) options.onStdoutLine(line);
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', (error) => {
      const code = /** @type {NodeJS.ErrnoException} */ (error).code;
      reject(
        code === 'ENOENT'
          ? new Error(
              `No se encuentra «${command}». Instala ffmpeg (Windows: winget install Gyan.FFmpeg) ` +
                'o indica la ruta con FFMPEG_PATH / FFPROBE_PATH.',
            )
          : error,
      );
    });
    child.on('close', (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`${path.basename(command)} terminó con código ${code}:\n${stderr.trim().split('\n').slice(-12).join('\n')}`));
    });
  });
}

/**
 * @param {string} file
 * @param {string} entries
 * @returns {Promise<any>}
 */
async function probe(file, entries) {
  const { stdout } = await run(FFPROBE, ['-v', 'error', '-show_entries', entries, '-of', 'json', file]);
  return JSON.parse(stdout);
}

/**
 * ffmpeg con barra de progreso (si `seconds` > 0 y no es --quiet).
 * @param {string[]} args
 * @param {string} label
 * @param {number} seconds  Duración que se va a codificar.
 */
async function ffmpeg(args, label, seconds) {
  const started = Date.now();
  let lastShown = -1;
  const interactive = !opts.quiet && process.stdout.isTTY;
  await run(FFMPEG, ['-hide_banner', '-v', 'error', '-nostdin', '-y', ...args.slice(0, -1), '-progress', 'pipe:1', '-nostats', ...args.slice(-1)], {
    onStdoutLine(line) {
      if (!interactive || seconds <= 0 || !line.startsWith('out_time_us=')) return;
      const done = Number(line.slice(12)) / 1e6;
      const pct = Math.min(100, Math.floor((done / seconds) * 100));
      if (pct !== lastShown && pct % 5 === 0) {
        lastShown = pct;
        process.stdout.write(`\r  ${label} ${String(pct).padStart(3)} %`);
      }
    },
  });
  const took = ((Date.now() - started) / 1000).toLocaleString('es-ES', { maximumFractionDigits: 1 });
  if (interactive) process.stdout.write(`\r  ${label} ✓ (${took} s)          \n`);
  else log(`  ${label} ✓ (${took} s)`);
}

/** @param {string} file */
async function sha256(file) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash;
}

/**
 * Cajas de primer nivel de un MP4 (para comprobar el +faststart).
 * @param {string} file
 */
async function topLevelBoxes(file) {
  const handle = await open(file, 'r');
  try {
    const { size } = await handle.stat();
    /** @type {string[]} */
    const types = [];
    const header = Buffer.alloc(16);
    let offset = 0;
    while (offset + 8 <= size && types.length < 64) {
      await handle.read(header, 0, 16, offset);
      let boxSize = header.readUInt32BE(0);
      const type = header.toString('latin1', 4, 8);
      if (boxSize === 1) boxSize = Number(header.readBigUInt64BE(8));
      else if (boxSize === 0) boxSize = size - offset;
      if (boxSize < 8) break;
      types.push(type);
      offset += boxSize;
    }
    return types;
  } finally {
    await handle.close();
  }
}

/** @param {string} dir */
async function folderBytes(dir) {
  let total = 0;
  for (const entry of await readdir(dir, { withFileTypes: true, recursive: true })) {
    if (entry.isFile()) total += (await stat(path.join(entry.parentPath, entry.name))).size;
  }
  return total;
}

/** @param {number} n */
const kbps = (n) => `${Math.round(n / 1000).toLocaleString('es-ES')} kbps`;

// --- Herramientas disponibles ----------------------------------------------------

const [ffmpegVersion, encoders, filters] = await Promise.all([
  run(FFMPEG, ['-hide_banner', '-version']).then((r) => /^ffmpeg version \S+/.exec(r.stdout)?.[0] ?? 'ffmpeg'),
  run(FFMPEG, ['-hide_banner', '-encoders']).then((r) => r.stdout),
  run(FFMPEG, ['-hide_banner', '-filters']).then((r) => r.stdout),
]).catch((error) => fail(/** @type {Error} */ (error).message));
/** @param {string} name */
const hasEncoder = (name) => new RegExp(`^\\s*\\S+\\s+${name}\\s`, 'm').test(encoders);
const hasZscale = /^\s*\S+\s+zscale\s/m.test(filters);

if (codec === 'h264' && !hasEncoder('libx264')) fail('Este ffmpeg no tiene libx264.');
const av1Encoder = hasEncoder('libsvtav1') ? 'libsvtav1' : hasEncoder('libaom-av1') ? 'libaom-av1' : null;
if (codec === 'av1' && !av1Encoder) fail('Este ffmpeg no tiene codificador AV1 (libsvtav1 o libaom-av1).');
if (codec === 'av1' && !hasEncoder('libopus')) fail('Este ffmpeg no tiene libopus.');

// --- Original ---------------------------------------------------------------------

const info = await probe(
  input,
  'stream=index,codec_type,codec_name,profile,width,height,avg_frame_rate,r_frame_rate,pix_fmt,color_transfer:stream_side_data=rotation:stream_tags=rotate:format=duration',
).catch((error) => fail(/** @type {Error} */ (error).message));

/** @type {any[]} */
const streams = info.streams ?? [];
const videoStream = streams.find((s) => s.codec_type === 'video');
if (!videoStream) fail('El archivo no tiene pista de vídeo.');
const hasAudio = streams.some((s) => s.codec_type === 'audio');
const withAudio = keepAudio && hasAudio;
if (keepAudio && !hasAudio) log('· El original no tiene audio: el vídeo sale sin sonido.');

const rotation = Number(
  videoStream.side_data_list?.find((/** @type {any} */ d) => 'rotation' in d)?.rotation ?? videoStream.tags?.rotate ?? 0,
);
const turned = Math.abs(rotation) % 180 === 90;
const source = turned
  ? { width: Number(videoStream.height), height: Number(videoStream.width) }
  : { width: Number(videoStream.width), height: Number(videoStream.height) };
const sourceFps = parseRate(videoStream.avg_frame_rate) || parseRate(videoStream.r_frame_rate) || 30;
const sourceDuration = Number(info.format?.duration ?? 0);
if (!(sourceDuration > 0)) fail('No se puede leer la duración del vídeo.');
if (start >= sourceDuration) fail(`--start (${start} s) está después del final (${sourceDuration.toFixed(1)} s).`);
const duration = Math.min(requestedDuration ?? Infinity, sourceDuration - start);
if (posterAt >= duration) fail(`--poster-at (${posterAt} s) está fuera del fragmento (${duration.toFixed(1)} s).`);

const hdr = ['smpte2084', 'arib-std-b67'].includes(videoStream.color_transfer);
if (hdr && !hasZscale) log('⚠ El original es HDR y este ffmpeg no tiene «zscale»: los colores pueden salir lavados.');

// fps de salida: el del original, con un máximo (los móviles graban a 60).
const fps = sourceFps > maxFps + 0.01 ? maxFps : sourceFps;
const fpsExpr = fps === sourceFps && videoStream.avg_frame_rate?.includes('/') ? videoStream.avg_frame_rate : String(fps);
const gop = Math.max(1, Math.round(fps * SEGMENT_SECONDS));

// --- Carpeta de salida (con hash) --------------------------------------------------

// Otra versión de ffmpeg puede dar bytes distintos: también cambia la carpeta,
// para no mezclar en R2 segmentos de dos codificaciones.
const optionsForHash = {
  v: PIPELINE_VERSION,
  ffmpeg: ffmpegVersion,
  aspects: labels,
  focusX,
  focusY,
  start,
  duration: requestedDuration,
  audio: withAudio,
  posterAt,
  ladder,
  maxFps,
  codec,
};
const hash = opts['no-hash'] ? null : (await sha256(input)).update(JSON.stringify(optionsForHash)).digest('hex');
let folder = '';
try {
  folder = versionedFolder(slug, hash);
} catch (error) {
  fail(/** @type {Error} */ (error).message);
}
const outDir = path.join(outRoot, 'video', folder);
const infoFile = path.join(outDir, 'info.json');

if (existsSync(infoFile) && !opts.force) {
  log(`· Ya existe ${path.relative(process.cwd(), outDir) || outDir} (mismo original y mismas opciones). Usa --force para regenerarlo.`);
  const previous = JSON.parse(await readFile(infoFile, 'utf8'));
  log(configSnippet(previous));
  process.exit(0);
}
await rm(outDir, { recursive: true, force: true });
await mkdir(outDir, { recursive: true });

log(`\nOriginal: ${path.basename(input)}`);
log(
  `  ${source.width}×${source.height}${turned ? ' (girado)' : ''} · ${sourceFps.toFixed(2)} fps · ${sourceDuration.toFixed(1)} s · ` +
    `${videoStream.codec_name}${hdr ? ' HDR' : ''}${hasAudio ? ' + audio' : ''}`,
);
log(`  Fragmento: ${start} s → ${(start + duration).toFixed(1)} s (${duration.toFixed(1)} s) · salida a ${fps.toFixed(2)} fps`);
log(`  Carpeta: ${outDir}\n`);

// --- Filtros y códecs ----------------------------------------------------------------

/**
 * @param {import('./lib/video.mjs').Crop} crop
 * @param {import('./lib/video.mjs').Size} size
 * @param {{ withFps?: boolean }} [options]
 */
function videoFilter(crop, size, { withFps = true } = {}) {
  const chain = [];
  if (hdr && hasZscale) {
    chain.push(
      'zscale=t=linear:npl=100',
      'format=gbrpf32le',
      'zscale=p=bt709',
      'tonemap=tonemap=hable:desat=0',
      'zscale=t=bt709:m=bt709:r=tv',
    );
  }
  if (crop.width !== source.width || crop.height !== source.height) {
    chain.push(`crop=${crop.width}:${crop.height}:${crop.x}:${crop.y}`);
  }
  if (size.width !== crop.width || size.height !== crop.height) {
    chain.push(`scale=${size.width}:${size.height}:flags=lanczos`);
  }
  if (withFps) chain.push(`fps=${fpsExpr}`);
  chain.push('format=yuv420p', 'setsar=1');
  return chain.join(',');
}

/**
 * @param {number} maxKbps
 * @param {'hls' | 'mp4'} target
 */
function videoCodecArgs(maxKbps, target) {
  const common = ['-g', String(gop), '-keyint_min', String(gop)];
  if (codec === 'av1') {
    const crf = target === 'hls' ? '38' : '40';
    return av1Encoder === 'libsvtav1'
      ? ['-c:v', 'libsvtav1', '-preset', '10', '-crf', crf, ...common]
      : ['-c:v', 'libaom-av1', '-cpu-used', '8', '-row-mt', '1', '-crf', crf, '-b:v', '0', ...common];
  }
  return [
    '-c:v', 'libx264',
    '-preset', 'slow',
    '-profile:v', 'high',
    '-crf', target === 'hls' ? '21' : '22',
    '-maxrate', `${maxKbps}k`,
    '-bufsize', `${maxKbps * 2}k`,
    ...common,
    '-sc_threshold', '0',
    '-force_key_frames', `expr:gte(t,n_forced*${SEGMENT_SECONDS})`,
    '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709',
  ];
}

function audioArgs() {
  if (!withAudio) return ['-an'];
  return codec === 'av1'
    ? ['-map', '0:a:0', '-c:a', 'libopus', '-b:a', '96k', '-ac', '2', '-ar', '48000']
    : ['-map', '0:a:0', '-c:a', 'aac', '-b:a', '128k', '-ac', '2'];
}

const trimArgs = ['-ss', String(start), '-t', String(duration)];

/**
 * CODECS de un peldaño, a partir de su propia salida.
 * @param {string} playlist
 */
async function codecsOf(playlist) {
  const data = await probe(playlist, 'stream=codec_type,codec_name,profile,level,width,height,avg_frame_rate:format=duration');
  /** @type {any[]} */
  const list = data.streams ?? [];
  const v = list.find((s) => s.codec_type === 'video');
  const a = list.find((s) => s.codec_type === 'audio');
  if (!v) throw new Error(`Sin vídeo en ${playlist}`);
  const videoCodecs =
    v.codec_name === 'h264' ? avcCodecString(v.profile, Number(v.level)) : av1CodecString(v.profile ?? 'Main', Number(v.level));
  const codecs = a ? `${videoCodecs},${audioCodecString(a.codec_name, a.profile)}` : videoCodecs;
  return { codecs, video: v, audio: a ?? null, duration: Number(data.format?.duration ?? 0) };
}

// --- Codificación --------------------------------------------------------------------

/** @type {string[]} */
const problems = [];
/** @param {boolean} ok @param {string} message */
function check(ok, message) {
  if (!ok) problems.push(message);
}

/** @type {Record<string, any>} */
const variants = {};

for (const aspect of aspects) {
  const crop = computeCrop(source, aspect.ratio, focusX, focusY);
  const shorts = buildLadder(shortSide(crop), ladder);
  const aspectDir = path.join(outDir, aspect.label);
  await mkdir(aspectDir, { recursive: true });
  log(`${aspect.label}: recorte ${crop.width}×${crop.height} (+${crop.x}+${crop.y}) · peldaños ${shorts.map(rungName).join(', ')}`);

  /** @type {any[]} */
  const rungs = [];
  for (const short of shorts) {
    const size = rungSize(crop, short);
    const name = rungName(short);
    const rungDir = path.join(aspectDir, name);
    await mkdir(rungDir, { recursive: true });
    const maxKbps = maxBitrateKbps(short);
    await ffmpeg(
      [
        ...trimArgs,
        '-i', input,
        '-map', '0:v:0',
        '-vf', videoFilter(crop, size),
        ...videoCodecArgs(maxKbps, 'hls'),
        ...audioArgs(),
        '-f', 'hls',
        '-hls_time', String(SEGMENT_SECONDS),
        '-hls_playlist_type', 'vod',
        '-hls_segment_type', 'fmp4',
        '-hls_fmp4_init_filename', 'init.mp4',
        '-hls_flags', 'independent_segments',
        '-hls_segment_filename', path.join(rungDir, 'seg_%03d.m4s'),
        path.join(rungDir, 'index.m3u8'),
      ],
      `${aspect.label} · ${name} ${size.width}×${size.height}`.padEnd(28),
      duration,
    );

    const playlistFile = path.join(rungDir, 'index.m3u8');
    const playlist = parseMediaPlaylist(await readFile(playlistFile, 'utf8'));
    const segments = await Promise.all(
      playlist.segments.map(async (s) => ({ duration: s.duration, bytes: (await stat(path.join(rungDir, s.uri))).size })),
    );
    const { bandwidth, averageBandwidth } = playlistBandwidth(segments);
    const probed = await codecsOf(playlistFile);

    // Comprobaciones con ffprobe.
    check(probed.video.codec_name === (codec === 'av1' ? 'av1' : 'h264'), `${aspect.label}/${name}: códec ${probed.video.codec_name}`);
    check(
      Number(probed.video.width) === size.width && Number(probed.video.height) === size.height,
      `${aspect.label}/${name}: mide ${probed.video.width}×${probed.video.height} y debería medir ${size.width}×${size.height}`,
    );
    check(Math.abs(probed.duration - duration) < 0.3, `${aspect.label}/${name}: dura ${probed.duration} s (esperado ${duration.toFixed(2)} s)`);
    check(Boolean(probed.audio) === withAudio, `${aspect.label}/${name}: ${probed.audio ? 'tiene' : 'no tiene'} audio`);
    check(playlist.endList && playlist.map === 'init.mp4', `${aspect.label}/${name}: lista incompleta`);
    check(
      playlist.segments.every((s) => s.duration <= SEGMENT_SECONDS + 0.05),
      `${aspect.label}/${name}: hay segmentos de más de ${SEGMENT_SECONDS} s`,
    );

    rungs.push({
      name,
      short,
      width: size.width,
      height: size.height,
      codecs: probed.codecs,
      bandwidth,
      averageBandwidth,
      segments: segments.length,
      bytes: segments.reduce((sum, s) => sum + s.bytes, 0) + (await stat(path.join(rungDir, 'init.mp4'))).size,
    });
  }

  // Lista maestra.
  const ordered = masterOrder(rungs.map((r) => r.short)).map((short) => rungs.find((r) => r.short === short));
  const master = buildMasterPlaylist(
    ordered.map((r) => ({
      uri: `${r.name}/index.m3u8`,
      bandwidth: r.bandwidth,
      averageBandwidth: r.averageBandwidth,
      width: r.width,
      height: r.height,
      frameRate: fps,
      codecs: r.codecs,
    })),
  );
  const masterFile = path.join(aspectDir, 'master.m3u8');
  await writeFile(masterFile, master);
  const masterProbe = await probe(masterFile, 'program=program_id:stream=codec_type,width,height');
  const programs = /** @type {any[]} */ (masterProbe.programs ?? []);
  check(programs.length === rungs.length, `${aspect.label}: el master.m3u8 tiene ${programs.length} variantes y deberían ser ${rungs.length}`);

  // MP4 de respaldo (720p o el tamaño real, si es menor).
  const fallbackSize = rungSize(crop, Math.min(FALLBACK_SHORT_SIDE, shortSide(crop)));
  const fallbackFile = path.join(aspectDir, 'fallback.mp4');
  await ffmpeg(
    [
      ...trimArgs,
      '-i', input,
      '-map', '0:v:0',
      '-vf', videoFilter(crop, fallbackSize),
      ...videoCodecArgs(maxBitrateKbps(shortSide(fallbackSize)), 'mp4'),
      ...audioArgs(),
      '-movflags', '+faststart',
      fallbackFile,
    ],
    `${aspect.label} · respaldo ${fallbackSize.width}×${fallbackSize.height}`.padEnd(28),
    duration,
  );
  const fallbackProbe = await codecsOf(fallbackFile);
  check(isFastStart(await topLevelBoxes(fallbackFile)), `${aspect.label}: fallback.mp4 sin +faststart`);
  check(Boolean(fallbackProbe.audio) === withAudio, `${aspect.label}: fallback.mp4 ${fallbackProbe.audio ? 'tiene' : 'no tiene'} audio`);
  check(Math.abs(fallbackProbe.duration - duration) < 0.3, `${aspect.label}: fallback.mp4 dura ${fallbackProbe.duration} s`);

  // Pósters: el fotograma de --poster-at, al tamaño del peldaño mayor.
  const top = /** @type {any} */ (rungs[0]);
  const posterSize = { width: top.width, height: top.height };
  const posterInput = ['-ss', String(start + posterAt), '-i', input, '-frames:v', '1', '-map', '0:v:0'];
  const posterJpg = path.join(aspectDir, 'poster.jpg');
  await ffmpeg(
    [...posterInput, '-vf', videoFilter(crop, posterSize, { withFps: false }).replace('format=yuv420p', 'format=yuvj420p'), '-q:v', '3', '-update', '1', posterJpg],
    `${aspect.label} · póster JPG`.padEnd(28),
    0,
  );
  const posterAvifEncoder = hasEncoder('libaom-av1') ? 'libaom-av1' : hasEncoder('libsvtav1') ? 'libsvtav1' : null;
  let posterAvif = /** @type {string | null} */ (null);
  if (posterAvifEncoder) {
    posterAvif = path.join(aspectDir, 'poster.avif');
    await ffmpeg(
      [
        ...posterInput,
        '-vf', videoFilter(crop, posterSize, { withFps: false }),
        ...(posterAvifEncoder === 'libaom-av1'
          ? ['-c:v', 'libaom-av1', '-still-picture', '1', '-crf', '30', '-b:v', '0', '-cpu-used', '6']
          : ['-c:v', 'libsvtav1', '-crf', '32', '-preset', '6']),
        '-f', 'avif',
        posterAvif,
      ],
      `${aspect.label} · póster AVIF`.padEnd(28),
      0,
    );
  } else {
    log('⚠ Sin codificador AV1: solo se genera el póster JPG.');
  }
  const posterProbe = await probe(posterJpg, 'stream=width,height');
  check(
    posterProbe.streams?.[0]?.width === posterSize.width && posterProbe.streams?.[0]?.height === posterSize.height,
    `${aspect.label}: el póster no mide ${posterSize.width}×${posterSize.height}`,
  );

  variants[aspect.label] = {
    width: crop.width,
    height: crop.height,
    crop,
    rungs,
    fallback: { ...fallbackSize, bytes: (await stat(fallbackFile)).size },
    poster: {
      ...posterSize,
      jpgBytes: (await stat(posterJpg)).size,
      avifBytes: posterAvif ? (await stat(posterAvif)).size : null,
    },
  };
  log('');
}

// --- Resumen ------------------------------------------------------------------------

const summary = {
  slug,
  folder: `video/${folder}`,
  codec,
  createdAt: new Date().toISOString(),
  source: {
    file: path.basename(input),
    width: source.width,
    height: source.height,
    fps: Number(sourceFps.toFixed(3)),
    duration: Number(sourceDuration.toFixed(3)),
    hdr,
    audio: hasAudio,
  },
  options: { ...optionsForHash, v: undefined, ffmpeg: undefined, duration: Number(duration.toFixed(3)) },
  ffmpeg: ffmpegVersion,
  fps: Number(fps.toFixed(3)),
  audio: withAudio,
  aspects: labels,
  variants,
  totalBytes: 0,
};
await writeFile(infoFile, `${JSON.stringify(summary, null, 2)}\n`);
summary.totalBytes = await folderBytes(outDir);
await writeFile(infoFile, `${JSON.stringify(summary, null, 2)}\n`);

for (const label of labels) {
  const v = variants[label];
  log(`${label}`);
  for (const r of v.rungs) {
    log(`  ${r.name.padEnd(6)} ${`${r.width}×${r.height}`.padEnd(10)} media ${kbps(r.averageBandwidth).padStart(10)} · pico ${kbps(r.bandwidth).padStart(10)} · ${formatBytes(r.bytes)}`);
  }
  log(`  respaldo ${v.fallback.width}×${v.fallback.height} · ${formatBytes(v.fallback.bytes)} · póster ${formatBytes(v.poster.jpgBytes)} (JPG)${v.poster.avifBytes ? ` / ${formatBytes(v.poster.avifBytes)} (AVIF)` : ''}`);
}
log(`\nPeso total: ${formatBytes(summary.totalBytes)} en ${outDir}`);

if (problems.length > 0) {
  console.error(`\n✗ La comprobación con ffprobe ha encontrado problemas:\n  - ${problems.join('\n  - ')}`);
  process.exit(1);
}
log('✓ Comprobado con ffprobe: códecs, tamaños, duración, audio, segmentos, listas y +faststart.');
log(configSnippet(summary));

/**
 * Bloque para `src/config/media.ts`.
 * @param {any} s  Resumen (info.json).
 */
function configSnippet(s) {
  /**
   * @param {string} label
   * @param {string} indent
   */
  const rendition = (label, indent) => {
    const v = s.variants[label];
    const base = `${s.folder}/${label}`;
    const avif = v.poster.avifBytes ? `, avif: '${base}/poster.avif'` : '';
    return [
      `hls: '${base}/master.m3u8',`,
      `mp4: '${base}/fallback.mp4',`,
      `poster: { jpg: '${base}/poster.jpg'${avif} },`,
      `width: ${v.width},`,
      `height: ${v.height},`,
    ]
      .map((line) => `${indent}${line}`)
      .join('\n');
  };
  const [first, second] = /** @type {string[]} */ (s.aspects);
  const lines = [`  slug: '${s.slug}',`, `  audio: ${s.audio},`, rendition(/** @type {string} */ (first), '  ')];
  if (second) lines.push('  mobile: {', rendition(second, '    '), '  },');
  return `\nSiguiente paso: sube la carpeta a R2 (node scripts/upload-to-r2.mjs) y copia esto en src/config/media.ts:\n\n${lines.join('\n')}\n`;
}
