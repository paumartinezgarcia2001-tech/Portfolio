import { describe, expect, it } from 'vitest';
import {
  buildUpsertSql,
  cleanText,
  dedupeGigs,
  diffGigs,
  gigKey,
  normalizeRow,
  parseLineup,
  sortGigs,
  sqlText,
  toIsoDate,
} from '../../scripts/lib/gigs.mjs';

const excelDate = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

describe('normalizeRow con casos reales de los .xlsx', () => {
  it('«TRAVEST15M0 /PERLA PRECIOSA»: separa el lineup aunque falte el espacio', () => {
    const result = normalizeRow({
      partyName: 'INSULTO CLUB',
      date: excelDate('2025-03-21'),
      venue: 'SIROCO',
      city: 'Madrid',
      lineup: 'TRAVEST15M0 /PERLA PRECIOSA',
    });
    expect(result).toEqual({
      status: 'ok',
      gig: {
        event_date: '2025-03-21',
        party_name: 'INSULTO CLUB',
        venue: 'SIROCO',
        city: 'Madrid',
        lineup: ['TRAVEST15M0', 'PERLA PRECIOSA'],
      },
    });
  });

  it('«WATEKE / KANDELA»: no separa los nombres de fiesta con barra', () => {
    const result = normalizeRow({
      partyName: 'WATEKE / KANDELA',
      date: excelDate('2022-04-28'),
      venue: 'EVEN',
      city: 'Sevilla',
      lineup: 'KIEVRA / ELEKTRONIK BOY',
    });
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(result.gig.party_name).toBe('WATEKE / KANDELA');
    expect(result.gig.lineup).toEqual(['KIEVRA', 'ELEKTRONIK BOY']);
  });

  it('nombre vacío → null (la web muestra TBA)', () => {
    const result = normalizeRow({
      partyName: undefined,
      date: excelDate('2026-09-25'),
      venue: 'LA2',
      city: 'Sevilla ',
      lineup: 'TBA',
    });
    expect(result).toEqual({
      status: 'ok',
      gig: { event_date: '2026-09-25', party_name: null, venue: 'LA2', city: 'Sevilla', lineup: [] },
    });
  });

  it('«TBA» en el lineup → lista vacía', () => {
    expect(parseLineup('TBA')).toEqual([]);
    expect(parseLineup(' tba ')).toEqual([]);
    expect(parseLineup('')).toEqual([]);
    expect(parseLineup(null)).toEqual([]);
  });

  it('recorta y colapsa los espacios sobrantes', () => {
    const result = normalizeRow({
      partyName: '  CLUB   RUEDO ',
      date: excelDate('2026-01-24'),
      venue: 'LA MARIQUEEN ',
      city: ' Madrid',
      lineup: ' MONSTRUO CHILLÓN  /  TTOTTEMM /',
    });
    expect(result).toEqual({
      status: 'ok',
      gig: {
        event_date: '2026-01-24',
        party_name: 'CLUB RUEDO',
        venue: 'LA MARIQUEEN',
        city: 'Madrid',
        lineup: ['MONSTRUO CHILLÓN', 'TTOTTEMM'],
      },
    });
    expect(cleanText(' LAS  NIÑAS\t')).toBe('LAS NIÑAS');
  });

  it('ignora las filas de relleno y descarta las incompletas', () => {
    expect(normalizeRow({ partyName: null, date: null, venue: null, city: null, lineup: ' ' })).toEqual({
      status: 'empty',
    });
    expect(normalizeRow({ partyName: 'X', date: null, venue: 'SALA', city: 'Madrid', lineup: '' })).toMatchObject({
      status: 'invalid',
    });
    expect(normalizeRow({ partyName: 'X', date: excelDate('2026-01-01'), venue: '', city: 'Madrid', lineup: '' })).toEqual(
      { status: 'invalid', reason: 'falta la sala' },
    );
  });

  it('lee texto enriquecido y fórmulas de exceljs', () => {
    const result = normalizeRow({
      partyName: { richText: [{ text: 'LA ' }, { text: 'MARI' }] },
      date: excelDate('2026-08-28'),
      venue: { formula: 'A1', result: 'LA MARIQUEEN' },
      city: 'Madrid',
      lineup: 'TBA',
    });
    expect(result.status === 'ok' && result.gig.party_name).toBe('LA MARI');
    expect(result.status === 'ok' && result.gig.venue).toBe('LA MARIQUEEN');
  });
});

