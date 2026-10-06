/**
 * Credenciales de R2 del panel, de los secrets del Worker. `null` si falta
 * alguno (el panel funciona igual, pero sin subir mixes ni medir R2).
 */
import { R2_ACCESS_KEY_ID, R2_ACCOUNT_ID, R2_BUCKET, R2_ENDPOINT, R2_SECRET_ACCESS_KEY } from 'astro:env/server';
import type { R2Credentials } from './r2';

export function r2Credentials(): R2Credentials | null {
  if ((!R2_ACCOUNT_ID && !R2_ENDPOINT) || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY || !R2_BUCKET) return null;
  return {
    accountId: R2_ACCOUNT_ID ?? '',
    accessKeyId: R2_ACCESS_KEY_ID,
    secretAccessKey: R2_SECRET_ACCESS_KEY,
    bucket: R2_BUCKET,
    endpoint: R2_ENDPOINT,
  };
}

export const R2_MISSING = 'Falta configurar R2 (R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY y R2_BUCKET).';
