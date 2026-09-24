/**
 * Panel oculto (C19, fase 6): funciones puras de acceso, validación,
 * duplicados, Markdown de Info, firma de R2 y vídeo.
 */
import { describe, expect, it } from 'vitest';
import { MEDIA_VIDEO } from '../../src/config/media';
import { classifyAuthError, matchesAdminPath, resolveLoginEmail } from '../../src/lib/admin/access';
import { isMixObjectKey, presignR2, presignUrl, slugify, uploadKey } from '../../src/lib/admin/r2';
import {
  findDuplicates,
  gigBulkSchema,
  gigSchema,
  isBucketPath,
  parseLineup,
  parseRenditionsBlock,
  tickerSchema,
  toGigWrite,
  videoSchema,
} from '../../src/lib/admin/schemas';
import { buildVideoConfig, parseStoredVideo, toStoredVideo } from '../../src/lib/admin/video';
import { escapeHtml, infoSourceToMarkdown, renderInfoMarkdown } from '../../src/lib/markdown';
import { previewText } from '../../src/scripts/admin/ticker';

describe('acceso', () => {
  it('compara el nombre del panel con el secreto', () => {
    expect(matchesAdminPath('panel-secreto', 'panel-secreto')).toBe(true);
    expect(matchesAdminPath('panel-secretO', 'panel-secreto')).toBe(false);
    expect(matchesAdminPath('panel-secret', 'panel-secreto')).toBe(false);
    expect(matchesAdminPath('panel-secreto-2', 'panel-secreto')).toBe(false);
    expect(matchesAdminPath('', 'panel-secreto')).toBe(false);
  });

  it('sin ADMIN_PATH, el panel no existe', () => {
    expect(matchesAdminPath('lo-que-sea', undefined)).toBe(false);
    expect(matchesAdminPath('', '')).toBe(false);
  });

  it('usuario → email: email tal cual o alias', () => {
    const alias = { username: 'Pau', email: 'Pau@Ejemplo.com' };
    expect(resolveLoginEmail(' pau@ejemplo.com ', alias)).toBe('pau@ejemplo.com');
    expect(resolveLoginEmail('PAU', alias)).toBe('pau@ejemplo.com');
    expect(resolveLoginEmail('otra', alias)).toBeNull();
    expect(resolveLoginEmail('pau', { username: undefined, email: undefined })).toBeNull();
    expect(resolveLoginEmail('no-es@email', alias)).toBeNull();
    expect(resolveLoginEmail('', alias)).toBeNull();
  });

  it('errores de Supabase Auth: todo lo de credenciales es genérico', () => {
    expect(classifyAuthError({ code: 'invalid_credentials', status: 400 })).toBe('credentials');
    expect(classifyAuthError({ code: 'email_not_confirmed', status: 400 })).toBe('credentials');
    expect(classifyAuthError({ code: 'user_banned', status: 400 })).toBe('credentials');
    expect(classifyAuthError({ code: 'captcha_failed', status: 400 })).toBe('captcha');
    expect(classifyAuthError({ code: 'over_request_rate_limit', status: 429 })).toBe('rate-limit');
    expect(classifyAuthError({ status: 503 })).toBe('unavailable');
  });
});

