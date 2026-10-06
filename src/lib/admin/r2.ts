/**
 * Subida de mixes a R2 desde el panel.
 *
 * El Worker no recibe el archivo: firma una URL (AWS Signature V4 en la query,
 * como las URLs prefirmadas de S3) y el navegador sube el MP3 directamente al
 * endpoint S3 de R2 con un PUT. Así no cuenta el límite de 100 MB por
 * petición de Workers ni se gasta CPU del Worker.
 *
 * Sin dependencias: la firma usa WebCrypto, que existe en Workers y en Node.
 * El token de R2 (R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY) debería tener solo
 * «Object Read & Write» sobre el bucket de medios.
 */

export interface R2Credentials {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  /**
   * Otro endpoint S3 (secreto `R2_ENDPOINT`): la jurisdicción UE
   * (`https://<cuenta>.eu.r2.cloudflarestorage.com`) o el R2 simulado de los
   * e2e. Sin él, el de la cuenta.
   */
  endpoint?: string | undefined;
}

/** Endpoint S3 de la cuenta de R2 (no es el dominio público del bucket). */
export function r2Endpoint(accountId: string, override?: string): string {
  const custom = override?.trim().replace(/\/+$/, '');
  return custom || `https://${accountId}.r2.cloudflarestorage.com`;
}

export interface PresignOptions {
  method: 'GET' | 'PUT' | 'DELETE' | 'HEAD';
  /** `bucket.s3.amazonaws.com` o `<cuenta>.r2.cloudflarestorage.com`. */
  host: string;
  /** Ruta ya con el bucket si es de tipo «path» (`/bucket/clave`), sin codificar. */
  path: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** R2 usa `auto`. */
  region: string;
  /** Segundos (1 – 604800). */
  expiresIn: number;
  now?: Date;
  service?: string;
  protocol?: 'https' | 'http';
  /** Parámetros de la petición (p. ej. `list-type=2` para listar), que entran en la firma. */
  query?: Record<string, string> | undefined;
  /**
   * Cabeceras que también se firman (además de `host`): el navegador tiene que
   * mandarlas exactamente así o R2 responde 403. Se usa con `content-type`.
   */
  headers?: Record<string, string> | undefined;
}

const encoder = new TextEncoder();

function toHex(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function sha256Hex(text: string): Promise<string> {
  return toHex(await crypto.subtle.digest('SHA-256', encoder.encode(text)));
}

async function hmac(key: ArrayBuffer | Uint8Array<ArrayBuffer>, text: string): Promise<ArrayBuffer> {
  const cryptoKey = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(text));
}

/** Codificación URI de AWS (RFC 3986): todo salvo `A-Z a-z 0-9 - _ . ~`. */
export function awsEncode(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
}

/** `/bucket/mixes/a b.mp3` → `/bucket/mixes/a%20b.mp3` (las barras se quedan). */
export function encodePath(path: string): string {
  return path
    .split('/')
    .map((segment) => awsEncode(segment))
    .join('/');
}

