import { describe, expect, it, vi } from 'vitest';
import {
  buildTickerText,
  formatNextGig,
  runQuery,
  sortPast,
  sortUpcoming,
  splitByCutoff,
  toGig,
  toMix,
  toMixes,
  type Gig,
  type MixRow,
} from '../../src/lib/data/core';

const gig = (eventDate: string, extra: Partial<Gig> = {}): Gig => ({
  id: eventDate,
  eventDate,
  partyName: 'LA MARI',
  venue: 'LA MARIQUEEN',
  city: 'Madrid',
  lineup: [],
  ticketUrl: null,
  ...extra,
});

describe('toGig', () => {
  it('convierte la fila de la base de datos y tolera un lineup nulo', () => {
    expect(
      toGig({
        id: 'a',
        event_date: '2026-09-25',
        party_name: null,
        venue: 'LA2',
        city: 'Sevilla',
        lineup: null,
        ticket_url: null,
      }),
    ).toEqual({
      id: 'a',
      eventDate: '2026-09-25',
      partyName: null,
      venue: 'LA2',
      city: 'Sevilla',
      lineup: [],
      ticketUrl: null,
    });
  });
});

describe('orden y reparto por la fecha de corte', () => {
  const gigs = [gig('2026-09-12'), gig('2026-09-25'), gig('2026-09-04'), gig('2026-09-26')];

  it('próximas ascendente, archivo descendente', () => {
    expect(sortUpcoming(gigs).map((g) => g.eventDate)).toEqual([
      '2026-09-04',
      '2026-09-12',
      '2026-09-25',
      '2026-09-26',
    ]);
    expect(sortPast(gigs).map((g) => g.eventDate)).toEqual([
      '2026-09-26',
      '2026-09-25',
      '2026-09-12',
      '2026-09-04',
    ]);
  });

  it('el bolo del día del corte sigue en próximas', () => {
    const { upcoming, past } = splitByCutoff(gigs, '2026-09-25');
    expect(upcoming.map((g) => g.eventDate)).toEqual(['2026-09-25', '2026-09-26']);
    expect(past.map((g) => g.eventDate)).toEqual(['2026-09-12', '2026-09-04']);
  });

  it('mantiene el orden de alta entre bolos del mismo día', () => {
    const sameDay = [gig('2026-09-04', { id: 'primero' }), gig('2026-09-04', { id: 'segundo' })];
    expect(sortUpcoming(sameDay).map((g) => g.id)).toEqual(['primero', 'segundo']);
  });
});

describe('barra de noticias', () => {
  it('formatea la próxima fecha como pide C04', () => {
    expect(formatNextGig(gig('2026-09-25', { venue: 'LA2', city: 'Sevilla' }))).toBe(
      'PRÓXIMA FECHA: 25 SEPTIEMBRE 2026 · LA2, Sevilla',
    );
  });

  it('une el texto de los ajustes con la próxima fecha', () => {
    const text = buildTickerText(
      { tickerText: 'travest15m0 · DJ · Madrid', tickerAppendNextGig: true },
      gig('2026-09-25', { venue: 'LA2', city: 'Sevilla' }),
      'respaldo',
    );
    expect(text).toBe('travest15m0 · DJ · Madrid ✦ PRÓXIMA FECHA: 25 SEPTIEMBRE 2026 · LA2, Sevilla');
  });

  it('respeta el interruptor y usa el respaldo si no queda nada', () => {
    expect(buildTickerText({ tickerText: 'solo texto', tickerAppendNextGig: false }, gig('2026-09-25'), 'x')).toBe(
      'solo texto',
    );
    expect(buildTickerText({ tickerText: '   ', tickerAppendNextGig: true }, null, 'respaldo')).toBe('respaldo');
    expect(buildTickerText({ tickerText: '', tickerAppendNextGig: true }, gig('2026-09-25'), 'x')).toContain(
      'PRÓXIMA FECHA',
    );
  });
});

describe('runQuery', () => {
  const options = { label: 'prueba', log: () => {} };

  it('devuelve los datos cuando la consulta va bien', async () => {
    const result = await runQuery(async () => ({ data: [1, 2], error: null }), [], options);
    expect(result).toEqual({ data: [1, 2], ok: true });
  });

  it('usa la alternativa si Supabase devuelve error', async () => {
    const log = vi.fn();
    const result = await runQuery(async () => ({ data: null, error: { message: 'boom' } }), ['x'], {
      ...options,
      log,
    });
    expect(result).toEqual({ data: ['x'], ok: false });
    expect(log).toHaveBeenCalledWith(expect.stringContaining('boom'));
  });

  it('corta a los 2,5 s (por defecto) y aborta la petición', async () => {
    vi.useFakeTimers();
    const log = vi.fn();
    let aborted = false;
    const pending = runQuery<string[]>(
      (signal) => {
        signal.addEventListener('abort', () => {
          aborted = true;
        });
        return new Promise(() => {});
      },
      [],
      { ...options, log, timeoutMs: 2500 },
    );
    await vi.advanceTimersByTimeAsync(2600);
    const result = await pending;
    vi.useRealTimers();
    expect(result).toEqual({ data: [], ok: false });
    expect(aborted).toBe(true);
    expect(log).toHaveBeenCalledWith(expect.stringContaining('tiempo agotado'));
  });

  it('no lanza si la promesa falla', async () => {
    const result = await runQuery(async () => {
      throw new Error('red caída');
    }, null, options);
    expect(result).toEqual({ data: null, ok: false });
  });
});

describe('toMix (D46)', () => {
  const row: MixRow = {
    id: 'm1',
    title: 'bodyfavorspau2',
    subtitle: 'audio de prueba',
    audio_url: 'mixes/bodyfavorspau2-1a2b3c4d.mp3',
    duration_seconds: 176,
    artwork_url: 'mixes/bodyfavorspau2-1a2b3c4d.jpg',
  };

  it('completa las rutas relativas con la base del bucket', () => {
    expect(toMix(row, 'https://media.example/')).toEqual({
      id: 'm1',
      title: 'bodyfavorspau2',
      subtitle: 'audio de prueba',
      src: 'https://media.example/mixes/bodyfavorspau2-1a2b3c4d.mp3',
      durationSeconds: 176,
      artwork: 'https://media.example/mixes/bodyfavorspau2-1a2b3c4d.jpg',
    });
  });

  it('respeta las URLs completas', () => {
    const absolute = { ...row, audio_url: 'https://otro.example/a.mp3', artwork_url: null };
    expect(toMix(absolute, undefined)).toMatchObject({ src: 'https://otro.example/a.mp3', artwork: null });
  });

  it('sin base (falta PUBLIC_MEDIA_BASE_URL) no se puede reproducir: se descarta', () => {
    expect(toMix(row, undefined)).toBeNull();
    expect(toMixes([row, { ...row, id: 'm2', audio_url: 'https://otro.example/b.mp3' }], null).map((m) => m.id)).toEqual([
      'm2',
    ]);
  });
});
