// @ts-check
/**
 * Normalización de bolos para la importación inicial (prompt maestro §7.4).
 * Funciones puras: las usa `scripts/import-gigs.mjs` y las prueban los tests.
 */

/**
 * @typedef {object} RawGigRow
 * @property {unknown} partyName  «Nombre de la Fiesta»
 * @property {unknown} date       «Fecha»
 * @property {unknown} venue      «Sala»
 * @property {unknown} city       «Ciudad»
 * @property {unknown} lineup     «LineUp»
 */

/**
 * @typedef {object} Gig
 * @property {string} event_date  AAAA-MM-DD
 * @property {string | null} party_name
 * @property {string} venue
 * @property {string} city
 * @property {string[]} lineup
 */

/**
 * @typedef {{ status: 'ok', gig: Gig } | { status: 'empty' } | { status: 'invalid', reason: string }} NormalizeResult
 */

export const COLUMNS = /** @type {const} */ ({
  partyName: 'Nombre de la Fiesta',
  date: 'Fecha',
  venue: 'Sala',
  city: 'Ciudad',
  lineup: 'LineUp',
});

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DMY_DATE = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/;

/**
 * Convierte el valor de una celda de exceljs en texto.
 * @param {unknown} value
 * @returns {string}
 */
export function cellText(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object') {
    const v = /** @type {Record<string, unknown>} */ (value);
    if (Array.isArray(v.richText)) {
      return v.richText.map((part) => cellText(/** @type {{ text?: unknown }} */ (part).text)).join('');
    }
    if ('text' in v) return cellText(v.text);
    if ('result' in v) return cellText(v.result);
  }
  return String(value);
}

/**
 * Recorta y colapsa los espacios sobrantes («LA MARIQUEEN » → «LA MARIQUEEN»).
 * @param {unknown} value
 * @returns {string}
 */
export function cleanText(value) {
  return cellText(value).replace(/\s+/g, ' ').trim();
}

/**
 * Fecha de Excel sin hora → `AAAA-MM-DD` con los componentes UTC.
 * Acepta también textos `AAAA-MM-DD` y `DD/MM/AAAA`.
 * @param {unknown} value
 * @returns {string | null}
 */
export function toIsoDate(value) {
  /** @type {[number, number, number] | null} */
  let ymd = null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    ymd = [value.getUTCFullYear(), value.getUTCMonth() + 1, value.getUTCDate()];
  } else {
    const text = cleanText(value);
    const iso = ISO_DATE.exec(text);
    const dmy = DMY_DATE.exec(text);
    if (iso) ymd = [Number(iso[1]), Number(iso[2]), Number(iso[3])];
    else if (dmy) ymd = [Number(dmy[3]), Number(dmy[2]), Number(dmy[1])];
  }
  if (!ymd) return null;
  const [y, m, d] = ymd;
  const check = new Date(Date.UTC(y, m - 1, d));
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== m - 1 || check.getUTCDate() !== d) return null;
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/**
 * Separa SOLO el lineup por «/» y recorta cada nombre. `TBA` → lista vacía.
 * @param {unknown} value
 * @returns {string[]}
 */
export function parseLineup(value) {
  const text = cleanText(value);
  if (!text || /^tba$/i.test(text)) return [];
  return text
    .split('/')
    .map((name) => cleanText(name))
    .filter((name) => name.length > 0 && !/^tba$/i.test(name));
}

/**
 * Normaliza una fila. Los nombres de fiesta con barra («WATEKE / KANDELA»)
 * no se tocan; un nombre vacío se guarda como `null` (la web muestra TBA).
 * @param {RawGigRow} raw
 * @returns {NormalizeResult}
 */
export function normalizeRow(raw) {
  const partyName = cleanText(raw.partyName);
  const venue = cleanText(raw.venue);
  const city = cleanText(raw.city);
  const lineupText = cleanText(raw.lineup);
  const hasDate = raw.date instanceof Date || cleanText(raw.date) !== '';

  if (!partyName && !venue && !city && !lineupText && !hasDate) return { status: 'empty' };

  const eventDate = toIsoDate(raw.date);
  if (!eventDate) return { status: 'invalid', reason: `fecha no válida (${cleanText(raw.date) || 'vacía'})` };
  if (!venue) return { status: 'invalid', reason: 'falta la sala' };
  if (!city) return { status: 'invalid', reason: 'falta la ciudad' };
  if (venue.length > 120) return { status: 'invalid', reason: 'sala demasiado larga' };
  if (city.length > 80) return { status: 'invalid', reason: 'ciudad demasiado larga' };
  if (partyName.length > 120) return { status: 'invalid', reason: 'nombre de fiesta demasiado largo' };

  return {
    status: 'ok',
    gig: {
      event_date: eventDate,
      party_name: partyName || null,
      venue,
      city,
      lineup: parseLineup(raw.lineup),
    },
  };
}

