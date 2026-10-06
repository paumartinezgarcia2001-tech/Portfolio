/**
 * D64 · Almacenamiento de R2 y conversión de mixes: las piezas puras.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { R2_STORAGE } from '../../src/config/admin';
import { measureStorage, objectSize } from '../../src/lib/admin/r2-usage';
import { presignR2, r2Endpoint, type R2Credentials } from '../../src/lib/admin/r2';
import {
  describeStorage,
  fitsInStorage,
  formatStorageBytes,
  noRoomMessage,
  parseListObjectsPage,
  storageStatus,
} from '../../src/lib/admin/storage';
import { LoudnessMeter, kWeighting, planGain } from '../../src/lib/audio/loudness';
import { createMp3Writer, mp3SampleRate } from '../../src/lib/audio/mp3';
import { decodePcm, parsePcmHeader, readExtended } from '../../src/lib/audio/pcm';
import { STORAGE_LIMIT_BYTES, STORAGE_WARN_FRACTION, storageVerdict } from '../../scripts/lib/storage.mjs';

const ROOT = path.resolve(import.meta.dirname, '../..');
const MP3_WASM = readFileSync(path.join(ROOT, 'node_modules/wasm-media-encoders/wasm/mp3.wasm'));

const CREDENTIALS: R2Credentials = {
  accountId: 'cuenta',
  accessKeyId: 'AKID',
  secretAccessKey: 'secreto',
  bucket: 'medios',
};

describe('estado del almacenamiento', () => {
  it('el límite es 10 GB (de 1000³ bytes), con aviso al 80 %, igual en el panel y en los scripts', () => {
    expect(R2_STORAGE.limitBytes).toBe(10_000_000_000);
    expect(R2_STORAGE.warnFraction).toBe(0.8);
    expect(STORAGE_LIMIT_BYTES).toBe(R2_STORAGE.limitBytes);
    expect(STORAGE_WARN_FRACTION).toBe(R2_STORAGE.warnFraction);
  });

  it('nivel y porcentaje', () => {
    expect(storageStatus(0)).toMatchObject({ percent: 0, level: 'ok', freeBytes: 10e9 });
    expect(storageStatus(450_000_512)).toMatchObject({ percent: 4.5, level: 'ok' });
    // Nunca «0 %» con algo dentro…
    expect(storageStatus(1000).percent).toBe(0.1);
    expect(storageStatus(7_999_999_999)).toMatchObject({ level: 'ok', percent: 80 });
    expect(storageStatus(8_000_000_000)).toMatchObject({ level: 'warn', percent: 80 });
    // …ni «100 %» sin estar lleno.
    expect(storageStatus(9_999_999_999)).toMatchObject({ level: 'warn', percent: 99.9, freeBytes: 1 });
    expect(storageStatus(10_000_000_000)).toMatchObject({ level: 'full', percent: 100, freeBytes: 0 });
    expect(storageStatus(10_500_000_000)).toMatchObject({ level: 'full', percent: 105, freeBytes: 0 });
  });

  it('¿cabe?', () => {
    const status = storageStatus(9_999_000_000);
    expect(fitsInStorage(status, 1_000_000)).toBe(true);
    expect(fitsInStorage(status, 1_000_001)).toBe(false);
    expect(fitsInStorage(storageStatus(10e9), 0)).toBe(true);
    expect(fitsInStorage(storageStatus(10e9), 1)).toBe(false);
  });

  it('textos', () => {
    expect(formatStorageBytes(0)).toBe('0 B');
    expect(formatStorageBytes(50_000)).toBe('50 kB');
    expect(formatStorageBytes(450_000_512)).toBe('450 MB');
    expect(formatStorageBytes(2_345_000_000)).toBe('2,3 GB');
    expect(formatStorageBytes(10e9)).toBe('10 GB');
    expect(describeStorage(storageStatus(2_345_000_000))).toBe('2,3 GB de 10 GB (23,5 %)');
    expect(noRoomMessage(storageStatus(9_999_950_000), 120_000)).toBe(
      'No cabe: R2 ya tiene 10 GB de 10 GB (99,9 %) y esto ocupa 120 kB. Quedan 50 kB. Borra algún mix antes de subir más.',
    );
  });

  it('scripts: lo que se sube (menos lo que sustituye) tiene que caber', () => {
    expect(storageVerdict(9e9, 1e9).fits).toBe(true);
    expect(storageVerdict(9e9, 1e9 + 1).fits).toBe(false);
    // Sustituir por algo más pequeño siempre se puede, aunque ya esté lleno.
    expect(storageVerdict(11e9, -5).fits).toBe(true);
    expect(storageVerdict(4.5e8, 1.2e5)).toMatchObject({ percentBefore: '4,5', percentAfter: '4,6' });
  });
});

describe('listado del bucket (ListObjectsV2)', () => {
  const page = (keys: Array<[string, number]>, next?: string) =>
    `<?xml version="1.0" encoding="UTF-8"?><ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">` +
    `<Name>medios</Name><IsTruncated>${Boolean(next)}</IsTruncated>` +
    keys.map(([key, size]) => `<Contents><Key>${key}</Key><Size>${size}</Size></Contents>`).join('') +
    (next ? `<NextContinuationToken>${next}</NextContinuationToken>` : '') +
    `</ListBucketResult>`;

  it('suma los tamaños de una página', () => {
    expect(parseListObjectsPage(page([['a', 10], ['b', 32]]))).toEqual({ bytes: 42, objects: 2, truncated: false, nextToken: undefined });
    expect(parseListObjectsPage(page([], 'x&amp;y'))).toMatchObject({ bytes: 0, truncated: true, nextToken: 'x&y' });
    expect(() => parseListObjectsPage('<Error><Code>AccessDenied</Code></Error>')).toThrow(/listado/);
  });

  it('recorre todas las páginas con la URL firmada', async () => {
    const urls: string[] = [];
    const fetcher = async (url: string) => {
      urls.push(url);
      const token = new URL(url).searchParams.get('continuation-token');
      return new Response(token ? page([['c', 3]]) : page([['a', 1_000_000_000], ['b', 2]], 'tok/1'));
    };
    const status = await measureStorage(CREDENTIALS, { fetcher });
    expect(status).toMatchObject({ usedBytes: 1_000_000_005, objects: 3, percent: 10, level: 'ok' });
    expect(urls).toHaveLength(2);
    const first = new URL(urls[0]!);
    expect(first.origin + first.pathname).toBe('https://cuenta.r2.cloudflarestorage.com/medios');
    expect(first.searchParams.get('list-type')).toBe('2');
    expect(first.searchParams.get('X-Amz-Signature')).toMatch(/^[0-9a-f]{64}$/);
    expect(new URL(urls[1]!).searchParams.get('continuation-token')).toBe('tok/1');
  });

  it('si R2 falla, lanza (y el panel no deja subir)', async () => {
    const fetcher = async () => new Response('<Error/>', { status: 403 });
    await expect(measureStorage(CREDENTIALS, { fetcher })).rejects.toThrow(/403/);
  });

  it('HEAD: tamaño de un objeto, o null', async () => {
    const fetcher = async (url: string) =>
      url.includes('/medios/mixes/a.mp3?')
        ? new Response(null, { status: 200, headers: { 'content-length': '1234' } })
        : new Response(null, { status: 404 });
    expect(await objectSize(CREDENTIALS, 'mixes/a.mp3', fetcher)).toBe(1234);
    expect(await objectSize(CREDENTIALS, 'mixes/b.mp3', fetcher)).toBeNull();
  });
});

describe('URLs firmadas', () => {
  const now = new Date('2026-10-06T12:00:00Z');

  it('con content-type firmado (R2 rechaza otro tipo)', async () => {
    const url = new URL(
      await presignR2(CREDENTIALS, 'PUT', 'mixes/a.mp3', 900, { now, headers: { 'Content-Type': 'audio/mpeg' } }),
    );
    expect(url.searchParams.get('X-Amz-SignedHeaders')).toBe('content-type;host');
    const plain = new URL(await presignR2(CREDENTIALS, 'PUT', 'mixes/a.mp3', 900, { now }));
    expect(plain.searchParams.get('X-Amz-SignedHeaders')).toBe('host');
    // El tipo cambia la firma.
    expect(url.searchParams.get('X-Amz-Signature')).not.toBe(plain.searchParams.get('X-Amz-Signature'));
  });

  it('otro endpoint (R2_ENDPOINT): UE o el simulado de los e2e', async () => {
    expect(r2Endpoint('cuenta')).toBe('https://cuenta.r2.cloudflarestorage.com');
    expect(r2Endpoint('cuenta', 'https://cuenta.eu.r2.cloudflarestorage.com/')).toBe('https://cuenta.eu.r2.cloudflarestorage.com');
    const url = new URL(await presignR2({ ...CREDENTIALS, endpoint: 'http://127.0.0.1:4325' }, 'GET', '', 60, { now }));
    expect(`${url.origin}${url.pathname}`).toBe('http://127.0.0.1:4325/medios');
  });
});

/** Tono de 997 Hz, `seconds` s, amplitud `amplitude`, en los dos canales. */
function sine(sampleRate: number, seconds: number, amplitude: number): Float32Array[] {
  const frames = Math.round(sampleRate * seconds);
  const data = new Float32Array(frames);
  for (let i = 0; i < frames; i++) data[i] = amplitude * Math.sin((2 * Math.PI * 997 * i) / sampleRate);
  return [data, data.slice()];
}