/** `2013-05-24T00:00:00.000Z` → `20130524T000000Z`. */
export function amzDate(date: Date): string {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

/** URL prefirmada (Signature V4 en la query, cuerpo sin firmar). */
export async function presignUrl(options: PresignOptions): Promise<string> {
  const { method, host, accessKeyId, secretAccessKey, region, expiresIn } = options;
  const service = options.service ?? 's3';
  const datetime = amzDate(options.now ?? new Date());
  const day = datetime.slice(0, 8);
  const scope = `${day}/${region}/${service}/aws4_request`;
  const path = encodePath(options.path.startsWith('/') ? options.path : `/${options.path}`);

  const signed = new Map<string, string>([['host', host]]);
  for (const [name, value] of Object.entries(options.headers ?? {})) {
    signed.set(name.toLowerCase(), value.trim().replace(/\s+/g, ' '));
  }
  const signedNames = [...signed.keys()].sort();
  const query: Array<[string, string]> = [
    ...Object.entries(options.query ?? {}),
    ['X-Amz-Algorithm', 'AWS4-HMAC-SHA256'],
    ['X-Amz-Credential', `${accessKeyId}/${scope}`],
    ['X-Amz-Date', datetime],
    ['X-Amz-Expires', String(Math.max(1, Math.min(604_800, Math.round(expiresIn))))],
    ['X-Amz-SignedHeaders', signedNames.join(';')],
  ];
  const canonicalQuery = query
    .map(([key, value]) => [awsEncode(key), awsEncode(value)] as const)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, value]) => `${key}=${value}`)
    .join('&');

  const canonicalHeaders = signedNames.map((name) => `${name}:${signed.get(name)}\n`).join('');
  const canonicalRequest = [method, path, canonicalQuery, canonicalHeaders, signedNames.join(';'), 'UNSIGNED-PAYLOAD'].join(
    '\n',
  );
  const stringToSign = ['AWS4-HMAC-SHA256', datetime, scope, await sha256Hex(canonicalRequest)].join('\n');

  const kDate = await hmac(encoder.encode(`AWS4${secretAccessKey}`), day);
  const kRegion = await hmac(kDate, region);
  const kService = await hmac(kRegion, service);
  const kSigning = await hmac(kService, 'aws4_request');
  const signature = toHex(await hmac(kSigning, stringToSign));

  return `${options.protocol ?? 'https'}://${host}${path}?${canonicalQuery}&X-Amz-Signature=${signature}`;
}

export interface PresignR2Extra {
  now?: Date | undefined;
  query?: Record<string, string> | undefined;
  headers?: Record<string, string> | undefined;
}

/**
 * URL prefirmada para un objeto del bucket de R2 (estilo «path»). Con
 * `key` vacío, la del bucket (para listarlo).
 */
export function presignR2(
  credentials: R2Credentials,
  method: PresignOptions['method'],
  key: string,
  expiresIn: number,
  extra: PresignR2Extra | Date = {},
): Promise<string> {
  const { now, query, headers } = extra instanceof Date ? { now: extra, query: undefined, headers: undefined } : extra;
  const endpoint = new URL(r2Endpoint(credentials.accountId, credentials.endpoint));
  const base = endpoint.pathname.replace(/\/+$/, '');
  return presignUrl({
    method,
    host: endpoint.host,
    path: key ? `${base}/${credentials.bucket}/${key}` : `${base}/${credentials.bucket}`,
    accessKeyId: credentials.accessKeyId,
    secretAccessKey: credentials.secretAccessKey,
    region: 'auto',
    expiresIn,
    protocol: endpoint.protocol === 'http:' ? 'http' : 'https',
    ...(now ? { now } : {}),
    ...(query ? { query } : {}),
    ...(headers ? { headers } : {}),
  });
}

/**
 * «SAOKO (ROSALÍA)» → «saoko-rosalia» (igual que scripts/lib/mixes.mjs).
 * Minúsculas, sin acentos ni símbolos, como mucho 60 caracteres.
 */
export function slugify(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/g, '');
}

/** Sufijo aleatorio (8 caracteres hexadecimales) para que cada archivo sea único e inmutable. */
export function randomSuffix(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(4));
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** `mixes/<slug>-<sufijo>.<ext>`, como las rutas de scripts/add-mix.mjs (D46). */
export function uploadKey(title: string, ext: string, suffix: string = randomSuffix()): string {
  const slug = slugify(title) || 'mix';
  return `mixes/${slug}-${suffix}.${ext}`;
}

/**
 * ¿La ruta es un archivo que ha subido el panel o scripts/add-mix.mjs?
 * Solo esos se pueden borrar desde el panel.
 */
export function isMixObjectKey(key: string): boolean {
  return /^mixes\/[a-z0-9][a-z0-9._-]*$/.test(key) && !key.includes('..');
}
