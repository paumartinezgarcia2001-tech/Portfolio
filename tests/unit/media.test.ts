import { describe, expect, it } from 'vitest';
import { LAGRIMA_FULL_SET, MEDIA_VIDEO, type MediaVideoConfig } from '../../src/config/media';
import { narrowQuery, objectPosition, resolveMediaUrl, resolveMediaVideo } from '../../src/lib/media';

const BASE = 'https://media.example.test';

describe('resolveMediaUrl', () => {
  it('une la base de R2 y la ruta, sin barras dobles', () => {
    expect(resolveMediaUrl(`${BASE}/`, '/video/a/master.m3u8')).toBe(`${BASE}/video/a/master.m3u8`);
    expect(resolveMediaUrl(BASE, 'video/a/master.m3u8')).toBe(`${BASE}/video/a/master.m3u8`);
  });

  it('respeta las URLs absolutas y sin base devuelve null', () => {
    expect(resolveMediaUrl(undefined, 'https://otro.test/v.m3u8')).toBe('https://otro.test/v.m3u8');
    expect(resolveMediaUrl(undefined, 'video/a/master.m3u8')).toBeNull();
    expect(resolveMediaUrl('', 'video/a/master.m3u8')).toBeNull();
  });
});

describe('narrowQuery', () => {
  const query = narrowQuery(4 / 5, 9 / 16);

  it('umbral en la media geométrica de 4:5 y 9:16 (≈0,67), y el doble en escritorio (media ventana)', () => {
    expect(query).toBe(
      '(max-width: 1023.98px) and (max-aspect-ratio: 6708/10000), (min-width: 1024px) and (max-aspect-ratio: 13416/10000)',
    );
  });

  it('elige bien en los tamaños de prueba', () => {
    // Ventanas → proporción del panel: en escritorio es la mitad del ancho.
    const panel = (w: number, h: number) => (w >= 1024 ? w / 2 / h : w / h);
    const narrow = (w: number, h: number) => panel(w, h) < Math.sqrt((4 / 5) * (9 / 16));
    expect(narrow(375, 812)).toBe(true); // móvil → 9:16
    expect(narrow(1440, 900)).toBe(false); // 720×900 → 4:5
    expect(narrow(1024, 600)).toBe(false);
    expect(narrow(2560, 1440)).toBe(false);
    expect(narrow(768, 1024)).toBe(false); // tableta en vertical: 4:5 recorta menos
    expect(narrow(1024, 1366)).toBe(true); // panel de 512×1366
  });
});

describe('objectPosition', () => {
  it('punto focal → porcentajes, limitado a 0–1', () => {
    expect(objectPosition(0.5, 0.5)).toBe('50% 50%');
    expect(objectPosition(0.333, 1.4)).toBe('33.3% 100%');
    expect(objectPosition(-1, 0)).toBe('0% 0%');
  });
});

describe('resolveMediaVideo', () => {
  it('sin PUBLIC_MEDIA_BASE_URL no hay vídeo (Media enseña el aviso)', () => {
    expect(resolveMediaVideo(MEDIA_VIDEO, undefined)).toBeNull();
  });

  it('con base: URLs completas, versión estrecha, media query y origen para preconnect', () => {
    const video = resolveMediaVideo(MEDIA_VIDEO, BASE);
    expect(video).not.toBeNull();
    expect(video!.main.hls).toBe(`${BASE}/${MEDIA_VIDEO.hls}`);
    expect(video!.main.posterAvif).toBe(`${BASE}/${MEDIA_VIDEO.poster.avif}`);
    expect(video!.narrow?.hls).toBe(`${BASE}/${MEDIA_VIDEO.mobile!.hls}`);
    expect(video!.narrowQuery).toContain('max-aspect-ratio');
    expect(video!.origin).toBe(BASE);
    expect(video!.objectPosition).toBe('50% 50%');
    expect(video!.fullSet).toBeNull();
  });

  it('sin versión móvil ni AVIF', () => {
    const config: MediaVideoConfig = {
      slug: 'solo-escritorio',
      title: 'Vídeo',
      audio: false,
      hls: 'video/x/4x5/master.m3u8',
      mp4: 'video/x/4x5/fallback.mp4',
      poster: { jpg: 'video/x/4x5/poster.jpg' },
      width: 1080,
      height: 1350,
      focusX: 0.5,
      focusY: 0.3,
      fullSet: LAGRIMA_FULL_SET,
    };
    const video = resolveMediaVideo(config, BASE)!;
    expect(video.narrow).toBeNull();
    expect(video.narrowQuery).toBeNull();
    expect(video.main.posterAvif).toBeNull();
    expect(video.objectPosition).toBe('50% 30%');
    expect(video.fullSet?.href).toBe('https://www.youtube.com/watch?v=XokoqVkCmQg&t=2541s');
  });

  it('el vídeo configurado no está en el repo: todas sus rutas son relativas a R2', () => {
    const paths = [MEDIA_VIDEO.hls, MEDIA_VIDEO.mp4, MEDIA_VIDEO.poster.jpg, MEDIA_VIDEO.mobile!.hls];
    for (const path of paths) expect(path).toMatch(/^video\/prueba-media-[0-9a-f]{8}\//);
  });
});
