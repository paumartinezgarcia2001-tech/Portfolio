/**
 * Fechas de los bolos (prompt maestro §7.3 y C13).
 * Todo se calcula en hora de Madrid, sin depender de la zona de la máquina.
 */

export const SITE_TIME_ZONE = 'Europe/Madrid';

/** Hora (local de Madrid) a la que un bolo pasa al archivo al día siguiente. */
export const CUTOFF_HOUR = 8;

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

const monthFormatter = new Intl.DateTimeFormat('es-ES', {
  timeZone: SITE_TIME_ZONE,
  day: '2-digit',
  month: 'long',
  year: 'numeric',
});

const madridPartsFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: SITE_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  hourCycle: 'h23',
});

function parseIsoDate(date: string): { year: number; month: number; day: number } {
  const match = ISO_DATE.exec(date);
  if (!match) throw new RangeError(`Fecha no válida (se espera AAAA-MM-DD): ${date}`);
  const [, year, month, day] = match;
  const parsed = { year: Number(year), month: Number(month), day: Number(day) };
  const check = new Date(Date.UTC(parsed.year, parsed.month - 1, parsed.day));
  if (check.getUTCMonth() !== parsed.month - 1 || check.getUTCDate() !== parsed.day) {
    throw new RangeError(`Fecha no válida: ${date}`);
  }
  return parsed;
}

function toIsoDate(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** ¿Es una fecha `AAAA-MM-DD` válida? */
export function isIsoDate(date: string): boolean {
  try {
    parseIsoDate(date);
    return true;
  } catch {
    return false;
  }
}

/**
 * `2026-09-25` → `25 SEPTIEMBRE 2026` (C13): día con dos cifras, mes en
 * español y en mayúsculas, sin la preposición «de».
 */
export function formatEventDate(date: string): string {
  const { year, month, day } = parseIsoDate(date);
  // Mediodía UTC: en Madrid sigue siendo el mismo día en cualquier época del año.
  const instant = new Date(Date.UTC(year, month - 1, day, 12));
  const parts = monthFormatter.formatToParts(instant);
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('day')} ${get('month')} ${get('year')}`.toLocaleUpperCase('es-ES');
}

/** Fecha y hora de pared en Madrid para un instante dado. */
export function madridWallClock(now: Date): { date: string; hour: number } {
  const parts = madridPartsFormatter.formatToParts(now);
  const get = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((p) => p.type === type)?.value);
  return { date: toIsoDate(get('year'), get('month'), get('day')), hour: get('hour') };
}

/** Suma (o resta) días a una fecha `AAAA-MM-DD`. */
export function addDays(date: string, days: number): string {
  const { year, month, day } = parseIsoDate(date);
  const shifted = new Date(Date.UTC(year, month - 1, day + days));
  return toIsoDate(shifted.getUTCFullYear(), shifted.getUTCMonth() + 1, shifted.getUTCDate());
}

/**
 * Fecha de corte (§7.3): `fecha(ahoraEnMadrid − 8 h)`, con horas de reloj.
 * Un bolo del día D sigue en próximas hasta las 08:00 del día D+1:
 * próximas → `event_date >= corte`; archivo → `event_date < corte`.
 * Se calcula con la hora de pared, así que los cambios de horario no
 * adelantan ni retrasan el corte.
 */
export function getCutoffDate(now: Date = new Date()): string {
  const { date, hour } = madridWallClock(now);
  return hour < CUTOFF_HOUR ? addDays(date, -1) : date;
}

/** ¿Un bolo de esa fecha sigue en «next dates»? */
export function isUpcoming(eventDate: string, now: Date = new Date()): boolean {
  return eventDate >= getCutoffDate(now);
}
