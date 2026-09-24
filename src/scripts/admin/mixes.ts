/**
 * Subida de mixes desde el panel (P2, fase 6).
 *
 * 1. Mide la duración del audio en el navegador.
 * 2. Pide al servidor una URL firmada de R2 (`admin.mixUploadUrl`): el Worker
 *    decide el nombre del archivo y nunca recibe el audio.
 * 3. Sube el archivo directamente a R2 con un PUT (con barra de progreso).
 * 4. Crea la fila en `mixes` (`admin.createMix`).
 */
import { ADMIN_TEXT as TEXT } from '../../config/admin';
import {
  callAdminAction,
  clearFieldErrors,
  handleUnauthorized,
  refreshRegions,
  setBusy,
  showFieldErrors,
  showFormError,
  toast,
} from './ui';

const TYPES_BY_EXTENSION: Record<string, string> = {
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  png: 'image/png',
};

function contentTypeOf(file: File): string {
  if (file.type) return file.type;
  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
  return TYPES_BY_EXTENSION[ext] ?? 'application/octet-stream';
}

/** Duración en segundos (o `undefined` si el navegador no la sabe leer). */
function measureDuration(file: File): Promise<number | undefined> {
  return new Promise((resolve) => {
    const audio = document.createElement('audio');
    const url = URL.createObjectURL(file);
    const done = (value: number | undefined) => {
      URL.revokeObjectURL(url);
      audio.removeAttribute('src');
      resolve(value);
    };
    const timer = window.setTimeout(() => done(undefined), 15_000);
    audio.preload = 'metadata';
    audio.addEventListener('loadedmetadata', () => {
      window.clearTimeout(timer);
      done(Number.isFinite(audio.duration) && audio.duration > 0 ? Math.round(audio.duration) : undefined);
    });
    audio.addEventListener('error', () => {
      window.clearTimeout(timer);
      done(undefined);
    });
    audio.src = url;
  });
}

interface UploadTicket {
  key: string;
  url: string;
  headers: Record<string, string>;
}

/** PUT a la URL firmada, con progreso (fetch no da progreso de subida). */
function put(ticket: UploadTicket, file: File, onProgress: (fraction: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open('PUT', ticket.url);
    for (const [name, value] of Object.entries(ticket.headers)) request.setRequestHeader(name, value);
    request.upload.addEventListener('progress', (event) => {
      if (event.lengthComputable) onProgress(event.loaded / event.total);
    });
    request.addEventListener('load', () => {
      if (request.status >= 200 && request.status < 300) resolve();
      else reject(new Error(`R2 ha respondido ${request.status}`));
    });
    request.addEventListener('error', () => reject(new Error('No se ha podido conectar con R2 (¿CORS?).')));
    request.send(file);
  });
}

class FieldError extends Error {
  constructor(
    readonly field: string,
    message: string,
  ) {
    super(message);
  }
}

async function upload(
  form: HTMLFormElement,
  kind: 'audio' | 'artwork',
  file: File,
  title: string,
  onProgress: (fraction: number) => void,
): Promise<string> {
  const data = new FormData();
  data.set('titulo', title);
  data.set('tipo', kind);
  data.set('contentType', contentTypeOf(file));
  data.set('size', String(file.size));
  const outcome = await callAdminAction<UploadTicket>('mixUploadUrl', data);
  if (outcome.error) {
    if (handleUnauthorized(outcome)) throw new Error('');
    if (outcome.error.fields) {
      showFieldErrors(form, outcome.error.fields);
      throw new Error('');
    }
    throw new FieldError(kind === 'audio' ? 'audio' : 'caratula', outcome.error.message);
  }
  await put(outcome.data!, file, onProgress);
  return outcome.data!.key;
}

function setupUpload(form: HTMLFormElement): void {
  const progress = form.querySelector<HTMLProgressElement>('[data-upload-progress]');
  const status = form.querySelector<HTMLElement>('[data-upload-status]');
  const say = (text: string) => {
    if (status) status.textContent = text;
  };

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (form.getAttribute('aria-busy') !== null) return;
    void (async () => {
      clearFieldErrors(form);
      const audio = form.querySelector<HTMLInputElement>('input[name="archivo"]')?.files?.[0];
      const artwork = form.querySelector<HTMLInputElement>('input[name="imagen"]')?.files?.[0];
      const title = (form.querySelector<HTMLInputElement>('input[name="titulo"]')?.value ?? '').trim();
      const errors: Record<string, string[]> = {};
      if (!audio) errors.audio = ['Elige el archivo de audio.'];
      if (!title) errors.titulo = ['Escribe un título.'];
      if (Object.keys(errors).length > 0) {
        showFieldErrors(form, errors);
        return;
      }

      setBusy(form, true, 'subiendo…');
      if (progress) {
        progress.hidden = false;
        progress.value = 0;
      }
      try {
        say('Midiendo la duración…');
        const duration = await measureDuration(audio!);
        say('Subiendo el audio…');
        const audioKey = await upload(form, 'audio', audio!, title, (fraction) => {
          if (progress) progress.value = Math.round(fraction * (artwork ? 90 : 100));
        });
        let artworkKey: string | undefined;
        if (artwork) {
          say('Subiendo la carátula…');
          artworkKey = await upload(form, 'artwork', artwork, title, (fraction) => {
            if (progress) progress.value = 90 + Math.round(fraction * 10);
          });
        }

        say('Guardando…');
        const data = new FormData(form);
        data.delete('archivo');
        data.delete('imagen');
        data.set('audio', audioKey);
        if (artworkKey) data.set('caratula', artworkKey);
        if (duration) data.set('duracion', String(duration));
        const outcome = await callAdminAction('createMix', data);
        if (outcome.error) {
          if (handleUnauthorized(outcome)) return;
          if (outcome.error.fields) showFieldErrors(form, outcome.error.fields);
          else showFormError(form, outcome.error.message || TEXT.saveFailed);
          return;
        }
        say('');
        toast(TEXT.saved, 'ok');
        form.reset();
        const regions = (form.dataset.refresh ?? '').split(/\s+/).filter(Boolean);
        await refreshRegions(regions);
      } catch (error) {
        say('');
        if (error instanceof FieldError) showFieldErrors(form, { [error.field]: [error.message] });
        else if (error instanceof Error && error.message) showFormError(form, error.message);
      } finally {
        setBusy(form, false);
        if (progress) progress.hidden = true;
      }
    })();
  });
}

export function setupMixes(): void {
  const form = document.querySelector<HTMLFormElement>('[data-mix-upload]');
  if (form) setupUpload(form);
}
