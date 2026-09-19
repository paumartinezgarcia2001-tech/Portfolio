#!/usr/bin/env node
// @ts-check
/**
 * Añade un mix al reproductor (prompt maestro §7.5 y C06).
 *
 * Uso (desde Portfolio/):
 *   node scripts/add-mix.mjs "<audio>" --title "Título" [opciones]
 *   npm run media:mix -- "<audio>" --title "Título" [opciones]
 *
 * 1. Lee el audio con ffprobe.
 * 2. Lo deja en MP3 a 320 kbps CBR, a unos −14 LUFS (dos pasadas de
 *    loudnorm), sin las etiquetas ni la carátula del original y con título y
 *    artista: <salida>/mixes/<slug>-<hash>.mp3. El hash es del original y de
 *    las opciones, así que el archivo es inmutable en R2. Con --copy, si ya es
 *    MP3, no lo recodifica (solo cambia las etiquetas).
 * 3. Carátula opcional (--artwork): cuadrada, 1000 × 1000, en JPG, al lado.
 * 4. Si hay claves de R2 en .env, lo sube con scripts/upload-to-r2.mjs.
 * 5. Crea (o actualiza) la fila de `mixes`: con PUBLIC_SUPABASE_URL y
 *    SUPABASE_SECRET_KEY en .env, por la API; si no (o con --sql), escribe el
 *    SQL para el SQL Editor de Supabase o el MCP.
 *
 * La fila guarda la ruta dentro del bucket (`mixes/…`), no la URL completa: la
 * web le pone delante PUBLIC_MEDIA_BASE_URL (D46). Si se vuelve a ejecutar con
 * el mismo audio y las mismas opciones, no cambia nada.
 *
 * Necesita ffmpeg y ffprobe en el PATH (Windows: `winget install Gyan.FFmpeg`)
 * o en FFMPEG_PATH y FFPROBE_PATH.
 */
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import {
  ARTWORK_SIZE,
  LOUDNESS,
  MP3_BITRATE,
  buildMixUpsertSql,
  loudnormFilter,
  mixKey,
  parseLoudnorm,
  slugify,
  validateMixRow,
} from './lib/mixes.mjs';
import { formatBytes } from './lib/video.mjs';

/** Sube este número si cambia la forma de codificar: así cambia el hash y el archivo. */
const PIPELINE_VERSION = 1;
/** Artista de las etiquetas ID3 (el de la Media Session: src/config/player.ts). */
const ARTIST = 'travest15m0';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FFMPEG = process.env.FFMPEG_PATH || 'ffmpeg';
const FFPROBE = process.env.FFPROBE_PATH || 'ffprobe';

const HELP = `Uso: node scripts/add-mix.mjs "<audio>" --title "Título" [opciones]

  --title <texto>      título del mix (pantalla de bloqueo y lectores de pantalla)
  --subtitle <texto>   subtítulo opcional (p. ej., sala o fecha)
  --slug <nombre>      nombre del archivo (por defecto, sale del título)
  --artwork <imagen>   carátula; se recorta a un cuadrado de ${ARTWORK_SIZE} px
  --sort <n>           orden en la tabla (el reproductor baraja igualmente); por defecto, 0
  --draft              lo guarda sin publicar
  --copy               si ya es MP3, no lo recodifica ni ajusta el volumen
  --out <carpeta>      carpeta de salida (por defecto, .media/, en .gitignore)
  --sql <archivo>      escribe el SQL de la fila en vez de usar la API de Supabase
  --no-upload          no lo sube a R2 aunque haya claves en .env
  --force              vuelve a generar el MP3 aunque ya exista
  --quiet              menos mensajes`;