describe('bolos', () => {
  it('lineup separado por comas → lista; TBA o vacío → []', () => {
    expect(parseLineup('MANUELAC0RE,  TRAVEST15M0 , ,NEGRACONDA')).toEqual(['MANUELAC0RE', 'TRAVEST15M0', 'NEGRACONDA']);
    expect(parseLineup('UNA\nDOS')).toEqual(['UNA', 'DOS']);
    expect(parseLineup('tba')).toEqual([]);
    expect(parseLineup('')).toEqual([]);
    expect(parseLineup(null)).toEqual([]);
    // No se parte por «/» (nombres como «WATEKE / KANDELA»).
    expect(parseLineup('WATEKE / KANDELA')).toEqual(['WATEKE / KANDELA']);
  });

  it('valida fecha, sala, ciudad y enlace https', () => {
    const ok = gigSchema.safeParse({
      fecha: '2099-12-24',
      fiesta: '  LA   MARI ',
      sala: ' LA MARIQUEEN ',
      ciudad: 'Madrid',
      lineup: 'A, B',
      entradas: 'https://example.com',
      publicado: true,
    });
    expect(ok.success).toBe(true);
    expect(toGigWrite(ok.data!.fecha, ok.data!)).toEqual({
      event_date: '2099-12-24',
      party_name: 'LA MARI',
      venue: 'LA MARIQUEEN',
      city: 'Madrid',
      lineup: ['A', 'B'],
      ticket_url: 'https://example.com',
      published: true,
    });

    const bad = gigSchema.safeParse({
      fecha: '2099-02-30',
      sala: '   ',
      ciudad: null,
      lineup: null,
      entradas: 'http://example.com',
      publicado: false,
    });
    expect(bad.success).toBe(false);
    const fields = bad.error!.issues.map((issue) => `${String(issue.path[0])}: ${issue.message}`);
    expect(fields).toContain('fecha: Escribe una fecha válida.');
    expect(fields).toContain('sala: Escribe la sala.');
    expect(fields).toContain('ciudad: Escribe la ciudad.');
    expect(fields).toContain('entradas: El enlace tiene que empezar por https://');
  });

  it('sin nombre de fiesta → null (la web pone TBA)', () => {
    const parsed = gigSchema.parse({ fecha: '2099-01-01', sala: 'LA2', ciudad: 'Sevilla', lineup: null, publicado: true });
    expect(toGigWrite(parsed.fecha, parsed).party_name).toBeNull();
    expect(toGigWrite(parsed.fecha, parsed).lineup).toEqual([]);
  });

  it('varias fechas: sin repetir, ordenadas y como mucho 60', () => {
    const base = { sala: 'X', ciudad: 'Y', lineup: null, publicado: true };
    expect(gigBulkSchema.parse({ ...base, fechas: ['2099-03-13', '', '2099-03-06', '2099-03-13'] }).fechas).toEqual([
      '2099-03-06',
      '2099-03-13',
    ]);
    expect(gigBulkSchema.safeParse({ ...base, fechas: [''] }).success).toBe(false);
    const many = Array.from({ length: 61 }, (_, i) => `2099-01-${String((i % 28) + 1).padStart(2, '0')}`).map((d, i) =>
      d.replace('2099-01', `2099-${String(Math.floor(i / 28) + 1).padStart(2, '0')}`),
    );
    expect(gigBulkSchema.safeParse({ ...base, fechas: many }).success).toBe(false);
  });

  it('duplicados: misma fecha y sala (aviso) o además misma fiesta (no se puede)', () => {
    const existing = [
      { id: '1', event_date: '2099-01-01', party_name: 'LA MARI', venue: 'LA MARIQUEEN' },
      { id: '2', event_date: '2099-01-01', party_name: null, venue: 'LA2' },
    ];
    const report = findDuplicates(existing, [{ event_date: '2099-01-01', venue: ' la mariqueen', party_name: 'otra' }]);
    expect(report.sameVenue.map((gig) => gig.id)).toEqual(['1']);
    expect(report.exact).toEqual([]);

    const exact = findDuplicates(existing, [{ event_date: '2099-01-01', venue: 'LA MARIQUEEN', party_name: 'la mari ' }]);
    expect(exact.exact.map((gig) => gig.id)).toEqual(['1']);

    const tba = findDuplicates(existing, [{ event_date: '2099-01-01', venue: 'la2', party_name: null }]);
    expect(tba.exact.map((gig) => gig.id)).toEqual(['2']);

    // Al editar, el propio bolo no cuenta.
    expect(findDuplicates(existing, [{ event_date: '2099-01-01', venue: 'LA2', party_name: null }], '2').exact).toEqual([]);
  });
});

