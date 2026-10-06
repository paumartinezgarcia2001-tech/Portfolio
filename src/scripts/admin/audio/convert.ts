/**
 * Conversión de los mixes en el navegador (D64), lo mismo que hace
 * `npm run media:mix` en el ordenador:
 *
 * 1. Lee el audio: WAV y AIFF por trozos (src/lib/audio/pcm.ts), sin cargarlo
 *    entero; MP3, M4A, FLAC, OGG… con el decodificador del navegador
 *    (`decodeAudioData`, que sí lo carga entero: un mix de dos horas puede no
 *    caber en la memoria de un móvil).
 * 2. Primera pasada: mide la sonoridad integrada (BS.1770) y el pico.
 * 3. Segunda pasada: aplica una ganancia fija para dejarlo a −14 LUFS sin que
 *    los picos pasen de −1,5 dBFS y lo codifica a MP3 320 kbps (LAME).
 * 4. Comprueba que el navegador sabe reproducir el MP3 resultante.
 *
 * Se hace por trozos de 5 s y entre trozo y trozo se devuelve el control al
 * navegador: la página no se congela y la barra de progreso avanza. (No va en
 * un Worker porque la CSP de los archivos estáticos no deja compilar
 * WebAssembly; la del panel, sí: `'wasm-unsafe-eval'`.)
 */
import wasmUrl from 'wasm-media-encoders/wasm/mp3?url';
import { MIX_ENCODING } from '../../../config/admin';
import { LoudnessMeter, planGain, type GainPlan } from '../../../lib/audio/loudness';
import { createMp3Writer } from '../../../lib/audio/mp3';
import { decodePcm, parsePcmHeader, type PcmFormat } from '../../../lib/audio/pcm';

/** Segundos de audio por trozo. */
const CHUNK_SECONDS = 5;
/** Lo que se lee del principio del archivo para encontrar la cabecera. */
const HEADER_BYTES = 1024 * 1024;

export type Progress = (fraction: number, label: string) => void;

interface AudioSource {
  sampleRate: number;
  channels: number;
  duration: number;
  chunks(): AsyncGenerator<Float32Array[]>;
}

export interface ConvertedMix {
  blob: Blob;
  /** Segundos. */
  duration: number;
  plan: GainPlan;
}

/** Cabecera WAV/AIFF, o `null` si es otro formato. */
async function readPcmFormat(file: File): Promise<PcmFormat | null> {
  try {
    return parsePcmHeader(await file.slice(0, HEADER_BYTES).arrayBuffer(), file.size);
  } catch (error) {
    // Es WAV/AIFF pero no se puede leer: mejor decirlo que probar otra cosa.
    throw new Error(`No se puede leer el archivo: ${(error as Error).message}.`, { cause: error });
  }
}

function pcmSource(file: File, format: PcmFormat): AudioSource {
  const chunkBytes = Math.max(1, Math.round(format.sampleRate * CHUNK_SECONDS)) * format.frameBytes;
  return {
    sampleRate: format.sampleRate,
    channels: Math.min(2, format.channels),
    duration: format.duration,
    async *chunks() {
      const end = format.dataOffset + format.dataLength;
      for (let start = format.dataOffset; start < end; start += chunkBytes) {
        const bytes = await file.slice(start, Math.min(end, start + chunkBytes)).arrayBuffer();
        yield decodePcm(bytes, format).slice(0, 2);
      }
    },
  };
}

async function decodedSource(file: File): Promise<AudioSource> {
  const OfflineContext = window.OfflineAudioContext ?? (window as unknown as { webkitOfflineAudioContext?: typeof OfflineAudioContext }).webkitOfflineAudioContext;
  if (!OfflineContext) throw new Error('Este navegador no sabe decodificar audio.');
  // El contexto fija la frecuencia a la que se decodifica: 44,1 kHz, la de casi todos los mixes.
  const context = new OfflineContext(2, 1, 44100);
  let buffer: AudioBuffer;
  try {
    buffer = await context.decodeAudioData(await file.arrayBuffer());
  } catch {
    throw new Error('El navegador no sabe leer este archivo (o no cabe en memoria).');
  }
  const frames = Math.round(buffer.sampleRate * CHUNK_SECONDS);
  const channels = Math.min(2, buffer.numberOfChannels);
  return {
    sampleRate: buffer.sampleRate,
    channels,
    duration: buffer.duration,
    async *chunks() {
      for (let start = 0; start < buffer.length; start += frames) {
        const size = Math.min(frames, buffer.length - start);
        yield Array.from({ length: channels }, (_, c) => {
          const data = new Float32Array(size);
          buffer.copyFromChannel(data, c, start);
          return data;
        });
      }
    },
  };
}

