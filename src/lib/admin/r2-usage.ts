/**
 * Cuánto ocupa el bucket de R2 (D64), medido de verdad: lista todos los
 * objetos con `ListObjectsV2` (API S3, URL firmada con las claves del panel)
 * y suma sus tamaños. Cada página son 1000 objetos; el bucket tiene unos
 * cientos (los segmentos del vídeo y los mixes), así que es una o dos
 * peticiones.
 *
 * Se mide cada vez (al pintar cada página del panel, antes de firmar cada
 * subida y al guardar el mix): así el porcentaje es siempre el de ahora.
 * Listar es una operación de clase A de R2 (1 millón al mes gratis): el panel
 * hace unas pocas por visita.
 */
import { presignR2, type R2Credentials } from './r2';
import { parseListObjectsPage, storageStatus, type StorageStatus } from './storage';

/** Como mucho tantas páginas (1000 objetos cada una): por si algo se tuerce. */
const MAX_PAGES = 40;
const TIMEOUT_MS = 8000;

export type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;

export interface MeasureOptions {
  fetcher?: Fetcher;
}

/** Suma los tamaños de todos los objetos del bucket. Lanza si R2 no responde bien. */
export async function measureStorage(credentials: R2Credentials, options: MeasureOptions = {}): Promise<StorageStatus> {
  const fetcher: Fetcher = options.fetcher ?? ((url, init) => fetch(url, init));

  let bytes = 0;
  let objects = 0;
  let token: string | undefined;
  for (let page = 0; page < MAX_PAGES; page++) {
    const query: Record<string, string> = { 'list-type': '2', 'max-keys': '1000' };
    if (token) query['continuation-token'] = token;
    const url = await presignR2(credentials, 'GET', '', 60, { query });
    const response = await fetcher(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!response.ok) throw new Error(`R2 ha respondido ${response.status} al listar el bucket`);
    const result = parseListObjectsPage(await response.text());
    bytes += result.bytes;
    objects += result.objects;
    if (!result.truncated || !result.nextToken) {
      return storageStatus(bytes, objects);
    }
    token = result.nextToken;
  }
  throw new Error(`El bucket tiene más de ${MAX_PAGES * 1000} objetos: no se ha podido medir entero`);
}

/** Tamaño de un objeto (`HEAD`), o `null` si no existe. */
export async function objectSize(
  credentials: R2Credentials,
  key: string,
  fetcher: Fetcher = (url, init) => fetch(url, init),
): Promise<number | null> {
  const url = await presignR2(credentials, 'HEAD', key, 60);
  const response = await fetcher(url, { method: 'HEAD', signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`R2 ha respondido ${response.status} al comprobar ${key}`);
  const length = Number(response.headers.get('content-length'));
  return Number.isFinite(length) ? length : null;
}

/** Borra un objeto (`DELETE`). `true` si ya no está. */
export async function deleteObject(
  credentials: R2Credentials,
  key: string,
  fetcher: Fetcher = (url, init) => fetch(url, init),
): Promise<boolean> {
  try {
    const url = await presignR2(credentials, 'DELETE', key, 60);
    const response = await fetcher(url, { method: 'DELETE', signal: AbortSignal.timeout(TIMEOUT_MS) });
    return response.ok || response.status === 404;
  } catch {
    return false;
  }
}
