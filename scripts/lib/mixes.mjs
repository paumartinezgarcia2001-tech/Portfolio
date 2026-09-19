// @ts-check
/**
 * Funciones puras de `scripts/add-mix.mjs` (prompt maestro §7.5 y C06). Las
 * prueban los tests unitarios.
 */
import { isValidSlug } from './video.mjs';
import { sqlText } from './gigs.mjs';

/** Sonoridad de los mixes (§7.5): unos −14 LUFS, picos por debajo de −1 dBTP. */
export const LOUDNESS = { integrated: -14, truePeak: -1, range: 11 };

/** MP3 a 320 kbps CBR (§7.5). */
export const MP3_BITRATE = '320k';

/** Lado de la carátula cuadrada (§7.5). */
export const ARTWORK_SIZE = 1000;

/**
 * «SAOKO (ROSALÍA)» → «saoko-rosalia». Minúsculas, sin acentos ni símbolos,
 * como mucho 60 caracteres.
 * @param {string} text
 */
export function slugify(text) {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/g, '');
}

/**
 * Nombre del archivo en el bucket: `mixes/<slug>-<hash>.<ext>` (§7.5). El hash
 * cambia si cambia el original o la forma de codificarlo, así que el archivo
 * puede ser inmutable en R2.
 * @param {string} slug
 * @param {string} hash  Hash hexadecimal (se usan 8 caracteres).
 * @param {string} [ext]
 */
export function mixKey(slug, hash, ext = 'mp3') {
  if (!isValidSlug(slug)) throw new Error(`Slug no válido: «${slug}» (minúsculas, números y guiones)`);
  if (!/^[0-9a-f]{8,}$/i.test(hash)) throw new Error(`Hash no válido: «${hash}»`);
  return `mixes/${slug}-${hash.slice(0, 8).toLowerCase()}.${ext}`;
}

/**
 * Busca en la salida de ffmpeg el JSON que imprime `loudnorm` con
 * `print_format=json` (primera pasada).
 * @param {string} stderr
 * @returns {{ input_i: string, input_tp: string, input_lra: string, input_thresh: string, target_offset: string }}
 */
export function parseLoudnorm(stderr) {
  const start = stderr.lastIndexOf('{');
  const end = stderr.lastIndexOf('}');
  if (start < 0 || end < start) throw new Error('ffmpeg no ha devuelto las medidas de loudnorm');
  const data = JSON.parse(stderr.slice(start, end + 1));
  for (const key of ['input_i', 'input_tp', 'input_lra', 'input_thresh', 'target_offset']) {
    if (!(key in data) || !Number.isFinite(Number(data[key]))) {
      throw new Error(`Medida de loudnorm no válida: ${key} = ${data[key]}`);
    }
  }
  return data;
}

/**
 * Filtro de la segunda pasada de `loudnorm` con las medidas de la primera.
 * @param {ReturnType<typeof parseLoudnorm>} measured
 */
export function loudnormFilter(measured) {
  const { integrated, truePeak, range } = LOUDNESS;
  return [
    `loudnorm=I=${integrated}`,
    `TP=${truePeak}`,
    `LRA=${range}`,
    `measured_I=${measured.input_i}`,
    `measured_TP=${measured.input_tp}`,
    `measured_LRA=${measured.input_lra}`,
    `measured_thresh=${measured.input_thresh}`,
    `offset=${measured.target_offset}`,
    'linear=true',
    'print_format=summary',
  ].join(':');
}

/**
 * @typedef {object} MixRow
 * @property {string} title
 * @property {string | null} subtitle
 * @property {string} audio_url      Ruta dentro del bucket (D46) o URL https.
 * @property {number | null} duration_seconds
 * @property {string | null} artwork_url
 * @property {boolean} published
 * @property {number} sort_order
 */

/**
 * Comprueba una fila antes de guardarla (las mismas reglas que la tabla).
 * @param {MixRow} row
 */
export function validateMixRow(row) {
  const path = /^[a-z0-9][a-z0-9._-]*(\/[a-z0-9][a-z0-9._-]*)*$/;
  if (!row.title || row.title.length > 140) throw new Error('El título tiene que tener entre 1 y 140 caracteres');
  if (!/^https:\/\//i.test(row.audio_url) && !path.test(row.audio_url)) {
    throw new Error(`audio_url no válida: «${row.audio_url}»`);
  }
  if (row.artwork_url && !/^https:\/\//i.test(row.artwork_url) && !path.test(row.artwork_url)) {
    throw new Error(`artwork_url no válida: «${row.artwork_url}»`);
  }
  if (row.duration_seconds !== null && !(Number.isInteger(row.duration_seconds) && row.duration_seconds > 0)) {
    throw new Error(`Duración no válida: ${row.duration_seconds}`);
  }
  if (!Number.isInteger(row.sort_order)) throw new Error(`Orden no válido: ${row.sort_order}`);
}

/**
 * `INSERT … ON CONFLICT (audio_url)` idempotente para el SQL Editor o el MCP
 * de Supabase. Devuelve, por cada fila tocada, si se insertó.
 * @param {MixRow[]} rows
 */
export function buildMixUpsertSql(rows) {
  if (rows.length === 0) return '-- No hay mixes que añadir.\n';
  for (const row of rows) validateMixRow(row);
  const num = (/** @type {number | null} */ value) => (value === null ? 'null' : String(value));
  const values = rows
    .map(
      (r) =>
        `  (${sqlText(r.title)}, ${sqlText(r.subtitle)}, ${sqlText(r.audio_url)}, ${num(r.duration_seconds)}, ` +
        `${sqlText(r.artwork_url)}, ${r.published}, ${r.sort_order})`,
    )
    .join(',\n');
  return [
    '-- Mixes generados por scripts/add-mix.mjs',
    'insert into public.mixes (title, subtitle, audio_url, duration_seconds, artwork_url, published, sort_order)',
    'values',
    values,
    'on conflict on constraint mixes_audio_url_key do update set',
    '  title = excluded.title,',
    '  subtitle = excluded.subtitle,',
    '  duration_seconds = excluded.duration_seconds,',
    '  artwork_url = excluded.artwork_url,',
    '  published = excluded.published,',
    '  sort_order = excluded.sort_order',
    'where (mixes.title, mixes.subtitle, mixes.duration_seconds, mixes.artwork_url, mixes.published, mixes.sort_order)',
    '  is distinct from (excluded.title, excluded.subtitle, excluded.duration_seconds, excluded.artwork_url,',
    '    excluded.published, excluded.sort_order)',
    'returning (xmax = 0) as inserted, title, audio_url;',
    '',
  ].join('\n');
}