/** Duración en segundos que lee el navegador (o `undefined`). También dice si lo sabe reproducir. */
export function playableDuration(blob: Blob, timeoutMs = 15_000): Promise<number | undefined> {
  return new Promise((resolve) => {
    const audio = document.createElement('audio');
    const url = URL.createObjectURL(blob);
    const done = (value: number | undefined) => {
      window.clearTimeout(timer);
      URL.revokeObjectURL(url);
      audio.removeAttribute('src');
      resolve(value);
    };
    const timer = window.setTimeout(() => done(undefined), timeoutMs);
    audio.preload = 'metadata';
    audio.addEventListener('loadedmetadata', () =>
      done(Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : undefined),
    );
    audio.addEventListener('error', () => done(undefined));
    audio.src = url;
  });
}

/**
 * Duración aproximada antes de convertir (para ver si cabrá en R2): la de la
 * cabecera si es WAV/AIFF; si no, la que lee el navegador.
 */
export async function estimateDuration(file: File): Promise<number | undefined> {
  const format = await readPcmFormat(file).catch(() => null);
  if (format) return format.duration;
  return playableDuration(file);
}

/** Bytes de un MP3 a 320 kbps de `seconds` (con un 2 % de margen). */
export function estimateMp3Bytes(seconds: number): number {
  return Math.ceil(((seconds * MIX_ENCODING.bitrate * 1000) / 8) * 1.02) + 64 * 1024;
}

/** Deja respirar al navegador (pintar la barra, responder a clics). */
const breathe = () => new Promise<void>((resolve) => window.setTimeout(resolve, 0));

/** Convierte el mix a MP3 320 kbps a −14 LUFS. Lanza si no se puede. */
export async function convertMix(file: File, onProgress: Progress): Promise<ConvertedMix> {
  onProgress(0, 'Leyendo el audio…');
  const format = await readPcmFormat(file);
  const source = format ? pcmSource(file, format) : await decodedSource(file);
  if (!(source.duration > 0)) throw new Error('El archivo no tiene audio.');

  const total = Math.max(1, source.duration);

  // 1. Medir
  const meter = new LoudnessMeter(source.sampleRate, source.channels);
  let done = 0;
  for await (const chunk of source.chunks()) {
    meter.push(chunk);
    done += (chunk[0]?.length ?? 0) / source.sampleRate;
    onProgress(0.3 * Math.min(1, done / total), 'Midiendo el volumen…');
    await breathe();
  }
  const plan = planGain(meter.integrated(), meter.peak, MIX_ENCODING.targetLufs, MIX_ENCODING.peakCeilingDb);
  if (!Number.isFinite(plan.measuredLufs)) throw new Error('El archivo está en silencio.');

  // 2. Codificar
  const writer = await createMp3Writer(wasmUrl, {
    sampleRate: source.sampleRate,
    channels: source.channels,
    bitrate: MIX_ENCODING.bitrate,
    gain: plan.gain,
  });
  done = 0;
  for await (const chunk of source.chunks()) {
    writer.write(chunk);
    done += (chunk[0]?.length ?? 0) / source.sampleRate;
    onProgress(0.3 + 0.7 * Math.min(1, done / total), 'Convirtiendo a MP3…');
    await breathe();
  }
  const blob = new Blob(writer.finish() as BlobPart[], { type: 'audio/mpeg' });

  // 3. ¿Lo sabe reproducir el navegador?
  onProgress(1, 'Comprobando el MP3…');
  const duration = await playableDuration(blob);
  if (!duration) throw new Error('El MP3 convertido no se puede reproducir.');
  return { blob, duration, plan };
}

/** ¿Se puede subir tal cual si no se puede convertir? (MP3 o M4A/AAC: suenan en todos los navegadores.) */
export function uploadableAsIs(file: File): string | null {
  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
  const type = file.type.toLowerCase();
  if (type === 'audio/mpeg' || type === 'audio/mp3' || ext === 'mp3') return 'audio/mpeg';
  if (type === 'audio/mp4' || type === 'audio/x-m4a' || ext === 'm4a') return 'audio/mp4';
  if (type === 'audio/aac' || ext === 'aac') return 'audio/aac';
  return null;
}
