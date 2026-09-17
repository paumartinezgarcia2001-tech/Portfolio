import { describe, expect, it } from 'vitest';
import { addDays, formatEventDate, getCutoffDate, isIsoDate, isUpcoming, madridWallClock } from '../../src/lib/dates';

describe('formatEventDate', () => {
  it('usa DD MES AAAA en mayúsculas y sin «de»', () => {
    expect(formatEventDate('2026-01-01')).toBe('01 ENERO 2026');
    expect(formatEventDate('2026-09-25')).toBe('25 SEPTIEMBRE 2026');
    expect(formatEventDate('2026-09-30')).toBe('30 SEPTIEMBRE 2026');
  });

  it('nombra los doce meses en español', () => {
    const months = Array.from({ length: 12 }, (_, i) =>
      formatEventDate(`2026-${String(i + 1).padStart(2, '0')}-15`).split(' ')[1],
    );
    expect(months).toEqual([
      'ENERO',
      'FEBRERO',
      'MARZO',
      'ABRIL',
      'MAYO',
      'JUNIO',
      'JULIO',
      'AGOSTO',
      'SEPTIEMBRE',
      'OCTUBRE',
      'NOVIEMBRE',
      'DICIEMBRE',
    ]);
  });

  it('no se desplaza de día en los extremos del año ni en los cambios de horario', () => {
    expect(formatEventDate('2025-12-31')).toBe('31 DICIEMBRE 2025');
    expect(formatEventDate('2026-03-29')).toBe('29 MARZO 2026');
    expect(formatEventDate('2026-10-25')).toBe('25 OCTUBRE 2026');
  });

  it('rechaza fechas mal formadas o imposibles', () => {
    expect(() => formatEventDate('25/09/2026')).toThrow(RangeError);
    expect(() => formatEventDate('2026-02-30')).toThrow(RangeError);
    expect(isIsoDate('2026-02-28')).toBe(true);
    expect(isIsoDate('2026-13-01')).toBe(false);
  });
});

describe('getCutoffDate (§7.3)', () => {
  // Septiembre: horario de verano (UTC+2).
  it('26-09-2026 07:59 → el bolo del 25 sigue en próximas', () => {
    const now = new Date('2026-09-26T05:59:00Z'); // 07:59 en Madrid
    expect(getCutoffDate(now)).toBe('2026-09-25');
    expect(isUpcoming('2026-09-25', now)).toBe(true);
  });

  it('26-09-2026 08:00 → pasa al archivo', () => {
    const now = new Date('2026-09-26T06:00:00Z'); // 08:00 en Madrid
    expect(getCutoffDate(now)).toBe('2026-09-26');
    expect(isUpcoming('2026-09-25', now)).toBe(false);
    expect(isUpcoming('2026-09-26', now)).toBe(true);
  });

  it('a 17-09-2026 el 25-09 es próximo y el 12-09 ya es archivo', () => {
    const now = new Date('2026-09-17T10:00:00Z');
    expect(isUpcoming('2026-09-25', now)).toBe(true);
    expect(isUpcoming('2026-09-12', now)).toBe(false);
  });

  it('cambio al horario de verano (29-03-2026, último domingo de marzo)', () => {
    // A las 02:00 CET se pasa a las 03:00 CEST.
    expect(getCutoffDate(new Date('2026-03-29T00:30:00Z'))).toBe('2026-03-28'); // 01:30 CET
    expect(getCutoffDate(new Date('2026-03-29T05:59:00Z'))).toBe('2026-03-28'); // 07:59 CEST
    expect(getCutoffDate(new Date('2026-03-29T06:00:00Z'))).toBe('2026-03-29'); // 08:00 CEST
    // Con 8 horas «de reloj» (no transcurridas): a las 08:30 CEST el corte ya es el día 29.
    expect(getCutoffDate(new Date('2026-03-29T06:30:00Z'))).toBe('2026-03-29');
  });

  it('cambio al horario de invierno (25-10-2026, último domingo de octubre)', () => {
    // A las 03:00 CEST se vuelve a las 02:00 CET.
    expect(getCutoffDate(new Date('2026-10-25T00:30:00Z'))).toBe('2026-10-24'); // 02:30 CEST
    expect(getCutoffDate(new Date('2026-10-25T01:30:00Z'))).toBe('2026-10-24'); // 02:30 CET
    expect(getCutoffDate(new Date('2026-10-25T06:59:00Z'))).toBe('2026-10-24'); // 07:59 CET
    expect(getCutoffDate(new Date('2026-10-25T07:00:00Z'))).toBe('2026-10-25'); // 08:00 CET
  });

  it('funciona en el cambio de año y en invierno (UTC+1)', () => {
    expect(getCutoffDate(new Date('2026-01-01T06:59:00Z'))).toBe('2025-12-31'); // 07:59 CET
    expect(getCutoffDate(new Date('2026-01-01T07:00:00Z'))).toBe('2026-01-01'); // 08:00 CET
  });

  it('no depende de la zona horaria de la máquina', () => {
    const now = new Date('2026-09-25T22:30:00Z'); // 00:30 del 26 en Madrid
    expect(madridWallClock(now)).toEqual({ date: '2026-09-26', hour: 0 });
    expect(getCutoffDate(now)).toBe('2026-09-25');
  });
});

describe('addDays', () => {
  it('cruza meses y años', () => {
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(addDays('2024-03-01', -1)).toBe('2024-02-29');
    expect(addDays('2025-12-31', 1)).toBe('2026-01-01');
  });
});
