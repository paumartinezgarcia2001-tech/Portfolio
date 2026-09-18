// @ts-check
/**
 * Funciones puras del pipeline de vídeo (prompt maestro §5 · C15 y §7.5).
 * Las usan `scripts/video-to-hls.mjs`, `scripts/upload-to-r2.mjs` y
 * `scripts/serve-media.mjs`, y las prueban los tests unitarios.
 */

/** Escalera de calidades por defecto: lado corto de cada peldaño, en px (§5 · C15). */
export const DEFAULT_LADDER = [1080, 720, 480];

/** Duración objetivo de cada segmento HLS, en segundos. */
export const SEGMENT_SECONDS = 4;

/** Lado corto máximo del MP4 de respaldo («720p», §5 · C15). */
export const FALLBACK_SHORT_SIDE = 720;

/** Cabecera de caché de todo lo que se sube a R2. Cada vídeo vive en una carpeta con hash, así que nada se sobrescribe. */
export const CACHE_IMMUTABLE = 'public, max-age=31536000, immutable';

/**
 * Bitrate máximo (kbps) según el lado corto: 1080p ≈ 5 Mbps, 720p ≈ 2,8 Mbps y
 * 480p ≈ 1,2 Mbps (§5 · C15). Los tamaños intermedios se interpolan.
 * @type {ReadonlyArray<readonly [number, number]>}
 */
const BITRATE_POINTS = [
  [360, 700],
  [480, 1200],
  [720, 2800],
  [1080, 5000],
  [1440, 8000],
  [2160, 14000],
];

/**
 * @typedef {object} Aspect
 * @property {string} label   Nombre de la carpeta: «4x5», «9x16» o «source».
 * @property {number | null} ratio  Ancho ÷ alto; `null` = la proporción del original.
 */

/**
 * @typedef {object} Size
 * @property {number} width
 * @property {number} height
 */

/**
 * @typedef {Size & { x: number, y: number }} Crop
 */

/**
 * «4:5», «9:16», «4x5» o «source» → proporción de salida.
 * @param {string} text
 * @returns {Aspect}
 */
export function parseAspect(text) {
  const clean = text.trim().toLowerCase();
  if (clean === 'source' || clean === 'original') return { label: 'source', ratio: null };
  const match = /^(\d+(?:\.\d+)?)\s*[:x/]\s*(\d+(?:\.\d+)?)$/.exec(clean);
  if (!match) throw new Error(`Proporción no válida: «${text}» (usa, p. ej., 4:5 o 9:16)`);
  const w = Number(match[1]);
  const h = Number(match[2]);
  if (!(w > 0 && h > 0)) throw new Error(`Proporción no válida: «${text}»`);
  return { label: `${match[1]}x${match[2]}`, ratio: w / h };
}

/**
 * Número par hacia abajo (H.264 con 4:2:0 necesita dimensiones pares).
 * @param {number} value
 */
export function evenFloor(value) {
  return 2 * Math.floor(value / 2);
}

/**
 * Número par más cercano (mínimo 2).
 * @param {number} value
 */
export function evenRound(value) {
  return Math.max(2, 2 * Math.round(value / 2));
}

/** @param {number} value */
function clamp01(value) {
  return Math.min(1, Math.max(0, value));
}

/**
 * Recorte del fotograma a la proporción pedida, desplazado hacia el punto
 * focal (0 = izquierda/arriba, 0,5 = centro, 1 = derecha/abajo).
 * @param {Size} source  Tamaño del fotograma tal como se ve (ya girado).
 * @param {number | null} ratio  Ancho ÷ alto de la salida; `null` = sin recortar.
 * @param {number} [focusX]
 * @param {number} [focusY]
 * @returns {Crop}
 */
export function computeCrop(source, ratio, focusX = 0.5, focusY = 0.5) {
  const fullWidth = evenFloor(source.width);
  const fullHeight = evenFloor(source.height);
  if (ratio === null || Math.abs(fullWidth / fullHeight - ratio) < 0.001) {
    return { width: fullWidth, height: fullHeight, x: 0, y: 0 };
  }
  if (fullWidth / fullHeight > ratio) {
    // El original es más ancho: se recortan los lados.
    const width = Math.min(fullWidth, evenFloor(fullHeight * ratio));
    const x = evenFloor((source.width - width) * clamp01(focusX));
    return { width, height: fullHeight, x, y: 0 };
  }
  // El original es más alto: se recorta arriba y abajo.
  const height = Math.min(fullHeight, evenFloor(fullWidth / ratio));
  const y = evenFloor((source.height - height) * clamp01(focusY));
  return { width: fullWidth, height, x: 0, y };
}

