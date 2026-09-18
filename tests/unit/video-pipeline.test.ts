import { describe, expect, it } from 'vitest';
import {
  CACHE_IMMUTABLE,
  DEFAULT_LADDER,
  audioCodecString,
  av1CodecString,
  avcCodecString,
  buildLadder,
  buildMasterPlaylist,
  computeCrop,
  contentTypeFor,
  etagMatches,
  formatBytes,
  isFastStart,
  isValidSlug,
  masterOrder,
  maxBitrateKbps,
  objectKey,
  parseAspect,
  parseMediaPlaylist,
  parseRate,
  playlistBandwidth,
  rungSize,
  versionedFolder,
} from '../../scripts/lib/video.mjs';

describe('parseAspect', () => {
  it('entiende 4:5, 9:16, 4x5 y source', () => {
    expect(parseAspect('4:5')).toEqual({ label: '4x5', ratio: 0.8 });
    expect(parseAspect(' 9:16 ')).toEqual({ label: '9x16', ratio: 9 / 16 });
    expect(parseAspect('4x5').ratio).toBe(0.8);
    expect(parseAspect('source')).toEqual({ label: 'source', ratio: null });
  });

  it('rechaza lo que no es una proporción', () => {
    expect(() => parseAspect('vertical')).toThrow(/no válida/);
    expect(() => parseAspect('0:5')).toThrow(/no válida/);
  });
});

describe('computeCrop', () => {
  it('vídeo de prueba (576×1024, 9:16) → 4:5 centrado: 576×720 desde y=152', () => {
    expect(computeCrop({ width: 576, height: 1024 }, 4 / 5)).toEqual({ width: 576, height: 720, x: 0, y: 152 });
  });

  it('mismo vídeo en 9:16 → sin recorte', () => {
    expect(computeCrop({ width: 576, height: 1024 }, 9 / 16)).toEqual({ width: 576, height: 1024, x: 0, y: 0 });
  });

  it('el punto focal desplaza el recorte (arriba del todo y abajo del todo)', () => {
    expect(computeCrop({ width: 576, height: 1024 }, 4 / 5, 0.5, 0).y).toBe(0);
    expect(computeCrop({ width: 576, height: 1024 }, 4 / 5, 0.5, 1).y).toBe(304);
  });

  it('original más ancho que la salida: recorta los lados (1.mp4, 1124×2436 → 9:16)', () => {
    const crop = computeCrop({ width: 1124, height: 2436 }, 9 / 16);
    expect(crop.height).toBe(1998);
    expect(crop.width).toBe(1124);
    const wide = computeCrop({ width: 1920, height: 1080 }, 4 / 5, 0.25);
    expect(wide).toEqual({ width: 864, height: 1080, x: 264, y: 0 });
  });

  it('siempre da dimensiones pares y dentro del original', () => {
    const crop = computeCrop({ width: 1125, height: 2001 }, 4 / 5, 1, 1);
    expect(crop.width % 2).toBe(0);
    expect(crop.height % 2).toBe(0);
    expect(crop.x + crop.width).toBeLessThanOrEqual(1125);
    expect(crop.y + crop.height).toBeLessThanOrEqual(2001);
  });
});

describe('buildLadder', () => {
  it('1080/720/480 cuando el original llega a 1080', () => {
    expect(buildLadder(1080)).toEqual(DEFAULT_LADDER);
    expect(buildLadder(1124)).toEqual([1080, 720, 480]);
  });

  it('nunca amplía: 576 → 576 (tamaño real) y 480', () => {
    expect(buildLadder(576)).toEqual([576, 480]);
  });

  it('original más pequeño que todos los peldaños → solo su tamaño', () => {
    expect(buildLadder(400)).toEqual([400]);
  });

  it('no añade el tamaño real si el peldaño de arriba está cerca', () => {
    expect(buildLadder(760)).toEqual([720, 480]);
  });
});