const { values: opts, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    title: { type: 'string' },
    subtitle: { type: 'string' },
    slug: { type: 'string' },
    artwork: { type: 'string' },
    sort: { type: 'string', default: '0' },
    draft: { type: 'boolean', default: false },
    copy: { type: 'boolean', default: false },
    out: { type: 'string' },
    sql: { type: 'string' },
    'no-upload': { type: 'boolean', default: false },
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

// `.env` del repo (Node ≥ 20.12). Las variables que ya estén definidas mandan.
const envFile = path.join(ROOT, '.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);

// --- Opciones -----------------------------------------------------------------

const input = path.resolve(/** @type {string} */ (positionals[0]));
if (!existsSync(input)) fail(`No existe el audio: ${input}`);
const title = opts.title?.trim() ?? '';
if (!title) fail('Falta --title (p. ej. --title "Insulto Club · 2026")');
const subtitle = opts.subtitle?.trim() || null;
const slug = opts.slug ?? slugify(title);
if (!slug) fail('No sale un nombre de archivo del título: usa --slug');
const sortOrder = Number(opts.sort);
if (!Number.isInteger(sortOrder)) fail('--sort tiene que ser un número entero');
const artwork = opts.artwork ? path.resolve(opts.artwork) : null;
if (artwork && !existsSync(artwork)) fail(`No existe la carátula: ${artwork}`);
const outRoot = opts.out ? path.resolve(opts.out) : path.join(ROOT, '.media');

// --- Utilidades -----------------------------------------------------------------

/**
 * Ejecuta un comando y devuelve su salida. Si falla, muestra el final de stderr.
 * @param {string} command
 * @param {string[]} args
 * @returns {Promise<{ stdout: string, stderr: string }>}
 */
function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => (stdout += chunk));
    child.stderr.on('data', (chunk) => (stderr += chunk));
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
 * @returns {Promise<{ duration: number, codec: string, sampleRate: number, bitRate: number }>}
 */
async function probeAudio(file) {
  const { stdout } = await run(FFPROBE, [
    '-v', 'error',
    '-show_entries', 'format=duration,bit_rate:stream=codec_type,codec_name,sample_rate',
    '-of', 'json',
    file,
  ]);
  const data = JSON.parse(stdout);
  const stream = (data.streams ?? []).find((/** @type {{ codec_type?: string }} */ s) => s.codec_type === 'audio');
  if (!stream) throw new Error(`${path.basename(file)} no tiene pista de audio`);
  const duration = Number(data.format?.duration);
  if (!(duration > 0)) throw new Error(`No se puede leer la duración de ${path.basename(file)}`);
  return {
    duration,
    codec: String(stream.codec_name),
    sampleRate: Number(stream.sample_rate) || 44_100,
    bitRate: Number(data.format?.bit_rate) || 0,
  };
}

/**
 * Hash del original, la carátula y las opciones que cambian el resultado.
 * @param {Record<string, unknown>} options
 */
async function hashOf(options) {
  const hash = createHash('sha256');
  for (const file of [input, artwork]) {
    if (!file) continue;
    for await (const chunk of createReadStream(file)) hash.update(chunk);
  }
  hash.update(JSON.stringify(options));
  return hash.digest('hex');
}

/** @param {number} seconds */
function formatDuration(seconds) {
  const s = Math.round(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const rest = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${rest}` : `${m}:${rest}`;
}

// --- 1. Leer el original -----------------------------------------------------------

const source = await probeAudio(input).catch((error) => fail(/** @type {Error} */ (error).message));
if (opts.copy && source.codec !== 'mp3') fail(`--copy solo sirve para MP3 (este es ${source.codec})`);
const mode = opts.copy ? 'copy' : 'normalize';
// MP3 admite 32, 44,1 y 48 kHz: se mantiene la del original si es una de esas.
const sampleRate = [32_000, 44_100, 48_000].includes(source.sampleRate) ? source.sampleRate : 44_100;
log(`· ${path.basename(input)}: ${source.codec}, ${formatDuration(source.duration)}, ${sampleRate / 1000} kHz`);

const hash = await hashOf({ v: PIPELINE_VERSION, mode, LOUDNESS, MP3_BITRATE, sampleRate, title, subtitle, ARTIST });
const audioKey = mixKey(slug, hash, 'mp3');
const artworkKey = artwork ? mixKey(slug, hash, 'jpg') : null;
const audioFile = path.join(outRoot, ...audioKey.split('/'));
const artworkFile = artworkKey ? path.join(outRoot, ...artworkKey.split('/')) : null;
await mkdir(path.dirname(audioFile), { recursive: true });

// --- 2. MP3 a 320 kbps y −14 LUFS ------------------------------------------------------

const tags = ['-map_metadata', '-1', '-id3v2_version', '3', '-write_id3v1', '0', '-metadata', `title=${title}`, '-metadata', `artist=${ARTIST}`];
if (subtitle) tags.push('-metadata', `album=${subtitle}`);

if (existsSync(audioFile) && !opts.force) {
  log(`· Ya existe ${audioKey}: no se vuelve a generar (usa --force para rehacerlo).`);
} else {
  const temp = `${audioFile}.tmp.mp3`;
  try {
    if (mode === 'copy') {
      await run(FFMPEG, ['-hide_banner', '-v', 'error', '-nostdin', '-y', '-i', input, '-map', '0:a:0', '-c:a', 'copy', ...tags, temp]);
    } else {
      log(`· Midiendo el volumen (objetivo: ${LOUDNESS.integrated} LUFS)…`);
      const first = await run(FFMPEG, [
        '-hide_banner', '-nostdin', '-i', input, '-map', '0:a:0',
        '-af', `loudnorm=I=${LOUDNESS.integrated}:TP=${LOUDNESS.truePeak}:LRA=${LOUDNESS.range}:print_format=json`,
        '-f', 'null', '-',
      ]);
      const measured = parseLoudnorm(first.stderr);
      log(`  medido: ${measured.input_i} LUFS, pico ${measured.input_tp} dBTP`);
      log(`· Codificando MP3 a ${MP3_BITRATE}bps…`);
      await run(FFMPEG, [
        '-hide_banner', '-v', 'error', '-nostdin', '-y', '-i', input, '-map', '0:a:0',
        '-af', loudnormFilter(measured), '-ar', String(sampleRate),
        '-c:a', 'libmp3lame', '-b:a', MP3_BITRATE, ...tags, temp,
      ]);
    }
    await rename(temp, audioFile);
  } catch (error) {
    await rm(temp, { force: true });
    fail(/** @type {Error} */ (error).message);
  }
}

const output = await probeAudio(audioFile).catch((error) => fail(/** @type {Error} */ (error).message));
if (output.codec !== 'mp3') fail(`La salida no es MP3 (${output.codec})`);
if (Math.abs(output.duration - source.duration) > 1) {
  fail(`La duración no cuadra: ${output.duration.toFixed(1)} s frente a ${source.duration.toFixed(1)} s`);
}
log(`✓ ${audioKey} (${formatDuration(output.duration)})`);

// --- 3. Carátula -------------------------------------------------------------------------

if (artwork && artworkFile && (!existsSync(artworkFile) || opts.force)) {
  await run(FFMPEG, [
    '-hide_banner', '-v', 'error', '-nostdin', '-y', '-i', artwork, '-frames:v', '1',
    '-vf', `scale=${ARTWORK_SIZE}:${ARTWORK_SIZE}:force_original_aspect_ratio=increase,crop=${ARTWORK_SIZE}:${ARTWORK_SIZE}`,
    '-q:v', '3', artworkFile,
  ]).catch((error) => fail(/** @type {Error} */ (error).message));
  log(`✓ ${artworkKey}`);
}

// --- 4. Subir a R2 ---------------------------------------------------------------------------

const { R2_ACCOUNT_ID, R2_ENDPOINT, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET } = process.env;
const hasR2 = Boolean((R2_ACCOUNT_ID || R2_ENDPOINT) && R2_ACCESS_KEY_ID && R2_SECRET_ACCESS_KEY && R2_BUCKET);
const keys = [audioKey, artworkKey].filter((k) => k !== null);
if (hasR2 && !opts['no-upload']) {
  log('· Subiendo a R2…');
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(ROOT, 'scripts/upload-to-r2.mjs'), '--root', outRoot, ...keys], {
      stdio: 'inherit',
      windowsHide: true,
    });
    child.on('error', reject);
    child.on('close', (code) => (code === 0 ? resolve(undefined) : reject(new Error(`La subida a R2 ha fallado (código ${code})`))));
  }).catch((error) => fail(/** @type {Error} */ (error).message));
} else {
  const root = path.relative(ROOT, outRoot) || '.';
  log(`· Sin subir a R2${hasR2 ? ' (--no-upload)' : ' (faltan las claves R2_* en .env)'}. Cuando toque:`);
  log(`    npm run media:upload -- --root "${root}" ${keys.join(' ')}`);
}

// --- 5. Fila de `mixes` --------------------------------------------------------------------

/** @type {import('./lib/mixes.mjs').MixRow} */
const row = {
  title,
  subtitle,
  audio_url: audioKey,
  duration_seconds: Math.max(1, Math.round(output.duration)),
  artwork_url: artworkKey,
  published: !opts.draft,
  sort_order: sortOrder,
};
validateMixRow(row);

const sql = buildMixUpsertSql([row]);
const { PUBLIC_SUPABASE_URL, SUPABASE_SECRET_KEY } = process.env;

if (opts.sql) {
  const out = path.resolve(opts.sql);
  await writeFile(out, sql, 'utf8');
  log(`\nSQL escrito en ${out}: pégalo en el SQL Editor de Supabase (o aplícalo con el MCP).`);
} else if (PUBLIC_SUPABASE_URL && SUPABASE_SECRET_KEY) {
  const { createClient } = await import('@supabase/supabase-js');
  const supabase = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SECRET_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const { error } = await supabase.from('mixes').upsert(row, { onConflict: 'audio_url' });
  if (error) fail(`No se ha podido guardar la fila en Supabase: ${error.message}`);
  log(`\n✓ Fila guardada en mixes (${row.published ? 'publicado' : 'sin publicar'}).`);
} else {
  log('\nFaltan PUBLIC_SUPABASE_URL y SUPABASE_SECRET_KEY en .env: pega este SQL en el SQL Editor de Supabase:\n');
  console.log(sql);
}

log(`\nListo: «${title}» → ${audioKey} (${formatBytes(statSync(audioFile).size)}).`);