describe('sonoridad (BS.1770)', () => {
  it('un tono de 997 Hz a −20 dBFS en estéreo mide −20 LUFS a cualquier frecuencia', () => {
    for (const rate of [32000, 44100, 48000, 96000]) {
      const meter = new LoudnessMeter(rate, 2);
      meter.push(sine(rate, 3, 0.1));
      expect(meter.integrated(), `${rate} Hz`).toBeCloseTo(-20, 1);
      expect(meter.peak).toBeCloseTo(0.1, 3);
    }
  });

  it('da igual cómo se trocee', () => {
    const [l, r] = sine(48000, 4, 0.3);
    const whole = new LoudnessMeter(48000, 2);
    whole.push([l!, r!]);
    const pieces = new LoudnessMeter(48000, 2);
    for (let i = 0; i < l!.length; i += 7777) pieces.push([l!.subarray(i, i + 7777), r!.subarray(i, i + 7777)]);
    expect(pieces.integrated()).toBeCloseTo(whole.integrated(), 6);
  });

  it('mono: un canal (−3 LU respecto al mismo tono en estéreo)', () => {
    const meter = new LoudnessMeter(44100, 1);
    meter.push([sine(44100, 3, 0.1)[0]!]);
    expect(meter.integrated()).toBeCloseTo(-23, 1);
  });

  it('las puertas: el silencio no baja la media', () => {
    const meter = new LoudnessMeter(48000, 2);
    meter.push(sine(48000, 3, 0.1));
    meter.push([new Float32Array(48000 * 6), new Float32Array(48000 * 6)]);
    expect(meter.integrated()).toBeCloseTo(-20, 0);
    const silent = new LoudnessMeter(48000, 2);
    silent.push([new Float32Array(48000), new Float32Array(48000)]);
    expect(silent.integrated()).toBe(-Infinity);
  });

  it('la ponderación K a 48 kHz es la de la norma', () => {
    const [shelf, highpass] = kWeighting(48000);
    expect(shelf.b0).toBeCloseTo(1.53512485958697, 10);
    expect(shelf.a1).toBeCloseTo(-1.69065929318241, 10);
    expect(highpass.a1).toBeCloseTo(-1.99004745483398, 10);
    expect(highpass.a2).toBeCloseTo(0.99007225036621, 10);
  });

  it('ganancia: a −14 LUFS, sin pasar el techo de picos', () => {
    expect(planGain(-20, 0.1, -14, -1.5)).toMatchObject({ gainDb: 6, peakLimited: false, resultLufs: -14 });
    expect(planGain(-8, 0.99, -14, -1.5)).toMatchObject({ gainDb: -6, peakLimited: false });
    // Un mix bajo pero con picos altos: se queda por debajo de −14.
    const limited = planGain(-24, 0.5, -14, -1.5);
    expect(limited.peakLimited).toBe(true);
    expect(20 * Math.log10(0.5) + limited.gainDb).toBeCloseTo(-1.5, 6);
    expect(limited.resultLufs).toBeLessThan(-14);
    expect(planGain(-Infinity, 0, -14, -1.5)).toMatchObject({ gain: 1 });
  });
});