describe('rungSize', () => {
  it('mantiene la proporción con el lado corto pedido', () => {
    expect(rungSize({ width: 576, height: 720 }, 480)).toEqual({ width: 480, height: 600 });
    expect(rungSize({ width: 576, height: 1024 }, 480)).toEqual({ width: 480, height: 854 });
    expect(rungSize({ width: 1920, height: 1080 }, 720)).toEqual({ width: 1280, height: 720 });
  });

  it('el peldaño del tamaño real es el recorte tal cual', () => {
    expect(rungSize({ width: 576, height: 720 }, 576)).toEqual({ width: 576, height: 720 });
  });
});

describe('maxBitrateKbps', () => {
  it('sigue la tabla de §5 · C15 e interpola entre peldaños', () => {
    expect(maxBitrateKbps(1080)).toBe(5000);
    expect(maxBitrateKbps(720)).toBe(2800);
    expect(maxBitrateKbps(480)).toBe(1200);
    expect(maxBitrateKbps(576)).toBe(1840);
    expect(maxBitrateKbps(240)).toBeLessThan(700);
  });
});

describe('masterOrder', () => {
  it('primero la más ligera (Safari y hls.js arrancan por ella) y luego de mayor a menor', () => {
    expect(masterOrder([1080, 720, 480])).toEqual([480, 1080, 720]);
    expect(masterOrder([576, 480])).toEqual([480, 576]);
    expect(masterOrder([1080])).toEqual([1080]);
    expect(masterOrder([])).toEqual([]);
  });
});

describe('códecs (RFC 6381)', () => {
  it('H.264', () => {
    expect(avcCodecString('High', 31)).toBe('avc1.64001f');
    expect(avcCodecString('High', 30)).toBe('avc1.64001e');
    expect(avcCodecString('Main', 40)).toBe('avc1.4d0028');
    expect(avcCodecString('Constrained Baseline', 30)).toBe('avc1.42e01e');
    expect(() => avcCodecString('High 10', 40)).toThrow();
  });

  it('AV1 (fixtures de los tests) y audio', () => {
    expect(av1CodecString('Main', 4)).toBe('av01.0.04M.08');
    expect(audioCodecString('aac', 'LC')).toBe('mp4a.40.2');
    expect(audioCodecString('aac', 'HE-AAC')).toBe('mp4a.40.5');
    expect(audioCodecString('opus')).toBe('opus');
  });
});

describe('listas M3U8', () => {
  const media = [
    '#EXTM3U',
    '#EXT-X-VERSION:7',
    '#EXT-X-TARGETDURATION:4',
    '#EXT-X-MEDIA-SEQUENCE:0',
    '#EXT-X-PLAYLIST-TYPE:VOD',
    '#EXT-X-INDEPENDENT-SEGMENTS',
    '#EXT-X-MAP:URI="init.mp4"',
    '#EXTINF:4.000000,',
    'seg_000.m4s',
    '#EXTINF:1.900000,',
    'seg_001.m4s',
    '#EXT-X-ENDLIST',
    '',
  ].join('\n');

  it('lee la lista de un peldaño (la que escribe ffmpeg)', () => {
    expect(parseMediaPlaylist(media)).toEqual({
      version: 7,
      targetDuration: 4,
      map: 'init.mp4',
      segments: [
        { duration: 4, uri: 'seg_000.m4s' },
        { duration: 1.9, uri: 'seg_001.m4s' },
      ],
      endList: true,
    });
    expect(() => parseMediaPlaylist('hola')).toThrow();
  });

  it('BANDWIDTH = pico por segmento; AVERAGE-BANDWIDTH = media', () => {
    const bw = playlistBandwidth([
      { duration: 4, bytes: 500_000 },
      { duration: 4, bytes: 1_000_000 },
      // Un último segmento corto no dispara el pico (se mide sobre 1 s como mínimo).
      { duration: 0.5, bytes: 200_000 },
    ]);
    expect(bw.bandwidth).toBe(2_000_000);
    expect(bw.averageBandwidth).toBe(Math.ceil((1_700_000 * 8) / 8.5));
  });

  it('escribe el master.m3u8 con los atributos que pide Apple', () => {
    const master = buildMasterPlaylist([
      { uri: '576p/index.m3u8', bandwidth: 1958055, averageBandwidth: 1687575, width: 576, height: 720, frameRate: 30, codecs: 'avc1.64001f,mp4a.40.2' },
    ]);
    expect(master).toBe(
      '#EXTM3U\n#EXT-X-VERSION:7\n#EXT-X-INDEPENDENT-SEGMENTS\n' +
        '#EXT-X-STREAM-INF:BANDWIDTH=1958055,AVERAGE-BANDWIDTH=1687575,CODECS="avc1.64001f,mp4a.40.2",RESOLUTION=576x720,FRAME-RATE=30.000\n' +
        '576p/index.m3u8\n',
    );
  });
});

