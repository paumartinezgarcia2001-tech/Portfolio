// @ts-check
/**
 * Límite de almacenamiento de R2 para los scripts (D64): el mismo que el
 * panel (`R2_STORAGE` en src/config/admin.ts). El plan gratuito de R2 incluye
 * 10 GB al mes; se cuenta en unidades de 1000³ bytes.
 */
export const STORAGE_LIMIT_BYTES = 10 * 1000 * 1000 * 1000;
export const STORAGE_WARN_FRACTION = 0.8;

/**
 * ¿Caben `incoming` bytes más? (Pueden ser negativos si se sustituyen
 * archivos por otros más pequeños.)
 * @param {number} usedBytes
 * @param {number} incoming
 * @param {number} [limit]
 */
export function storageVerdict(usedBytes, incoming, limit = STORAGE_LIMIT_BYTES) {
  const afterBytes = usedBytes + incoming;
  const pct = (/** @type {number} */ bytes) =>
    (Math.ceil((bytes / limit) * 1000) / 10).toLocaleString('es-ES', { maximumFractionDigits: 1 });
  return {
    fits: incoming <= 0 || afterBytes <= limit,
    before: usedBytes / limit,
    after: afterBytes / limit,
    percentBefore: pct(usedBytes),
    percentAfter: pct(Math.max(0, afterBytes)),
  };
}
