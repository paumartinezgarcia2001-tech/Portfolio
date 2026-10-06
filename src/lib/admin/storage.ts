/**
 * Almacenamiento de R2 (D64): cuánto ocupa el bucket, cuánto queda hasta el
 * límite y si algo cabe antes de subirlo. Funciones puras (sin red): las
 * prueban los tests unitarios y las usan el servidor, el navegador y los
 * scripts.
 */
import { R2_STORAGE } from '../../config/admin';

export type StorageLevel = 'ok' | 'warn' | 'full';

export interface StorageStatus {
  /** Bytes que ocupan todos los objetos del bucket. */
  usedBytes: number;
  /** Número de objetos. */
  objects: number;
  limitBytes: number;
  /** 0 – 1 (puede pasar de 1 si alguien sube por fuera del panel). */
  fraction: number;
  /** Porcentaje con un decimal, para enseñarlo. */
  percent: number;
  /** `warn` desde el 80 %; `full` al llegar al límite. */
  level: StorageLevel;
  /** Lo que aún cabe (0 si ya no cabe nada). */
  freeBytes: number;
}

export function storageStatus(
  usedBytes: number,
  objects = 0,
  limitBytes: number = R2_STORAGE.limitBytes,
  warnFraction: number = R2_STORAGE.warnFraction,
): StorageStatus {
  const used = Math.max(0, Math.round(usedBytes));
  const fraction = limitBytes > 0 ? used / limitBytes : 1;
  const level: StorageLevel = fraction >= 1 ? 'full' : fraction >= warnFraction ? 'warn' : 'ok';
  return {
    usedBytes: used,
    objects,
    limitBytes,
    fraction,
    // Un decimal. Nunca «0 %» con algo dentro ni «100 %» sin estar lleno.
    percent:
      used === 0
        ? 0
        : fraction >= 1
          ? Math.floor(fraction * 1000) / 10
          : Math.min(99.9, Math.max(0.1, Math.round(fraction * 1000) / 10)),
    level,
    freeBytes: Math.max(0, limitBytes - used),
  };
}

/** ¿Caben `incomingBytes` más sin pasar del límite? */
export function fitsInStorage(status: Pick<StorageStatus, 'usedBytes' | 'limitBytes'>, incomingBytes: number): boolean {
  return status.usedBytes + Math.max(0, incomingBytes) <= status.limitBytes;
}

/** 1 234 567 → «1,2 MB» (unidades de 1000, como Cloudflare). */
export function formatStorageBytes(bytes: number): string {
  const units = ['B', 'kB', 'MB', 'GB', 'TB'];
  let value = Math.max(0, bytes);
  let unit = 0;
  while (value >= 1000 && unit < units.length - 1) {
    value /= 1000;
    unit++;
  }
  const digits = unit === 0 || value >= 100 ? 0 : 1;
  // «10 GB», no «10,0 GB»; «2,3 GB».
  return `${value.toLocaleString('es-ES', { maximumFractionDigits: digits })} ${units[unit]}`;
}

/** «2,3 GB de 10 GB (23 %)». */
export function describeStorage(status: StorageStatus): string {
  const percent = status.percent.toLocaleString('es-ES', { maximumFractionDigits: 1 });
  return `${formatStorageBytes(status.usedBytes)} de ${formatStorageBytes(status.limitBytes)} (${percent} %)`;
}

/** Mensaje cuando algo no cabe. */
export function noRoomMessage(status: StorageStatus, incomingBytes: number): string {
  return (
    `No cabe: R2 ya tiene ${describeStorage(status)} y esto ocupa ${formatStorageBytes(incomingBytes)}. ` +
    `Quedan ${formatStorageBytes(status.freeBytes)}. Borra algún mix antes de subir más.`
  );
}

export interface ListPage {
  bytes: number;
  objects: number;
  truncated: boolean;
  nextToken: string | undefined;
}

function unescapeXml(text: string): string {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

/**
 * Una página de `ListObjectsV2` (XML de la API S3): suma los `<Size>` de
 * cada `<Contents>` y devuelve el token de la siguiente página.
 */
export function parseListObjectsPage(xml: string): ListPage {
  if (!/<ListBucketResult[\s>]/.test(xml)) throw new Error('R2 no ha devuelto un listado (ListBucketResult)');
  let bytes = 0;
  let objects = 0;
  for (const match of xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)) {
    const size = /<Size>(\d+)<\/Size>/.exec(match[1] ?? '');
    bytes += size ? Number(size[1]) : 0;
    objects++;
  }
  const truncated = /<IsTruncated>\s*true\s*<\/IsTruncated>/i.test(xml);
  const token = /<NextContinuationToken>([\s\S]*?)<\/NextContinuationToken>/.exec(xml)?.[1];
  return { bytes, objects, truncated, nextToken: token ? unescapeXml(token) : undefined };
}
