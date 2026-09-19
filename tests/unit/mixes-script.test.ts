import { describe, expect, it } from 'vitest';
import {
  buildMixUpsertSql,
  loudnormFilter,
  mixKey,
  parseLoudnorm,
  slugify,
  validateMixRow,
} from '../../scripts/lib/mixes.mjs';

const row = {
  title: 'SAOKO (ROSALÍA)',
  subtitle: "audio de prueba · d'ella",
  audio_url: 'mixes/saoko-rosalia-1a2b3c4d.mp3',
  duration_seconds: 138,
  artwork_url: null,
  published: true,
  sort_order: 1,
};

describe('slugify', () => {
  it('minúsculas, sin acentos ni símbolos', () => {
    expect(slugify('SAOKO (ROSALÍA)')).toBe('saoko-rosalia');
    expect(slugify('PAU_CLASE4')).toBe('pau-clase4');
    expect(slugify('  Insulto Club · 2026  ')).toBe('insulto-club-2026');
    expect(slugify('¡¡¡')).toBe('');
  });

  it('como mucho 60 caracteres y sin guion al final', () => {
    const slug = slugify(`${'a'.repeat(59)} b`);
    expect(slug.length).toBeLessThanOrEqual(60);
    expect(slug.endsWith('-')).toBe(false);
  });
});

describe('mixKey', () => {
  it('mixes/<slug>-<hash de 8>.<ext>', () => {
    expect(mixKey('saoko', 'ABCDEF0123456789')).toBe('mixes/saoko-abcdef01.mp3');
    expect(mixKey('saoko', 'abcdef0123', 'jpg')).toBe('mixes/saoko-abcdef01.jpg');
  });

  it('rechaza slugs y hashes raros', () => {
    expect(() => mixKey('Con Espacios', 'abcdef01')).toThrow(/Slug/);
    expect(() => mixKey('ok', 'xyz')).toThrow(/Hash/);
  });
});

describe('loudnorm', () => {
  const stderr = `[Parsed_loudnorm_0 @ 0x5]\n{\n\t"input_i" : "-11.04",\n\t"input_tp" : "-2.16",\n\t"input_lra" : "8.40",\n\t"input_thresh" : "-21.22",\n\t"output_i" : "-14.00",\n\t"target_offset" : "0.12"\n}\n`;

  it('lee las medidas de la primera pasada', () => {
    expect(parseLoudnorm(`ruido previo {no} \n${stderr}`)).toMatchObject({ input_i: '-11.04', target_offset: '0.12' });
  });

  it('falla si no hay medidas', () => {
    expect(() => parseLoudnorm('nada')).toThrow(/loudnorm/);
    expect(() => parseLoudnorm('{"input_i": "-inf"}')).toThrow(/no válida/);
  });

  it('segunda pasada lineal hacia −14 LUFS y −1 dBTP', () => {
    const filter = loudnormFilter(parseLoudnorm(stderr));
    expect(filter).toContain('loudnorm=I=-14:TP=-1:LRA=11');
    expect(filter).toContain('measured_I=-11.04');
    expect(filter).toContain('offset=0.12');
    expect(filter).toContain('linear=true');
  });
});

describe('buildMixUpsertSql', () => {
  it('upsert idempotente por audio_url, con los textos escapados', () => {
    const sql = buildMixUpsertSql([row]);
    expect(sql).toContain('insert into public.mixes (title, subtitle, audio_url, duration_seconds, artwork_url, published, sort_order)');
    expect(sql).toContain("('SAOKO (ROSALÍA)', 'audio de prueba · d''ella', 'mixes/saoko-rosalia-1a2b3c4d.mp3', 138, null, true, 1)");
    expect(sql).toContain('on conflict on constraint mixes_audio_url_key do update set');
    expect(sql).toContain('is distinct from');
  });

  it('sin filas, un comentario', () => {
    expect(buildMixUpsertSql([])).toMatch(/^--/);
  });

  it('valida como la tabla: rutas relativas o https, duración positiva', () => {
    expect(() => validateMixRow(row)).not.toThrow();
    expect(() => validateMixRow({ ...row, audio_url: 'https://media.example/mixes/a.mp3' })).not.toThrow();
    expect(() => validateMixRow({ ...row, audio_url: 'http://inseguro/a.mp3' })).toThrow(/audio_url/);
    expect(() => validateMixRow({ ...row, audio_url: '../fuera.mp3' })).toThrow(/audio_url/);
    expect(() => validateMixRow({ ...row, audio_url: 'Mixes/Mayus.mp3' })).toThrow(/audio_url/);
    expect(() => validateMixRow({ ...row, artwork_url: 'mixes/a.jpg' })).not.toThrow();
    expect(() => validateMixRow({ ...row, duration_seconds: 0 })).toThrow(/Duración/);
    expect(() => validateMixRow({ ...row, title: '' })).toThrow(/título/);
  });
});
