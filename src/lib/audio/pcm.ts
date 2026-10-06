/**
 * WAV y AIFF sin descomprimir nada (D64): se leen las cabeceras y luego el
 * audio por trozos, así un WAV de una hora (más de 600 MB) no tiene que
 * caber entero en memoria. Es lo que suelen exportar los programas de DJ.
 *
 * - WAV: PCM entero de 8, 16, 24 y 32 bits, coma flotante de 32 y 64, y
 *   WAVE_FORMAT_EXTENSIBLE.
 * - AIFF / AIFF-C: PCM entero big-endian, `sowt` (little-endian) y `fl32`/`fl64`.
 *
 * Funciones puras: las prueban los tests unitarios.
 */

export interface PcmFormat {
  container: 'wav' | 'aiff';
  sampleRate: number;
  channels: number;
  bitsPerSample: number;
  encoding: 'int' | 'float';
  littleEndian: boolean;
  /** Byte donde empieza el audio. */
  dataOffset: number;
  /** Bytes de audio (se recorta al tamaño real del archivo). */
  dataLength: number;
  /** Bytes por muestra de todos los canales. */
  frameBytes: number;
  /** Duración en segundos. */
  duration: number;
}

const ascii = (view: DataView, offset: number) =>
  String.fromCharCode(view.getUint8(offset), view.getUint8(offset + 1), view.getUint8(offset + 2), view.getUint8(offset + 3));

/** Número de 80 bits (IEEE 754 extendido, big-endian) de la cabecera AIFF. */
export function readExtended(view: DataView, offset: number): number {
  const exponentWord = view.getUint16(offset);
  const sign = exponentWord & 0x8000 ? -1 : 1;
  const exponent = exponentWord & 0x7fff;
  const hi = view.getUint32(offset + 2);
  const lo = view.getUint32(offset + 6);
  if (exponent === 0 && hi === 0 && lo === 0) return 0;
  const mantissa = hi * 2 ** 32 + lo;
  return sign * mantissa * 2 ** (exponent - 16383 - 63);
}

function finish(
  format: Omit<PcmFormat, 'frameBytes' | 'duration' | 'dataLength'> & { dataLength: number },
  fileSize: number,
): PcmFormat {
  const { channels, bitsPerSample, sampleRate, encoding } = format;
  if (!(channels >= 1 && channels <= 32)) throw new Error(`Número de canales no válido: ${channels}`);
  if (!(sampleRate >= 8000 && sampleRate <= 384_000)) throw new Error(`Frecuencia de muestreo no válida: ${sampleRate}`);
  const validBits = encoding === 'float' ? [32, 64] : [8, 16, 24, 32];
  if (!validBits.includes(bitsPerSample)) throw new Error(`Formato no admitido: ${bitsPerSample} bits (${encoding})`);
  const frameBytes = (bitsPerSample / 8) * channels;
  const available = Math.max(0, fileSize - format.dataOffset);
  let dataLength = Math.min(format.dataLength > 0 ? format.dataLength : available, available);
  dataLength -= dataLength % frameBytes;
  if (dataLength <= 0) throw new Error('El archivo no tiene audio');
  return { ...format, dataLength, frameBytes, duration: dataLength / frameBytes / sampleRate };
}

function parseWav(view: DataView, fileSize: number): PcmFormat {
  let offset = 12;
  let fmt: { audioFormat: number; channels: number; sampleRate: number; bits: number } | undefined;
  while (offset + 8 <= view.byteLength) {
    const id = ascii(view, offset);
    const size = view.getUint32(offset + 4, true);
    const body = offset + 8;
    if (id === 'fmt ') {
      let audioFormat = view.getUint16(body, true);
      const channels = view.getUint16(body + 2, true);
      const sampleRate = view.getUint32(body + 4, true);
      const bits = view.getUint16(body + 14, true);
      // WAVE_FORMAT_EXTENSIBLE: el formato de verdad va en los dos primeros bytes del GUID.
      if (audioFormat === 0xfffe && size >= 40) audioFormat = view.getUint16(body + 24, true);
      fmt = { audioFormat, channels, sampleRate, bits };
    } else if (id === 'data') {
      if (!fmt) throw new Error('WAV sin cabecera de formato antes del audio');
      if (fmt.audioFormat !== 1 && fmt.audioFormat !== 3) {
        throw new Error(`WAV comprimido (formato ${fmt.audioFormat}): expórtalo como PCM`);
      }
      return finish(
        {
          container: 'wav',
          sampleRate: fmt.sampleRate,
          channels: fmt.channels,
          bitsPerSample: fmt.bits,
          encoding: fmt.audioFormat === 3 ? 'float' : 'int',
          littleEndian: true,
          dataOffset: body,
          // 0xFFFFFFFF (o 0) cuando el programa no sabía el tamaño al empezar a escribir.
          dataLength: size === 0xffffffff ? 0 : size,
        },
        fileSize,
      );
    }
    offset = body + size + (size % 2);
  }
  throw new Error('No se encuentra el audio dentro del WAV');
}

