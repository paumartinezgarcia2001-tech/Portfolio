/**
 * Panel oculto (C19, fase 6): textos, límites y rutas.
 *
 * ⚠️ El nombre de la página NO va aquí ni en ningún archivo del repo (que es
 * público): es el secreto `ADMIN_PATH`. Las rutas del panel se construyen con
 * el parámetro de la URL, que el middleware ya ha comparado con ese secreto.
 *
 * Los textos marcados con §8 son los del prompt maestro; el resto, propuestas
 * de la fase 6 (cámbialos aquí si Pau o Luna prefieren otros).
 */

export const ADMIN_TEXT = {
  /** §8 */
  loginFailed: 'Usuario o contraseña incorrectos.',
  /** §8 */
  saved: 'Guardado.',
  /** §8 */
  duplicate: 'Ya hay un bolo en esa fecha y sala. ¿Quieres guardarlo igualmente?',
  duplicateBulk: 'Algunas fechas ya tienen un bolo en esa sala. ¿Quieres guardarlas igualmente?',
  exactDuplicate: 'Ese bolo ya existe: misma fecha, sala y fiesta.',
  saveFailed: 'No se ha podido guardar. Inténtalo de nuevo.',
  loadFailed: 'No se han podido cargar los datos. Recarga la página.',
  sessionExpired: 'La sesión ha caducado. Vuelve a entrar.',
  captchaMissing: 'Falta la comprobación anti-spam. Espera a que termine y vuelve a intentarlo.',
  captchaFailed: 'No se ha podido completar la comprobación anti-spam. Vuelve a intentarlo.',
  tooManyAttempts: 'Demasiados intentos. Espera un rato antes de volver a probar.',
  mfaFailed: 'El código no es correcto o ha caducado.',
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
  codeInvalid: 'Escribe los 6 números del código.',
  titleRequired: 'Escribe un título.',
  pathInvalid: 'Tiene que ser una ruta del bucket (p. ej. video/…/master.m3u8) o una URL https.',
  jsonInvalid: 'No es un bloque válido: pégalo tal cual lo imprime el script.',
} as const;

/** Límites (los mismos que las restricciones de la base de datos, §7.1). */
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
  /** Tamaño máximo de un mix subido desde el panel (bytes). */
  mixMaxBytes: 500 * 1024 * 1024,
  artworkMaxBytes: 5 * 1024 * 1024,
  identifierMax: 254,
  passwordMax: 200,
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
  { key: 'security', path: 'seguridad', label: 'seguridad' },
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

/** Tipos de archivo que acepta la subida de mixes (P2). */
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

/** Validez de las URLs firmadas de subida a R2 (segundos). */
export const UPLOAD_URL_TTL = 15 * 60;