/** @param {Size} size */
export function shortSide(size) {
  return Math.min(size.width, size.height);
}

/**
 * Peldaños (lado corto, de mayor a menor) que tiene sentido generar para un
 * recorte: nunca se amplía. Si el original se queda entre dos peldaños, se
 * añade uno con su tamaño real para no perder calidad (p. ej. 576 → 576 y 480).
 * @param {number} sourceShort
 * @param {number[]} [ladder]
 * @returns {number[]}
 */
export function buildLadder(sourceShort, ladder = DEFAULT_LADDER) {
  const steps = [...new Set(ladder.map((s) => evenFloor(s)))].filter((s) => s > 0).sort((a, b) => b - a);
  const native = evenFloor(sourceShort);
  const kept = steps.filter((s) => s <= native);
  const top = kept[0];
  if (top === undefined || top < native * 0.9) kept.unshift(native);
  return kept;
}

/**
 * Tamaño de un peldaño: el lado corto es `short` y se mantiene la proporción del recorte.
 * @param {Size} crop
 * @param {number} short
 * @returns {Size}
 */
export function rungSize(crop, short) {
  if (short >= shortSide(crop)) return { width: crop.width, height: crop.height };
  if (crop.width <= crop.height) {
    return { width: short, height: evenRound((short * crop.height) / crop.width) };
  }
  return { width: evenRound((short * crop.width) / crop.height), height: short };
}

/**
 * Bitrate máximo (kbps) para un lado corto, interpolando la tabla de §5 · C15.
 * @param {number} short
 */
export function maxBitrateKbps(short) {
  const first = /** @type {readonly [number, number]} */ (BITRATE_POINTS[0]);
  const last = /** @type {readonly [number, number]} */ (BITRATE_POINTS[BITRATE_POINTS.length - 1]);
  if (short <= first[0]) return Math.max(150, Math.round((first[1] * (short / first[0]) ** 2) / 10) * 10);
  if (short >= last[0]) return last[1];
  for (let i = 1; i < BITRATE_POINTS.length; i++) {
    const [s1, b1] = /** @type {readonly [number, number]} */ (BITRATE_POINTS[i]);
    const [s0, b0] = /** @type {readonly [number, number]} */ (BITRATE_POINTS[i - 1]);
    if (short <= s1) return Math.round((b0 + ((b1 - b0) * (short - s0)) / (s1 - s0)) / 10) * 10;
  }
  return last[1];
}

/** @param {number} short */
export function rungName(short) {
  return `${short}p`;
}

/**
 * Orden de las variantes en el `master.m3u8`. Safari y hls.js empiezan por la
 * primera, así que va primero la más ligera (≈600 kB por segmento en 480p):
 * el vídeo arranca en menos de 2 s en 4G y después sube de calidad solo. El
 * resto va de mayor a menor.
 * @param {number[]} shorts
 * @returns {number[]}
 */
export function masterOrder(shorts) {
  const sorted = [...shorts].sort((a, b) => b - a);
  const lightest = sorted[sorted.length - 1];
  if (lightest === undefined) return [];
  return [lightest, ...sorted.slice(0, -1)];
}

/** @type {Record<string, string>} */
const AVC_PROFILES = {
  'constrained baseline': '42e0',
  baseline: '4200',
  main: '4d00',
  extended: '5800',
  high: '6400',
};

/**
 * Cadena `CODECS` de H.264 (RFC 6381) a partir de lo que devuelve ffprobe:
 * `avcCodecString('High', 31)` → `avc1.64001f`.
 * @param {string} profile
 * @param {number} level  Nivel ×10 (31 = 3.1).
 */
export function avcCodecString(profile, level) {
  const prefix = AVC_PROFILES[profile.trim().toLowerCase()];
  if (!prefix) throw new Error(`Perfil H.264 desconocido: ${profile}`);
  if (!Number.isInteger(level) || level <= 0) throw new Error(`Nivel H.264 no válido: ${level}`);
  return `avc1.${prefix}${level.toString(16).padStart(2, '0')}`;
}