/** WAV en memoria. */
function wavFile(options: { rate: number; channels: number; bits: number; format?: 1 | 3 | 0xfffe; samples: number[]; extra?: Buffer }) {
  const { rate, channels, bits, samples } = options;
  const bytes = bits / 8;
  const data = Buffer.alloc(samples.length * bytes);
  samples.forEach((value, i) => {
    const at = i * bytes;
    if (options.format === 3) data.writeFloatLE(value, at);
    else if (bits === 16) data.writeInt16LE(Math.round(value * 32767), at);
    else if (bits === 24) data.writeIntLE(Math.round(value * 8388607), at, 3);
    else if (bits === 32) data.writeInt32LE(Math.round(value * 2147483647), at);
  });
  const extensible = options.format === 0xfffe;
  const fmt = Buffer.alloc(extensible ? 40 : 16);
  fmt.writeUInt16LE(options.format ?? 1, 0);
  fmt.writeUInt16LE(channels, 2);
  fmt.writeUInt32LE(rate, 4);
  fmt.writeUInt32LE(rate * channels * bytes, 8);
  fmt.writeUInt16LE(channels * bytes, 12);
  fmt.writeUInt16LE(bits, 14);
  if (extensible) {
    fmt.writeUInt16LE(22, 16);
    fmt.writeUInt16LE(1, 24); // KSDATAFORMAT_SUBTYPE_PCM
  }
  const chunk = (id: string, body: Buffer) => {
    const head = Buffer.alloc(8);
    head.write(id, 0);
    head.writeUInt32LE(body.length, 4);
    return Buffer.concat([head, body, body.length % 2 ? Buffer.alloc(1) : Buffer.alloc(0)]);
  };
  const body = Buffer.concat([Buffer.from('WAVE'), chunk('fmt ', fmt), ...(options.extra ? [chunk('LIST', options.extra)] : []), chunk('data', data)]);
  const riff = Buffer.alloc(8);
  riff.write('RIFF', 0);
  riff.writeUInt32LE(body.length, 4);
  return Buffer.concat([riff, body]);
}

