/**
 * D64 · La barra de almacenamiento de R2 (src/components/admin/StorageMeter.astro).
 *
 * - `refreshStorage()` la vuelve a medir (tras subir o borrar un mix).
 * - `checkStorage(bytes)` pregunta al servidor si caben `bytes` más, antes de
 *   ponerse a convertir: el servidor lo vuelve a comprobar al firmar la subida.
 */
import { describeStorage, type StorageStatus } from '../../lib/admin/storage';
import { callAdminAction } from './ui';

interface StorageReport {
  configured: boolean;
  status: StorageStatus | null;
  fits: boolean;
  message?: string;
}

export function paintStorage(status: StorageStatus | null, failed = false): void {
  const root = document.querySelector<HTMLElement>('[data-storage]');
  if (!root) return;
  const text = root.querySelector<HTMLElement>('[data-storage-text]');
  const note = root.querySelector<HTMLElement>('[data-storage-note]');
  const meter = root.querySelector<HTMLElement>('[data-storage-meter]');
  const fill = root.querySelector<HTMLElement>('[data-storage-fill]');
  if (!status) {
    if (failed) {
      root.dataset.level = 'unknown';
      if (text) text.textContent = 'no se ha podido medir: no se puede subir nada';
    }
    return;
  }
  const description = describeStorage(status);
  root.dataset.level = status.level;
  root.dataset.usedBytes = String(status.usedBytes);
  if (text) text.textContent = description;
  if (note) {
    note.textContent =
      status.level === 'full' ? '· lleno: borra algo antes de subir más' : status.level === 'warn' ? '· casi lleno' : '';
  }
  if (meter) {
    meter.setAttribute('aria-valuenow', String(Math.min(100, Math.round(status.fraction * 1000) / 10)));
    meter.setAttribute('aria-valuetext', description);
  }
  if (fill) fill.style.width = `${Math.min(100, status.fraction * 100)}%`;
}

async function ask(bytes?: number): Promise<StorageReport | null> {
  const data = new FormData();
  if (bytes !== undefined) data.set('bytes', String(Math.ceil(bytes)));
  const outcome = await callAdminAction<StorageReport>('storageUsage', data);
  if (outcome.error || !outcome.data) return null;
  const report = outcome.data;
  if (report.configured) paintStorage(report.status, !report.status);
  return report;
}

export async function refreshStorage(): Promise<void> {
  await ask();
}

/** `null` si caben; si no, el mensaje que hay que enseñar. */
export async function checkStorage(bytes: number): Promise<string | null> {
  const report = await ask(bytes);
  if (!report) return 'No se ha podido comprobar el espacio de R2. Inténtalo de nuevo.';
  if (!report.configured) return report.message ?? 'Falta configurar R2.';
  return report.fits ? null : (report.message ?? 'No cabe en R2.');
}
