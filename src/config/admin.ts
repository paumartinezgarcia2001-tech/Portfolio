/**
 * Panel oculto (C19): textos, límites y rutas.
 *
 * ⚠️ El nombre de la página NO va aquí ni en ningún archivo del repo (que es
 * público): es el secreto `ADMIN_PATH`. Las rutas del panel se construyen con
 * el parámetro de la URL, que el middleware ya ha comparado con ese secreto.
 *
 * Los textos se pueden cambiar aquí si Pau o Luna prefieren otros.
 */

export const ADMIN_TEXT = {
  loginFailed: 'Usuario o contraseña incorrectos.',
  saved: 'Guardado.',
  duplicate: 'Ya hay un bolo en esa fecha y sala. ¿Quieres guardarlo igualmente?',
  duplicateBulk: 'Algunas fechas ya tienen un bolo en esa sala. ¿Quieres guardarlas igualmente?',
  exactDuplicate: 'Ese bolo ya existe: misma fecha, sala y fiesta.',
  saveFailed: 'No se ha podido guardar. Inténtalo de nuevo.',
  loadFailed: 'No se han podido cargar los datos. Recarga la página.',
  sessionExpired: 'La sesión ha caducado. Vuelve a entrar.',
  tooManyAttempts: 'Demasiados intentos. Espera un rato antes de volver a probar.',
  noScript: 'El panel necesita JavaScript.',
  notConfigured: 'Falta configurar Supabase (PUBLIC_SUPABASE_URL y PUBLIC_SUPABASE_PUBLISHABLE_KEY).',
  deleted: 'Borrado.',
  saving: 'Guardando…',
  signingIn: 'Entrando…',
} as const;

/** Mensajes de error de los campos (se muestran junto a cada uno). */
export const ADMIN_FIELD_ERRORS = {
  required: 'Este campo es obligatorio.',
  dateInvalid: 'Escribe una fecha válida.',
  dateRequired: 'Elige al menos una fecha.',
  venueRequired: 'Escribe la sala.',
  cityRequired: 'Escribe la ciudad.',
  urlInvalid: 'El enlace tiene que empezar por https://',
  tooLong: (max: number) => `Máximo ${max} caracteres.`,
  tooMany: (max: number) => `Máximo ${max}.`,
  numberInvalid: 'Escribe un número válido.',
  identifierRequired: 'Escribe tu usuario o tu email.',
  passwordRequired: 'Escribe la contraseña.',
  titleRequired: 'Escribe un título.',
  pathInvalid: 'Tiene que ser una ruta del bucket (p. ej. video/…/master.m3u8) o una URL https.',
  jsonInvalid: 'No es un bloque válido: pégalo tal cual lo imprime el script.',
  colorInvalid: 'Escribe un color en formato #RRGGBB (p. ej. #ff00ff).',
} as const;

/** Límites (los mismos que las restricciones de la base de datos). */
export const ADMIN_LIMITS = {
  tickerMax: 500,
  partyMax: 120,
  venueMax: 120,
  cityMax: 80,
  /** Artistas por cartel (el más largo de los datos tiene 10). */
  lineupMax: 40,
  artistMax: 120,
  ticketUrlMax: 500,
  /** Fechas de una vez con «añadir varias fechas». */
  bulkMax: 60,
  infoMax: 20_000,
  mixTitleMax: 140,
  mixSubtitleMax: 140,
  /** Tamaño máximo del MP3 que se sube a R2 (ya convertido; 2 h a 320 kbps ≈ 290 MB). */
  mixMaxBytes: 500 * 1024 * 1024,
  /** Tamaño máximo del archivo que se elige (un WAV de 2 h ronda 1,3 GB): el navegador lo convierte. */
  mixSourceMaxBytes: 2 * 1000 * 1000 * 1000,
  /** Carátula ya convertida (JPEG 1000 × 1000) y la imagen que se elige. */
  artworkMaxBytes: 5 * 1024 * 1024,
  artworkSourceMaxBytes: 40 * 1024 * 1024,
  identifierMax: 254,
  passwordMax: 200,
} as const;

/**
 * Almacenamiento de R2 (D64). El plan gratuito incluye 10 GB al mes (de
 * 1000³ bytes; se factura el pico de cada día). El panel enseña siempre lo
 * ocupado, avisa desde el 80 % y no deja subir nada que haga pasar del límite;
 * `npm run media:upload` comprueba lo mismo.
 */
export const R2_STORAGE = {
  limitBytes: 10 * 1000 * 1000 * 1000,
  warnFraction: 0.8,
} as const;

/** Conversión de los mixes en el navegador (D64): lo mismo que `npm run media:mix`. */
export const MIX_ENCODING = {
  /** Sonoridad integrada objetivo (LUFS) y techo de picos (dBFS, con margen para el MP3). */
  targetLufs: -14,
  peakCeilingDb: -1.5,
  bitrate: 320,
  artworkSize: 1000,
  artworkQuality: 0.9,
} as const;

/** Bolos del archivo por página (C19). */
export const ARCHIVE_PAGE_SIZE = 50;

/** Subpáginas del panel (relativas a su raíz). */
export const ADMIN_PAGES = [
  { key: 'home', path: '', label: 'bolos y barra' },
  { key: 'archive', path: 'archivo', label: 'archivo' },
  { key: 'mixes', path: 'mixes', label: 'mixes' },
  { key: 'info', path: 'info', label: 'info' },
  { key: 'video', path: 'video', label: 'vídeo' },
  { key: 'colors', path: 'colores', label: 'colores' },
] as const;

export type AdminPageKey = (typeof ADMIN_PAGES)[number]['key'];

/**
 * Ruta de una página del panel a partir del parámetro `[admin]` de la URL
 * (ya validado por el middleware): `adminHref('xyz', 'archivo')` → `/xyz/archivo`.
 */
export function adminHref(slug: string, path = ''): string {
  const clean = path.replace(/^\/+/, '');
  return clean ? `/${slug}/${clean}` : `/${slug}`;
}

/** Tipos de archivo que acepta la subida de mixes. */
export const MIX_AUDIO_TYPES = {
  'audio/mpeg': 'mp3',
  'audio/mp4': 'm4a',
  'audio/x-m4a': 'm4a',
  'audio/aac': 'aac',
} as const;

export const MIX_ARTWORK_TYPES = {
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/png': 'png',
} as const;

/** Lo que se puede elegir en el panel: el navegador lo convierte a MP3 (D64). */
export const MIX_SOURCE_ACCEPT = 'audio/*,.wav,.wave,.aif,.aiff,.aifc,.flac,.mp3,.m4a,.aac,.ogg,.oga,.opus';
export const MIX_ARTWORK_SOURCE_ACCEPT = 'image/jpeg,image/png,image/webp,image/avif,.jpg,.jpeg,.png,.webp,.avif';

/** Validez de las URLs firmadas de subida a R2 (segundos). */
export const UPLOAD_URL_TTL = 15 * 60;
