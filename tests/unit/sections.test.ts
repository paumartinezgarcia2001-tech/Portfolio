import { describe, expect, it } from 'vitest';
import { SECTIONS, getSection, sectionFromPath } from '../../src/config/sections';

describe('SECTIONS', () => {
  it('sigue el orden del brief', () => {
    expect(SECTIONS.map((s) => s.label)).toEqual(['info', 'next dates', 'media', 'archive', 'contact']);
  });

  it('tiene claves, rutas y colores únicos', () => {
    for (const field of ['key', 'href', 'colorVar'] as const) {
      const values = SECTIONS.map((s) => s[field]);
      expect(new Set(values).size).toBe(values.length);
    }
  });

  it('usa etiquetas en minúsculas', () => {
    for (const s of SECTIONS) expect(s.label).toBe(s.label.toLowerCase());
  });
});

describe('sectionFromPath', () => {
  it('reconoce cada ruta, con o sin barra final', () => {
    expect(sectionFromPath('/')).toBe('info');
    expect(sectionFromPath('/next-dates')).toBe('next');
    expect(sectionFromPath('/next-dates/')).toBe('next');
    expect(sectionFromPath('/archive')).toBe('archive');
  });

  it('devuelve none para rutas desconocidas', () => {
    expect(sectionFromPath('/aviso-legal')).toBe('none');
    expect(sectionFromPath('/cualquier-cosa')).toBe('none');
  });
});

describe('getSection', () => {
  it('devuelve la sección pedida', () => {
    expect(getSection('media').href).toBe('/media');
  });
});
