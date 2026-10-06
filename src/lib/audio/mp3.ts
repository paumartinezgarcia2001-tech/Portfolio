/**
 * MP3 con LAME compilado a WebAssembly (`wasm-media-encoders`, D64): el
 * mismo codificador que usa ffmpeg en `npm run media:mix`, a 320 kbps CBR.
 *
 * LAME remuestrea por su cuenta: un WAV a 96 kHz sale a 48 kHz y uno a
 * 88,2 kHz, a 44,1 kHz. Sin DOM: corre en el navegador (panel) y en los tests.
 */
import { createEncoder, type WasmMediaEncoder } from 'wasm-media-encoders';

type Mp3Rate = 32000 | 44100 | 48000;

/** Frecuencia del MP3: 44,1 kHz para la familia de 44,1; 32 kHz se queda; el resto, 48 kHz. */
export function mp3SampleRate(input: number): Mp3Rate {
  if (input % 11025 === 0) return 44100;
  if (input === 32000) return 32000;
  return 48000;
}

export interface Mp3WriterOptions {
  sampleRate: number;
  channels: number;
  /** kbps (CBR). */
  bitrate: 320 | 256 | 192 | 128;
  /** Ganancia lineal que se aplica antes de codificar. */
  gain?: number;
}

export interface Mp3Writer {
  /** Codifica un trozo (un `Float32Array` por canal). */
  write(channels: Float32Array[]): void;
  /** Termina y devuelve los trozos del MP3. */
  finish(): Uint8Array[];
  /** Bytes escritos hasta ahora. */
  readonly bytes: number;
}

/** `wasm`: URL del `mp3.wasm` (navegador) o sus bytes (tests). */
export async function createMp3Writer(wasm: string | ArrayBuffer | Uint8Array, options: Mp3WriterOptions): Promise<Mp3Writer> {
  const encoder: WasmMediaEncoder<'audio/mpeg'> = await createEncoder('audio/mpeg', wasm);
  const channels = (options.channels >= 2 ? 2 : 1) as 1 | 2;
  encoder.configure({
    sampleRate: options.sampleRate,
    channels,
    bitrate: options.bitrate,
    outputSampleRate: mp3SampleRate(options.sampleRate),
  });
  const gain = options.gain ?? 1;
  const parts: Uint8Array[] = [];
  let bytes = 0;
  const keep = (chunk: Uint8Array) => {
    if (chunk.length === 0) return;
    // El codificador reutiliza su memoria: hay que copiar.
    parts.push(chunk.slice());
    bytes += chunk.length;
  };
  return {
    write(input) {
      const used = input.slice(0, channels);
      if (gain !== 1) {
        for (const data of used) {
          for (let i = 0; i < data.length; i++) {
            const value = data[i]! * gain;
            data[i] = value > 1 ? 1 : value < -1 ? -1 : value;
          }
        }
      }
      keep(encoder.encode(used));
    },
    finish() {
      keep(encoder.finalize());
      return parts;
    },
    get bytes() {
      return bytes;
    },
  };
}