/**
 * Clave de duplicados: la misma que la restricción `gigs_dedupe`
 * (fecha + sala + fiesta, sin distinguir mayúsculas ni espacios).
 * @param {Pick<Gig, 'event_date' | 'venue' | 'party_name'>} gig
 * @returns {string}
 */
export function gigKey(gig) {
  const venueKey = gig.venue.trim().toLowerCase();
  const partyKey = (gig.party_name ?? '').trim().toLowerCase();
  return `${gig.event_date}|${venueKey}|${partyKey}`;
}

/**
 * Quita duplicados conservando la primera aparición.
 * @param {Gig[]} gigs
 * @returns {{ unique: Gig[], duplicates: Gig[] }}
 */
export function dedupeGigs(gigs) {
  /** @type {Map<string, Gig>} */
  const seen = new Map();
  /** @type {Gig[]} */
  const duplicates = [];
  for (const gig of gigs) {
    const key = gigKey(gig);
    if (seen.has(key)) duplicates.push(gig);
    else seen.set(key, gig);
  }
  return { unique: [...seen.values()], duplicates };
}

/**
 * Orden cronológico (y estable) para informes y SQL.
 * @param {Gig[]} gigs
 * @returns {Gig[]}
 */
export function sortGigs(gigs) {
  return [...gigs].sort((a, b) => a.event_date.localeCompare(b.event_date) || gigKey(a).localeCompare(gigKey(b)));
}

/**
 * Compara con lo que ya hay en la base de datos.
 * @param {Gig[]} incoming
 * @param {Gig[]} existing
 * @returns {{ toInsert: Gig[], toUpdate: Gig[], unchanged: Gig[] }}
 */
export function diffGigs(incoming, existing) {
  const byKey = new Map(existing.map((gig) => [gigKey(gig), gig]));
  /** @type {Gig[]} */ const toInsert = [];
  /** @type {Gig[]} */ const toUpdate = [];
  /** @type {Gig[]} */ const unchanged = [];
  for (const gig of incoming) {
    const current = byKey.get(gigKey(gig));
    if (!current) toInsert.push(gig);
    else if (sameGig(current, gig)) unchanged.push(gig);
    else toUpdate.push(gig);
  }
  return { toInsert, toUpdate, unchanged };
}

/**
 * @param {Gig} a
 * @param {Gig} b
 */
function sameGig(a, b) {
  return (
    a.event_date === b.event_date &&
    a.party_name === b.party_name &&
    a.venue === b.venue &&
    a.city === b.city &&
    a.lineup.length === b.lineup.length &&
    a.lineup.every((name, i) => name === b.lineup[i])
  );
}

/**
 * Literal SQL seguro para un texto.
 * @param {string | null} value
 */
export function sqlText(value) {
  if (value === null) return 'null';
  return `'${value.replace(/'/g, "''")}'`;
}

/**
 * @param {string[]} values
 */
export function sqlTextArray(values) {
  if (values.length === 0) return `'{}'::text[]`;
  return `array[${values.map(sqlText).join(', ')}]::text[]`;
}

/**
 * Genera un único `INSERT … ON CONFLICT` idempotente. Solo actualiza las
 * filas que cambian y devuelve, por cada fila tocada, si se insertó.
 * @param {Gig[]} gigs
 * @returns {string}
 */
export function buildUpsertSql(gigs) {
  if (gigs.length === 0) return '-- No hay bolos que importar.\n';
  const values = sortGigs(gigs)
    .map(
      (g) =>
        `  (${sqlText(g.event_date)}::date, ${sqlText(g.party_name)}, ${sqlText(g.venue)}, ${sqlText(g.city)}, ${sqlTextArray(g.lineup)})`,
    )
    .join(',\n');
  return [
    '-- Importación de bolos generada por scripts/import-gigs.mjs',
    'insert into public.gigs (event_date, party_name, venue, city, lineup)',
    'values',
    values,
    'on conflict on constraint gigs_dedupe do update set',
    '  party_name = excluded.party_name,',
    '  venue = excluded.venue,',
    '  city = excluded.city,',
    '  lineup = excluded.lineup',
    'where (gigs.party_name, gigs.venue, gigs.city, gigs.lineup)',
    '  is distinct from (excluded.party_name, excluded.venue, excluded.city, excluded.lineup)',
    'returning (xmax = 0) as inserted;',
    '',
  ].join('\n');
}