describe('barra de noticias', () => {
  it('máximo 500 caracteres (contando emojis como uno), espacios colapsados', () => {
    expect(tickerSchema.parse({ texto: '  hola   mundo ', proximaFecha: true })).toEqual({ texto: 'hola mundo', proximaFecha: true });
    expect(tickerSchema.parse({ texto: null, proximaFecha: false }).texto).toBe('');
    expect(tickerSchema.safeParse({ texto: '✦'.repeat(500), proximaFecha: true }).success).toBe(true);
    expect(tickerSchema.safeParse({ texto: 'x'.repeat(501), proximaFecha: true }).success).toBe(false);
  });

  it('vista previa: igual que la web', () => {
    const next = 'PRÓXIMA FECHA: 25 SEPTIEMBRE 2026 · LA2, Sevilla';
    expect(previewText('Hola', true, next, 'fallback')).toBe(`Hola ✦ ${next}`);
    expect(previewText('Hola', false, next, 'fallback')).toBe('Hola');
    expect(previewText('  ', false, next, 'fallback')).toBe('fallback');
    expect(previewText('', true, next, 'fallback')).toBe(next);
  });
});

describe('Markdown de Info', () => {
  it('titulillos, párrafos y enlaces', () => {
    const html = renderInfoMarkdown(
      '## Info\n\nPrimer párrafo\nsigue aquí.\n\n## Booking\nEscríbeme desde [contact](/contact).\n\n[SoundCloud ↗](https://soundcloud.com/travest15m0)',
      { resolveInternal: (path) => `/Portfolio${path}` },
    );
    expect(html).toBe(
      [
        '<h2>Info</h2>',
        '<p>Primer párrafo sigue aquí.</p>',
        '<h2>Booking</h2>\n<p>Escríbeme desde <a href="/Portfolio/contact">contact</a>.</p>',
        '<p><a href="https://soundcloud.com/travest15m0" target="_blank" rel="noopener">SoundCloud ↗</a></p>',
      ].join('\n'),
    );
  });

  it('escapa todo el HTML y no deja enlaces peligrosos', () => {
    const html = renderInfoMarkdown('<script>alert(1)</script>\n\n[x](javascript:alert(1)) [y](//evil.example) <img src=x onerror=alert(1)>');
    expect(html).not.toContain('<script');
    expect(html).not.toContain('<img');
    expect(html).not.toContain('href="javascript');
    expect(html).not.toContain('href="//evil');
    expect(html).toContain('&lt;script&gt;');
    expect(escapeHtml(`"'<>&`)).toBe('&quot;&#39;&lt;&gt;&amp;');
  });

  it('el texto del repo (info.md) pasa a Markdown sencillo', () => {
    const md = infoSourceToMarkdown(
      '<!-- comentario -->\n\n## Escucha\n\n<a href="https://soundcloud.com/x" target="_blank" rel="noopener">SoundCloud ↗</a>',
    );
    expect(md).toBe('## Escucha\n\n[SoundCloud ↗](https://soundcloud.com/x)');
  });
});