const arrayBuffer = (buffer: Buffer) => buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;

describe('WAV y AIFF por trozos', () => {
  const samples = [0, 0.5, -0.5, 0.25, 1 - 2 ** -15, -1];

  for (const bits of [16, 24, 32]) {
    it(`WAV PCM de ${bits} bits`, () => {
      const file = wavFile({ rate: 44100, channels: 2, bits, samples, extra: Buffer.from('metadatos') });
      const format = parsePcmHeader(arrayBuffer(file), file.length)!;
      expect(format).toMatchObject({ container: 'wav', sampleRate: 44100, channels: 2, bitsPerSample: bits, encoding: 'int' });
      expect(format.duration).toBeCloseTo(3 / 44100, 9);
      const [l, r] = decodePcm(arrayBuffer(file.subarray(format.dataOffset)), format);
      expect([...l!].map((v) => Math.round(v * 1000) / 1000)).toEqual([0, -0.5, 1]);
      expect([...r!].map((v) => Math.round(v * 1000) / 1000)).toEqual([0.5, 0.25, -1]);
    });
  }

  it('WAV en coma flotante y WAVE_FORMAT_EXTENSIBLE', () => {
    const float = wavFile({ rate: 48000, channels: 1, bits: 32, format: 3, samples: [0.125, -0.75] });
    const f = parsePcmHeader(arrayBuffer(float), float.length)!;
    expect(f).toMatchObject({ encoding: 'float', channels: 1 });
    expect([...decodePcm(arrayBuffer(float.subarray(f.dataOffset)), f)[0]!]).toEqual([0.125, -0.75]);
    const ext = wavFile({ rate: 96000, channels: 2, bits: 24, format: 0xfffe, samples: [0.5, -0.5] });
    expect(parsePcmHeader(arrayBuffer(ext), ext.length)).toMatchObject({ encoding: 'int', bitsPerSample: 24, sampleRate: 96000 });
  });

  it('tamaño de datos desconocido (0xFFFFFFFF) o archivo cortado: se usa lo que hay', () => {
    const file = wavFile({ rate: 44100, channels: 2, bits: 16, samples: [0.1, 0.2, 0.3, 0.4] });
    const unknown = Buffer.from(file);
    unknown.writeUInt32LE(0xffffffff, file.indexOf('data') + 4);
    expect(parsePcmHeader(arrayBuffer(unknown), unknown.length)!.dataLength).toBe(8);
    const cut = file.subarray(0, file.length - 3);
    expect(parsePcmHeader(arrayBuffer(cut), cut.length)!.dataLength).toBe(4);
  });

  it('no es WAV/AIFF → null; WAV comprimido → error claro', () => {
    expect(parsePcmHeader(arrayBuffer(Buffer.from('ID3\u0004 no es un wav')), 20)).toBeNull();
    const adpcm = wavFile({ rate: 44100, channels: 1, bits: 16, samples: [0], format: 1 });
    adpcm.writeUInt16LE(2, adpcm.indexOf('fmt ') + 8);
    expect(() => parsePcmHeader(arrayBuffer(adpcm), adpcm.length)).toThrow(/comprimido/);
  });

  it('AIFF de 16 bits (big-endian) y AIFF-C `sowt`', () => {
    const rate = Buffer.from([0x40, 0x0e, 0xac, 0x44, 0, 0, 0, 0, 0, 0]); // 44100 en 80 bits
    expect(readExtended(new DataView(arrayBuffer(rate)), 0)).toBe(44100);
    const build = (kind: 'AIFF' | 'AIFC', littleEndian: boolean) => {
      const comm = Buffer.alloc(kind === 'AIFC' ? 24 : 18);
      comm.writeUInt16BE(1, 0);
      comm.writeUInt32BE(2, 2);
      comm.writeUInt16BE(16, 6);
      rate.copy(comm, 8);
      if (kind === 'AIFC') comm.write(littleEndian ? 'sowt' : 'NONE', 18);
      const sound = Buffer.alloc(8 + 4);
      const values = [16384, -16384];
      values.forEach((v, i) => (littleEndian ? sound.writeInt16LE(v, 8 + i * 2) : sound.writeInt16BE(v, 8 + i * 2)));
      const chunk = (id: string, body: Buffer) => {
        const head = Buffer.alloc(8);
        head.write(id, 0);
        head.writeUInt32BE(body.length, 4);
        return Buffer.concat([head, body]);
      };
      const body = Buffer.concat([Buffer.from(kind), chunk('COMM', comm), chunk('SSND', sound)]);
      const form = Buffer.alloc(8);
      form.write('FORM', 0);
      form.writeUInt32BE(body.length, 4);
      return Buffer.concat([form, body]);
    };
    for (const [kind, le] of [['AIFF', false], ['AIFC', true]] as const) {
      const file = build(kind, le);
      const format = parsePcmHeader(arrayBuffer(file), file.length)!;
      expect(format).toMatchObject({ container: 'aiff', sampleRate: 44100, channels: 1, littleEndian: le });
      expect([...decodePcm(arrayBuffer(file.subarray(format.dataOffset)), format)[0]!]).toEqual([0.5, -0.5]);
    }
  });
});

