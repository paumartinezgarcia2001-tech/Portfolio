/**
 * Subida de mixes desde el panel (D64).
 *
 * 1. Prepara la carátula (JPEG cuadrado de 1000 px).
 * 2. Calcula cuánto ocupará el MP3 y pregunta al servidor si cabe en R2
 *    (`admin.storageUsage`). Si no cabe, no convierte nada.
 * 3. Convierte el audio a MP3 320 kbps a −14 LUFS en el navegador
 *    (audio/convert.ts). Si este navegador no puede y el original ya es
 *    MP3/M4A, lo sube tal cual (sin normalizar) y lo dice.
 * 4. Pide al servidor una URL firmada de R2 (`admin.mixUploadUrl`): el Worker
 *    vuelve a medir R2, decide el nombre del archivo y nunca recibe el audio.
 * 5. Sube el archivo directamente a R2 con un PUT (con barra de progreso).
 * 6. Crea la fila en `mixes` (`admin.createMix`), que comprueba en R2 lo
 *    subido: desde ese momento suena en la web si está publicado.
 */
import { ADMIN_LIMITS, ADMIN_TEXT as TEXT } from '../../config/admin';
import { formatStorageBytes } from '../../lib/admin/storage';
import { convertArtwork } from './artwork';
import { convertMix, estimateDuration, estimateMp3Bytes, playableDuration, uploadableAsIs } from './audio/convert';
import { checkStorage, refreshStorage } from './storage';
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

interface UploadTicket {
  key: string;
  url: string;
  headers: Record<string, string>;
}

/** PUT a la URL firmada, con progreso (fetch no da progreso de subida). */
function put(ticket: UploadTicket, file: Blob, onProgress: (fraction: number) => void): Promise<void> {
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
  file: Blob,
  contentType: string,
  title: string,
  reserve: number,
  onProgress: (fraction: number) => void,
): Promise<string> {
  const data = new FormData();
  data.set('titulo', title);
  data.set('tipo', kind);
  data.set('contentType', contentType);
  data.set('size', String(file.size));
  if (reserve > 0) data.set('reserva', String(reserve));
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

const percent = (fraction: number) => `${Math.round(fraction * 100)} %`;

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

      if (audio!.size > ADMIN_LIMITS.mixSourceMaxBytes) {
        showFieldErrors(form, { audio: [`El archivo pasa de ${formatStorageBytes(ADMIN_LIMITS.mixSourceMaxBytes)}.`] });
        return;
      }
      if (artwork && artwork.size > ADMIN_LIMITS.artworkSourceMaxBytes) {
        showFieldErrors(form, { caratula: [`La imagen pasa de ${formatStorageBytes(ADMIN_LIMITS.artworkSourceMaxBytes)}.`] });
        return;
      }

      setBusy(form, true, 'preparando…');
      const setProgress = (value: number) => {
        if (progress) progress.value = Math.round(value * 100);
      };
      if (progress) {
        progress.hidden = false;
        progress.value = 0;
      }
      try {
        // 1. Carátula
        let cover: Blob | undefined;
        if (artwork) {
          say('Preparando la carátula…');
          try {
            cover = (await convertArtwork(artwork)).blob;
          } catch (error) {
            throw new FieldError('caratula', (error as Error).message);
          }
        }

        // 2. ¿Cabe? (con lo que ocupará el MP3, antes de ponerse a convertir)
        say('Comprobando el espacio de R2…');
        const seconds = await estimateDuration(audio!);
        const estimate = (seconds ? estimateMp3Bytes(seconds) : Math.min(audio!.size, ADMIN_LIMITS.mixMaxBytes)) + (cover?.size ?? 0);
        const noRoom = await checkStorage(estimate);
        if (noRoom) throw new FieldError('audio', noRoom);

        // 3. Convertir
        let ready: { blob: Blob; type: string; duration: number | undefined };
        let note = '';
        try {
          const converted = await convertMix(audio!, (fraction, label) => {
            say(`${label} ${percent(fraction)}`);
            setProgress(fraction * 0.6);
          });
          ready = { blob: converted.blob, type: 'audio/mpeg', duration: Math.round(converted.duration) };
          if (converted.plan.peakLimited) note = ' Ha quedado algo más bajo que −14 LUFS para no saturar los picos.';
        } catch (error) {
          const asIs = uploadableAsIs(audio!);
          if (!asIs || audio!.size > ADMIN_LIMITS.mixMaxBytes) {
            throw new FieldError(
              'audio',
              `${(error as Error).message} Prueba en Chrome o Firefox de escritorio, o expórtalo a MP3 antes de subirlo.`,
            );
          }
          const duration = await playableDuration(audio!);
          if (!duration) throw new FieldError('audio', 'El navegador no puede reproducir este archivo: expórtalo a MP3.');
          ready = { blob: audio!, type: asIs, duration: Math.round(duration) };
          note = ' No se ha podido convertir en este navegador: se ha subido tal cual, sin normalizar el volumen.';
        }
        if (ready.blob.size > ADMIN_LIMITS.mixMaxBytes) {
          throw new FieldError('audio', `El MP3 pasa de ${formatStorageBytes(ADMIN_LIMITS.mixMaxBytes)}: el mix es demasiado largo.`);
        }

        // 4–5. Subir (el servidor vuelve a comprobar que cabe todo: audio + carátula)
        say('Subiendo el audio…');
        const audioKey = await upload(form, 'audio', ready.blob, ready.type, title, cover?.size ?? 0, (fraction) => {
          say(`Subiendo el audio… ${percent(fraction)}`);
          setProgress(0.6 + fraction * (cover ? 0.36 : 0.4));
        });
        let artworkKey: string | undefined;
        if (cover) {
          say('Subiendo la carátula…');
          artworkKey = await upload(form, 'artwork', cover, 'image/jpeg', title, 0, (fraction) => {
            setProgress(0.96 + fraction * 0.04);
          });
        }
        const duration = ready.duration;

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
        toast(`${TEXT.saved}${note}`, 'ok');
        form.reset();
        void refreshStorage();
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