function parseAiff(view: DataView, fileSize: number, aifc: boolean): PcmFormat {
  let offset = 12;
  let comm:
    | { channels: number; bits: number; sampleRate: number; encoding: 'int' | 'float'; littleEndian: boolean }
    | undefined;
  while (offset + 8 <= view.byteLength) {
    const id = ascii(view, offset);
    const size = view.getUint32(offset + 4);
    const body = offset + 8;
    if (id === 'COMM') {
      const channels = view.getUint16(body);
      let bits = view.getUint16(body + 6);
      const sampleRate = readExtended(view, body + 8);
      let encoding: 'int' | 'float' = 'int';
      let littleEndian = false;
      if (aifc && size >= 22) {
        const compression = ascii(view, body + 18);
        if (compression === 'sowt') littleEndian = true;
        else if (compression === 'fl32' || compression === 'FL32') {
          encoding = 'float';
          bits = 32;
        } else if (compression === 'fl64' || compression === 'FL64') {
          encoding = 'float';
          bits = 64;
        } else if (compression !== 'NONE' && compression !== 'twos') {
          throw new Error(`AIFF comprimido (${compression.trim()}): expórtalo sin comprimir`);
        }
      }
      // Bits que no son múltiplo de 8 se guardan en el siguiente byte entero.
      bits = Math.ceil(bits / 8) * 8;
      comm = { channels, bits, sampleRate: Math.round(sampleRate), encoding, littleEndian };
    } else if (id === 'SSND') {
      if (!comm) throw new Error('AIFF sin cabecera COMM antes del audio');
      const dataStart = body + 8 + view.getUint32(body);
      return finish(
        {
          container: 'aiff',
          sampleRate: comm.sampleRate,
          channels: comm.channels,
          bitsPerSample: comm.bits,
          encoding: comm.encoding,
          littleEndian: comm.littleEndian,
          dataOffset: dataStart,
          dataLength: size - 8 - view.getUint32(body),
        },
        fileSize,
      );
    }
    offset = body + size + (size % 2);
  }
  throw new Error('No se encuentra el audio dentro del AIFF');
}

/**
 * Lee la cabecera. `head` son los primeros bytes del archivo (con 1 MB sobra:
 * los metadatos van antes del audio); `fileSize`, el tamaño total. `null` si
 * no es ni WAV ni AIFF.
 */
export function parsePcmHeader(head: ArrayBuffer, fileSize: number): PcmFormat | null {
  if (head.byteLength < 12) return null;
  const view = new DataView(head);
  const riff = ascii(view, 0);
  const kind = ascii(view, 8);
  if ((riff === 'RIFF' || riff === 'RF64') && kind === 'WAVE') return parseWav(view, fileSize);
  if (riff === 'FORM' && (kind === 'AIFF' || kind === 'AIFC')) return parseAiff(view, fileSize, kind === 'AIFC');
  return null;
}

/**
 * Bytes de audio → un `Float32Array` por canal (entre −1 y 1). `bytes` tiene
 * que empezar en una muestra (múltiplo de `frameBytes` desde `dataOffset`).
 */
export function decodePcm(bytes: ArrayBuffer, format: PcmFormat): Float32Array[] {
  const { channels, bitsPerSample, encoding, littleEndian, frameBytes } = format;
  const frames = Math.floor(bytes.byteLength / frameBytes);
  const view = new DataView(bytes);
  const out = Array.from({ length: channels }, () => new Float32Array(frames));
  const step = bitsPerSample / 8;
  for (let f = 0; f < frames; f++) {
    let pos = f * frameBytes;
    for (let c = 0; c < channels; c++) {
      let value: number;
      if (encoding === 'float') {
        value = bitsPerSample === 32 ? view.getFloat32(pos, littleEndian) : view.getFloat64(pos, littleEndian);
      } else if (bitsPerSample === 16) {
        value = view.getInt16(pos, littleEndian) / 32768;
      } else if (bitsPerSample === 24) {
        const b0 = view.getUint8(pos);
        const b1 = view.getUint8(pos + 1);
        const b2 = view.getUint8(pos + 2);
        let int = littleEndian ? b0 | (b1 << 8) | (b2 << 16) : (b0 << 16) | (b1 << 8) | b2;
        if (int & 0x800000) int -= 0x1000000;
        value = int / 8388608;
      } else if (bitsPerSample === 32) {
        value = view.getInt32(pos, littleEndian) / 2147483648;
      } else {
        // 8 bits: en WAV va sin signo; en AIFF, con signo.
        value = format.container === 'wav' ? (view.getUint8(pos) - 128) / 128 : view.getInt8(pos) / 128;
      }
      out[c]![f] = value;
      pos += step;
    }
  }
  return out;
}
