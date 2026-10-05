import { describe, expect, it, vi } from 'vitest';
import { normalizeUrlVar, readWorkerVar } from '../../src/lib/env-values';

describe('readWorkerVar', () => {
  it('devuelve el texto recortado', () => {
    expect(readWorkerVar({ A: '  hola ' }, 'A')).toBe('hola');
  });

  it('sin env, sin la variable, vacía o que no es texto → undefined', () => {
    expect(readWorkerVar(undefined, 'A')).toBeUndefined();
    expect(readWorkerVar({}, 'A')).toBeUndefined();
    expect(readWorkerVar({ A: '   ' }, 'A')).toBeUndefined();
    expect(readWorkerVar({ A: { get: () => 1 } }, 'A')).toBeUndefined();
  });
});

describe('normalizeUrlVar', () => {
  it('quita la barra final', () => {
    expect(normalizeUrlVar('X', 'https://abc.supabase.co/')).toBe('https://abc.supabase.co');
  });

  it('descarta lo que no es una URL http(s) y avisa una sola vez', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(normalizeUrlVar('MAL', 'abc.supabase.co')).toBeUndefined();
    expect(normalizeUrlVar('MAL', 'javascript:alert(1)')).toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it('sin valor → undefined', () => {
    expect(normalizeUrlVar('X', undefined)).toBeUndefined();
  });
});