describe('toIsoDate', () => {
  it('usa los componentes UTC de la fecha de Excel', () => {
    expect(toIsoDate(excelDate('2022-04-19'))).toBe('2022-04-19');
    expect(toIsoDate(new Date('2025-12-31T00:00:00Z'))).toBe('2025-12-31');
  });

  it('acepta textos AAAA-MM-DD y DD/MM/AAAA y rechaza los imposibles', () => {
    expect(toIsoDate('2026-09-25')).toBe('2026-09-25');
    expect(toIsoDate('5/9/2026')).toBe('2026-09-05');
    expect(toIsoDate('31/02/2026')).toBeNull();
    expect(toIsoDate('mañana')).toBeNull();
  });
});

describe('duplicados y orden', () => {
  const base = { event_date: '2026-09-04', party_name: 'LA MARI', venue: 'LA MARIQUEEN', city: 'Madrid', lineup: [] };

  it('la clave no distingue mayúsculas ni espacios, como gigs_dedupe', () => {
    expect(gigKey(base)).toBe(gigKey({ ...base, party_name: ' la mari', venue: 'La Mariqueen ' }));
    expect(gigKey({ ...base, party_name: null })).toBe('2026-09-04|la mariqueen|');
  });

  it('conserva la primera aparición y cuenta los duplicados', () => {
    const { unique, duplicates } = dedupeGigs([base, { ...base, lineup: ['X'] }, { ...base, event_date: '2026-09-05' }]);
    expect(unique).toHaveLength(2);
    expect(duplicates).toHaveLength(1);
    expect(unique[0]?.lineup).toEqual([]);
  });

  it('mantiene como bolos distintos dos fiestas el mismo día', () => {
    const { unique } = dedupeGigs([base, { ...base, party_name: 'LAS NIÑAS', venue: 'SALA YASTA' }]);
    expect(unique).toHaveLength(2);
  });

  it('ordena por fecha', () => {
    const sorted = sortGigs([
      { ...base, event_date: '2026-09-12' },
      { ...base, event_date: '2022-04-19' },
      base,
    ]);
    expect(sorted.map((g) => g.event_date)).toEqual(['2022-04-19', '2026-09-04', '2026-09-12']);
  });

  it('distingue insertar, actualizar y sin cambios', () => {
    const existing = [base, { ...base, event_date: '2026-09-05' }];
    const incoming = [base, { ...base, event_date: '2026-09-05', lineup: ['TRAVEST15M0'] }, { ...base, event_date: '2026-09-11' }];
    const { toInsert, toUpdate, unchanged } = diffGigs(incoming, existing);
    expect(toInsert.map((g) => g.event_date)).toEqual(['2026-09-11']);
    expect(toUpdate.map((g) => g.event_date)).toEqual(['2026-09-05']);
    expect(unchanged).toHaveLength(1);
  });
});

describe('buildUpsertSql', () => {
  it('escapa comillas y genera un upsert idempotente', () => {
    const sql = buildUpsertSql([
      { event_date: '2026-09-25', party_name: null, venue: "L'ESTACIÓ", city: 'Sevilla', lineup: [] },
      { event_date: '2026-09-26', party_name: 'A', venue: 'B', city: 'C', lineup: ["O'NEIL", 'X'] },
    ]);
    expect(sql).toContain("('2026-09-25'::date, null, 'L''ESTACIÓ', 'Sevilla', '{}'::text[])");
    expect(sql).toContain("array['O''NEIL', 'X']::text[]");
    expect(sql).toContain('on conflict on constraint gigs_dedupe do update');
    expect(sql).toContain('is distinct from');
    expect(sqlText("'; drop table gigs; --")).toBe("'''; drop table gigs; --'");
  });
});
