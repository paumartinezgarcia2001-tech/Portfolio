import { describe, expect, it } from 'vitest';
import { cleanPathname, joinBase, normalizeBase, stripBase, withBase, withoutBase } from '../../src/lib/url';

describe('normalizeBase', () => {
  it('quita la barra final', () => {
    expect(normalizeBase('/')).toBe('');
    expect(normalizeBase('/Portfolio')).toBe('/Portfolio');
    expect(normalizeBase('/Portfolio/')).toBe('/Portfolio');
    expect(normalizeBase(undefined)).toBe('');
  });
});

describe('joinBase', () => {
  it('añade el base a las rutas internas', () => {
    expect(joinBase('/Portfolio', '/')).toBe('/Portfolio/');
    expect(joinBase('/Portfolio/', '/next-dates')).toBe('/Portfolio/next-dates');
    expect(joinBase('/Portfolio', '/favicon.svg')).toBe('/Portfolio/favicon.svg');
  });

  it('no toca lo externo, lo relativo ni los anclas', () => {
    expect(joinBase('/Portfolio', 'https://soundcloud.com/travest15m0')).toBe('https://soundcloud.com/travest15m0');
    expect(joinBase('/Portfolio', '//example.com/x')).toBe('//example.com/x');
    expect(joinBase('/Portfolio', 'contact')).toBe('contact');
    expect(joinBase('/Portfolio', '#panel')).toBe('#panel');
  });

  it('no duplica el base', () => {
    expect(joinBase('/Portfolio', '/Portfolio/archive')).toBe('/Portfolio/archive');
    expect(joinBase('/Portfolio', '/Portfolios')).toBe('/Portfolio/Portfolios');
  });

  it('en la raíz no cambia nada', () => {
    expect(joinBase('/', '/')).toBe('/');
    expect(joinBase('', '/next-dates')).toBe('/next-dates');
  });
});

describe('stripBase', () => {
  it('quita el base', () => {
    expect(stripBase('/Portfolio', '/Portfolio')).toBe('/');
    expect(stripBase('/Portfolio', '/Portfolio/')).toBe('/');
    expect(stripBase('/Portfolio', '/Portfolio/next-dates')).toBe('/next-dates');
  });

  it('deja igual lo que no lleva el base', () => {
    expect(stripBase('/Portfolio', '/next-dates')).toBe('/next-dates');
    expect(stripBase('/Portfolio', '/Portfolios')).toBe('/Portfolios');
    expect(stripBase('/', '/archive')).toBe('/archive');
  });
});

describe('cleanPathname', () => {
  it('quita la extensión .html de build.format «file»', () => {
    expect(cleanPathname('/Portfolio/index.html')).toBe('/Portfolio/');
    expect(cleanPathname('/Portfolio/next-dates.html')).toBe('/Portfolio/next-dates');
    expect(cleanPathname('/index.html')).toBe('/');
  });

  it('deja igual las rutas sin extensión (Cloudflare)', () => {
    expect(cleanPathname('/')).toBe('/');
    expect(cleanPathname('/archive')).toBe('/archive');
  });
});

describe('withBase / withoutBase (base de los tests: «/»)', () => {
  it('no cambian nada en la raíz', () => {
    expect(withBase('/')).toBe('/');
    expect(withBase('/media')).toBe('/media');
    expect(withoutBase('/media')).toBe('/media');
  });
});
