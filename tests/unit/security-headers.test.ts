import { describe, expect, it } from 'vitest';
import {
  PERMISSIONS_POLICY,
  TURNSTILE_ORIGIN,
  buildContentSecurityPolicy,
  buildHeadersFileBlock,
  buildSecurityHeaders,
  originOf,
  withSecurityHeaders,
} from '../../src/lib/security-headers';

/** §11 · cabeceras de seguridad, iguales en toda la web. */

const OPTIONS = { mediaBaseUrl: 'https://media.travest15m0.test/', supabaseUrl: 'https://proyecto.supabase.co' };

function directives(csp: string): Record<string, string[]> {
  return Object.fromEntries(
    csp.split('; ').map((part) => {
      const [name, ...sources] = part.split(' ');
      return [name!, sources];
    }),
  );
}

describe('originOf', () => {
  it('se queda con el origen y descarta lo que no es una URL', () => {
    expect(originOf('https://media.test/mixes/a.mp3')).toBe('https://media.test');
    expect(originOf('http://localhost:4322')).toBe('http://localhost:4322');
    expect(originOf(undefined)).toBeUndefined();
    expect(originOf('')).toBeUndefined();
    expect(originOf('media.test')).toBeUndefined();
  });
});

describe('buildContentSecurityPolicy', () => {
  const csp = directives(buildContentSecurityPolicy(OPTIONS));

  it('deja cargar Turnstile: su script y el iframe del widget (C17)', () => {
    expect(csp['script-src']).toEqual(["'self'", TURNSTILE_ORIGIN]);
    expect(csp['frame-src']).toEqual([TURNSTILE_ORIGIN]);
  });

  it('no permite scripts en línea (por eso Astro no los incrusta)', () => {
    expect(csp['script-src']).not.toContain("'unsafe-inline'");
    expect(csp['script-src']).not.toContain("'unsafe-eval'");
  });

  it('deja el vídeo, los mixes y sus pósters de R2, y hls.js con blob:', () => {
    expect(csp['media-src']).toEqual(["'self'", 'blob:', 'https://media.travest15m0.test']);
    expect(csp['connect-src']).toEqual(["'self'", 'https://media.travest15m0.test', 'https://proyecto.supabase.co']);
    expect(csp['img-src']).toContain('https://media.travest15m0.test');
    expect(csp['img-src']).toContain('data:');
  });

  it('cierra lo que no se usa', () => {
    expect(csp['object-src']).toEqual(["'none'"]);
    expect(csp['frame-ancestors']).toEqual(["'none'"]);
    expect(csp['base-uri']).toEqual(["'self'"]);
    expect(csp['form-action']).toEqual(["'self'"]);
    expect(csp['default-src']).toEqual(["'self'"]);
  });

  it('sin R2 ni Supabase, esas fuentes no aparecen', () => {
    const csp2 = directives(buildContentSecurityPolicy());
    expect(csp2['media-src']).toEqual(["'self'", 'blob:']);
    expect(csp2['connect-src']).toEqual(["'self'"]);
  });
});

describe('buildSecurityHeaders', () => {
  const headers = buildSecurityHeaders(OPTIONS);

  it('lleva las cinco cabeceras de §11', () => {
    expect(Object.keys(headers)).toEqual([
      'Content-Security-Policy',
      'Strict-Transport-Security',
      'X-Content-Type-Options',
      'Referrer-Policy',
      'Permissions-Policy',
    ]);
    expect(headers['Strict-Transport-Security']).toContain('max-age=31536000');
    expect(headers['X-Content-Type-Options']).toBe('nosniff');
    expect(headers['Referrer-Policy']).toBe('strict-origin-when-cross-origin');
    expect(headers['Permissions-Policy']).toBe(PERMISSIONS_POLICY);
  });

  it('la política no toca el autoplay ni la pantalla completa (la música y el vídeo)', () => {
    expect(PERMISSIONS_POLICY).not.toContain('autoplay');
    expect(PERMISSIONS_POLICY).not.toContain('fullscreen');
  });
});

describe('withSecurityHeaders', () => {
  it('añade las cabeceras a la respuesta', () => {
    const response = withSecurityHeaders(new Response('hola'), buildSecurityHeaders(OPTIONS));
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('content-security-policy')).toContain(TURNSTILE_ORIGIN);
  });

  it('si las cabeceras son inmutables, copia la respuesta', async () => {
    const immutable = Response.redirect('https://travest15m0.test/contact?enviado=1', 303);
    const response = withSecurityHeaders(immutable, buildSecurityHeaders(OPTIONS));
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('location')).toBe('https://travest15m0.test/contact?enviado=1');
    expect(response.status).toBe(303);
  });
});

describe('buildHeadersFileBlock', () => {
  it('formato del archivo `_headers` de Cloudflare: una regla y dos espacios por cabecera', () => {
    const block = buildHeadersFileBlock({ 'X-Content-Type-Options': 'nosniff' });
    expect(block).toBe('/*\n  X-Content-Type-Options: nosniff\n');
  });

  it('cada cabecera va en una sola línea (el límite de Cloudflare es 2.000 caracteres)', () => {
    const lines = buildHeadersFileBlock(buildSecurityHeaders(OPTIONS)).trimEnd().split('\n');
    expect(lines[0]).toBe('/*');
    for (const line of lines.slice(1)) {
      expect(line.startsWith('  ')).toBe(true);
      expect(line.length).toBeLessThan(2000);
    }
  });
});