describe('subida a R2', () => {
  it('Content-Type por extensión', () => {
    expect(contentTypeFor('video/x/4x5/master.m3u8')).toBe('application/vnd.apple.mpegurl');
    expect(contentTypeFor('seg_000.m4s')).toBe('video/mp4');
    expect(contentTypeFor('POSTER.JPG')).toBe('image/jpeg');
    expect(contentTypeFor('poster.avif')).toBe('image/avif');
    expect(contentTypeFor('mix.mp3')).toBe('audio/mpeg');
    expect(contentTypeFor('raro.xyz')).toBe('application/octet-stream');
  });

  it('las claves usan «/» también en Windows y admiten prefijo', () => {
    expect(objectKey('video\\prueba\\4x5\\master.m3u8')).toBe('video/prueba/4x5/master.m3u8');
    expect(objectKey('mix.mp3', '/mixes/')).toBe('mixes/mix.mp3');
  });

  it('el ETag de una subida simple es el MD5 (entre comillas)', () => {
    expect(etagMatches('"be06dcf6775c18bfab7b4cc0306146de"', 'BE06DCF6775C18BFAB7B4CC0306146DE')).toBe(true);
    expect(etagMatches('"be06dcf6775c18bfab7b4cc0306146de-2"', 'be06dcf6775c18bfab7b4cc0306146de')).toBe(false);
    expect(etagMatches(undefined, 'x')).toBe(false);
  });

  it('caché inmutable de un año', () => {
    expect(CACHE_IMMUTABLE).toBe('public, max-age=31536000, immutable');
  });
});

describe('utilidades', () => {
  it('carpeta = slug + 8 caracteres del hash (o solo el slug)', () => {
    expect(versionedFolder('prueba-media', '4f47f1419d2c')).toBe('prueba-media-4f47f141');
    expect(versionedFolder('e2e-fixture', null)).toBe('e2e-fixture');
    expect(() => versionedFolder('Vídeo Prueba', 'abc')).toThrow(/Slug/);
    expect(isValidSlug('cuki-insulto')).toBe(true);
    expect(isValidSlug('-cuki')).toBe(false);
  });

  it('+faststart: moov antes que mdat', () => {
    expect(isFastStart(['ftyp', 'moov', 'mdat'])).toBe(true);
    expect(isFastStart(['ftyp', 'mdat', 'moov'])).toBe(false);
    expect(isFastStart(['ftyp', 'free'])).toBe(false);
  });

  it('fracciones de ffprobe y tamaños legibles', () => {
    expect(parseRate('30000/1001')).toBeCloseTo(29.97, 2);
    expect(parseRate('25/1')).toBe(25);
    expect(parseRate(undefined)).toBe(0);
    expect(formatBytes(2_943_916)).toBe('2,9 MB');
    expect(formatBytes(640)).toBe('640 B');
  });
});