/**
 * Cadena `CODECS` de AV1 (solo para los fixtures de los tests):
 * `av1CodecString('Main', 4, 8)` → `av01.0.04M.08`.
 * @param {string} profile
 * @param {number} level  `seq_level_idx` (4 = nivel 3.0).
 * @param {number} [bitDepth]
 */
export function av1CodecString(profile, level, bitDepth = 8) {
  const profiles = ['main', 'high', 'professional'];
  const index = profiles.indexOf(profile.trim().toLowerCase());
  if (index < 0) throw new Error(`Perfil AV1 desconocido: ${profile}`);
  return `av01.${index}.${String(level).padStart(2, '0')}M.${String(bitDepth).padStart(2, '0')}`;
}

/**
 * Cadena `CODECS` del audio.
 * @param {string} codec  `codec_name` de ffprobe.
 * @param {string} [profile]
 */
export function audioCodecString(codec, profile = '') {
  if (codec === 'aac') return /he/i.test(profile) ? 'mp4a.40.5' : 'mp4a.40.2';
  if (codec === 'opus') return 'opus';
  throw new Error(`Códec de audio no previsto: ${codec}`);
}

/**
 * @typedef {object} MasterVariant
 * @property {string} uri
 * @property {number} bandwidth         Pico, en bit/s.
 * @property {number} averageBandwidth  Media, en bit/s.
 * @property {number} width
 * @property {number} height
 * @property {number} frameRate
 * @property {string} codecs
 */

/**
 * `master.m3u8` con una variante por peldaño.
 * @param {MasterVariant[]} variants  En el orden en que deben aparecer.
 */
export function buildMasterPlaylist(variants) {
  const lines = ['#EXTM3U', '#EXT-X-VERSION:7', '#EXT-X-INDEPENDENT-SEGMENTS'];
  for (const v of variants) {
    const attributes = [
      `BANDWIDTH=${Math.round(v.bandwidth)}`,
      `AVERAGE-BANDWIDTH=${Math.round(v.averageBandwidth)}`,
      `CODECS="${v.codecs}"`,
      `RESOLUTION=${v.width}x${v.height}`,
      `FRAME-RATE=${v.frameRate.toFixed(3)}`,
    ];
    lines.push(`#EXT-X-STREAM-INF:${attributes.join(',')}`, v.uri);
  }
  return `${lines.join('\n')}\n`;
}

/**
 * @typedef {object} MediaPlaylist
 * @property {number} version
 * @property {number} targetDuration
 * @property {string | null} map  URI del segmento de inicialización (fMP4).
 * @property {{ duration: number, uri: string }[]} segments
 * @property {boolean} endList
 */

/**
 * Lee una lista de reproducción de medios (la de cada peldaño).
 * @param {string} text
 * @returns {MediaPlaylist}
 */
export function parseMediaPlaylist(text) {
  const lines = text.split(/\r?\n/).map((l) => l.trim());
  if (lines[0] !== '#EXTM3U') throw new Error('No es una lista M3U8');
  /** @type {MediaPlaylist} */
  const playlist = { version: 1, targetDuration: 0, map: null, segments: [], endList: false };
  let pendingDuration = /** @type {number | null} */ (null);
  for (const line of lines.slice(1)) {
    if (!line) continue;
    if (line.startsWith('#EXT-X-VERSION:')) playlist.version = Number(line.slice(15));
    else if (line.startsWith('#EXT-X-TARGETDURATION:')) playlist.targetDuration = Number(line.slice(22));
    else if (line.startsWith('#EXT-X-MAP:')) playlist.map = /URI="([^"]+)"/.exec(line)?.[1] ?? null;
    else if (line.startsWith('#EXTINF:')) pendingDuration = Number.parseFloat(line.slice(8));
    else if (line === '#EXT-X-ENDLIST') playlist.endList = true;
    else if (!line.startsWith('#')) {
      if (pendingDuration === null) throw new Error(`Segmento sin #EXTINF: ${line}`);
      playlist.segments.push({ duration: pendingDuration, uri: line });
      pendingDuration = null;
    }
  }
  return playlist;
}