describe('R2', () => {
  it('firma como AWS (vector de ejemplo de la documentación de S3)', async () => {
    const url = await presignUrl({
      method: 'GET',
      host: 'examplebucket.s3.amazonaws.com',
      path: '/test.txt',
      accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
      secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
      region: 'us-east-1',
      expiresIn: 86400,
      now: new Date('2013-05-24T00:00:00Z'),
    });
    expect(url).toContain('X-Amz-Signature=aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404');
  });

  it('URL de subida al endpoint S3 de la cuenta, con el bucket en la ruta', async () => {
    const url = new URL(
      await presignR2(
        { accountId: 'abc123', accessKeyId: 'AK', secretAccessKey: 'SK', bucket: 'travest15m0-media' },
        'PUT',
        'mixes/saoko-rosalia-0a1b2c3d.mp3',
        900,
        new Date('2026-09-24T10:00:00Z'),
      ),
    );
    expect(url.origin).toBe('https://abc123.r2.cloudflarestorage.com');
    expect(url.pathname).toBe('/travest15m0-media/mixes/saoko-rosalia-0a1b2c3d.mp3');
    expect(url.searchParams.get('X-Amz-Credential')).toBe('AK/20260924/auto/s3/aws4_request');
    expect(url.searchParams.get('X-Amz-Expires')).toBe('900');
    expect(url.searchParams.get('X-Amz-Signature')).toMatch(/^[0-9a-f]{64}$/);
  });

  it('nombres de archivo: slug + sufijo, válidos para la base de datos (0004)', () => {
    expect(slugify('SAOKO (ROSALÍA)')).toBe('saoko-rosalia');
    expect(uploadKey('Sesión en LA2 · Sevilla', 'mp3', '0a1b2c3d')).toBe('mixes/sesion-en-la2-sevilla-0a1b2c3d.mp3');
    expect(uploadKey('✦✦✦', 'm4a', 'ffffffff')).toBe('mixes/mix-ffffffff.m4a');
    expect(uploadKey('x', 'mp3')).toMatch(/^mixes\/x-[0-9a-f]{8}\.mp3$/);
    expect(isBucketPath(uploadKey('Mix de prueba', 'mp3'))).toBe(true);
    expect(isMixObjectKey('mixes/a-1.mp3')).toBe(true);
    expect(isMixObjectKey('video/prueba/master.m3u8')).toBe(false);
    expect(isMixObjectKey('mixes/../secreto')).toBe(false);
  });
});

describe('vídeo de Media', () => {
  it('lee el bloque que imprime video-to-hls (TS o JSON)', () => {
    const block = `slug: 'nuevo-video',
  audio: false,
  hls: 'video/nuevo-video-1234/4x5/master.m3u8',
  mp4: 'video/nuevo-video-1234/4x5/fallback.mp4',
  poster: { jpg: 'video/nuevo-video-1234/4x5/poster.jpg', avif: 'video/nuevo-video-1234/4x5/poster.avif' },
  width: 1080,
  height: 1350,
  mobile: {
    hls: 'video/nuevo-video-1234/9x16/master.m3u8',
    mp4: 'video/nuevo-video-1234/9x16/fallback.mp4',
    poster: { jpg: 'video/nuevo-video-1234/9x16/poster.jpg' },
    width: 1080,
    height: 1920,
  },`;
    const parsed = parseRenditionsBlock(block);
    expect(parsed?.slug).toBe('nuevo-video');
    expect(parsed?.mobile?.height).toBe(1920);
    expect(parseRenditionsBlock(JSON.stringify({ ...parsed }))?.hls).toBe(parsed?.hls);
    expect(parseRenditionsBlock('{ "slug": "x" }')).toBeNull();
    expect(parseRenditionsBlock('no es nada')).toBeNull();
  });

  it('formulario + vídeo actual → vídeo guardado; y vuelta', () => {
    const input = videoSchema.parse({
      titulo: 'Set en LA2',
      focoX: 30,
      focoY: 62.5,
      setCompleto: true,
      setUrl: 'https://www.youtube.com/watch?v=XokoqVkCmQg&t=2541s',
      setTexto: undefined,
      bloque: undefined,
    });
    const config = buildVideoConfig(input, MEDIA_VIDEO);
    expect(config).toMatchObject({ slug: MEDIA_VIDEO.slug, title: 'Set en LA2', focusX: 0.3, focusY: 0.625 });
    expect(config.fullSet).toEqual({ href: 'https://www.youtube.com/watch?v=XokoqVkCmQg&t=2541s', label: 'ver set completo' });
    const stored = toStoredVideo(config);
    expect(parseStoredVideo(stored)).toEqual({ ...config, mobile: config.mobile });
    expect(parseStoredVideo({ slug: 'roto' })).toBeNull();
    expect(parseStoredVideo(null)).toBeNull();
  });

  it('un bloque que no se entiende es un error del campo', () => {
    const result = videoSchema.safeParse({ titulo: 'x', focoX: 50, focoY: 50, setCompleto: false, bloque: 'hola' });
    expect(result.success).toBe(false);
  });
});