describe('MP3 (LAME en WebAssembly)', () => {
  it('frecuencia del MP3', () => {
    expect(mp3SampleRate(44100)).toBe(44100);
    expect(mp3SampleRate(88200)).toBe(44100);
    expect(mp3SampleRate(48000)).toBe(48000);
    expect(mp3SampleRate(96000)).toBe(48000);
    expect(mp3SampleRate(32000)).toBe(32000);
    expect(mp3SampleRate(22050)).toBe(44100);
  });

  for (const [rate, header] of [
    [44100, 'fffbe0'],
    [96000, 'fffbe4'],
  ] as const) {
    it(`${rate} Hz → MP3 320 kbps (cabecera ${header}…)`, async () => {
      const writer = await createMp3Writer(MP3_WASM, { sampleRate: rate, channels: 2, bitrate: 320, gain: 0.5 });
      const audio = sine(rate, 2, 0.4);
      writer.write(audio);
      const mp3 = Buffer.concat(writer.finish());
      expect(mp3.subarray(0, 3).toString('hex')).toBe(header);
      // 2 s a 320 kbps ≈ 80 kB
      expect(mp3.length).toBeGreaterThan(76_000);
      expect(mp3.length).toBeLessThan(86_000);
      expect(writer.bytes).toBe(mp3.length);
      // La ganancia se aplica antes de codificar (y nunca pasa de ±1).
      expect(audio[0]!.reduce((max, v) => Math.max(max, v), 0)).toBeCloseTo(0.2, 3);
    });
  }
});