/**
 * `BANDWIDTH` (pico por segmento) y `AVERAGE-BANDWIDTH` (media) en bit/s.
 * @param {{ duration: number, bytes: number }[]} segments
 */
export function playlistBandwidth(segments) {
  if (segments.length === 0) throw new Error('Lista sin segmentos');
  let peak = 0;
  let bytes = 0;
  let seconds = 0;
  for (const s of segments) {
    // Un último segmento muy corto dispararía el pico: se mide al menos sobre 1 s.
    peak = Math.max(peak, (s.bytes * 8) / Math.max(s.duration, 1));
    bytes += s.bytes;
    seconds += s.duration;
  }
  return { bandwidth: Math.ceil(peak), averageBandwidth: Math.ceil((bytes * 8) / seconds) };
}

/** @type {Record<string, string>} */
const CONTENT_TYPES = {
  '.m3u8': 'application/vnd.apple.mpegurl',
  '.m4s': 'video/mp4',
  '.mp4': 'video/mp4',
  '.ts': 'video/mp2t',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.avif': 'image/avif',
  '.webp': 'image/webp',
  '.png': 'image/png',
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.json': 'application/json',
};

/**
 * `Content-Type` según la extensión (sin distinguir mayúsculas).
 * @param {string} file
 */
export function contentTypeFor(file) {
  const match = /\.[^./\\]+$/.exec(file.toLowerCase());
  return (match && CONTENT_TYPES[match[0]]) || 'application/octet-stream';
}

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** @param {string} slug */
export function isValidSlug(slug) {
  return SLUG.test(slug) && slug.length <= 60;
}

/**
 * Carpeta del vídeo: slug + hash corto del original y de las opciones. Si se
 * vuelve a generar con otro corte o encuadre, cambia la carpeta y la caché
 * inmutable de R2 nunca sirve una versión vieja.
 * @param {string} slug
 * @param {string | null} hash  `null` = sin hash (fixtures de los tests).
 */
export function versionedFolder(slug, hash) {
  if (!isValidSlug(slug)) throw new Error(`Slug no válido: «${slug}» (minúsculas, números y guiones)`);
  return hash ? `${slug}-${hash.slice(0, 8)}` : slug;
}

/**
 * Clave de R2 (siempre con «/») a partir de una ruta relativa del disco.
 * @param {string} relativePath
 * @param {string} [prefix]
 */
export function objectKey(relativePath, prefix = '') {
  const key = relativePath.split(/[\\/]+/).filter(Boolean).join('/');
  const cleanPrefix = prefix.split('/').filter(Boolean).join('/');
  return cleanPrefix ? `${cleanPrefix}/${key}` : key;
}

/**
 * ¿El ETag de R2 corresponde a este MD5? (Solo en subidas de una parte:
 * las multiparte llevan «-N» y no son un MD5.)
 * @param {string | undefined} etag
 * @param {string} md5Hex
 */
export function etagMatches(etag, md5Hex) {
  if (!etag) return false;
  return etag.replaceAll('"', '').toLowerCase() === md5Hex.toLowerCase();
}

/**
 * ¿El MP4 tiene el `moov` delante del `mdat` (`+faststart`)?
 * @param {string[]} boxTypes  Cajas de primer nivel, en orden.
 */
export function isFastStart(boxTypes) {
  const moov = boxTypes.indexOf('moov');
  const mdat = boxTypes.indexOf('mdat');
  return moov >= 0 && (mdat < 0 || moov < mdat);
}

/**
 * «2,9 MB», «640 kB»… (unidades del SI: 1 kB = 1000 B).
 * @param {number} bytes
 */
export function formatBytes(bytes) {
  const units = ['B', 'kB', 'MB', 'GB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1000 && unit < units.length - 1) {
    value /= 1000;
    unit++;
  }
  const digits = unit === 0 || value >= 100 ? 0 : 1;
  return `${value.toLocaleString('es-ES', { maximumFractionDigits: digits, minimumFractionDigits: digits })} ${units[unit]}`;
}

/**
 * Fracción («30/1», «30000/1001») → número.
 * @param {string | undefined} text
 */
export function parseRate(text) {
  if (!text) return 0;
  const [num, den] = text.split('/').map(Number);
  if (!num || !den) return Number(text) || 0;
  return num / den;
}
