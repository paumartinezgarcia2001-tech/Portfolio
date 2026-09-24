/**
 * Esquemas (zod) y funciones puras del panel (C19, fase 6).
 *
 * Los formularios del panel envían FormData a las Actions `admin.*`. Astro
 * convierte el FormData en objeto antes de validar (ver src/lib/contact/schema.ts):
 * - un campo obligatorio vacío llega como `null`; uno opcional vacío, como `undefined`;
 * - una casilla marcada llega como `true` y una sin marcar, como `false`;
 * - un campo repetido (`fechas`) llega como lista si el esquema es `z.array`.
 */
import { z } from 'astro/zod';
import { ADMIN_FIELD_ERRORS as MSG, ADMIN_LIMITS as LIMITS } from '../../config/admin';
import { isIsoDate } from '../dates';
import { charLength, normalizeTickerText } from '../ticker';

// --------------------------------------------------------------------------
// Utilidades
// --------------------------------------------------------------------------

/** Recorta y colapsa espacios (como la importación, §7.4). */
export function cleanText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

/** Fecha de un bolo: `AAAA-MM-DD` que existe, entre 2000 y 2100. */
export function isGigDate(value: string): boolean {
  return isIsoDate(value) && value >= '2000-01-01' && value <= '2100-12-31';
}

/**
 * Lineup escrito a mano → lista (C19: «separado por comas»). También acepta
 * saltos de línea. `TBA` o vacío → lista vacía (la web muestra «TBA»).
 */
export function parseLineup(text: string | null | undefined): string[] {
  const names = (text ?? '')
    .split(/[,\n]/)
    .map(cleanText)
    .filter(Boolean);
  if (names.length === 1 && names[0]!.toUpperCase() === 'TBA') return [];
  return names;
}

/** Lista → texto para el campo del formulario. */
export function formatLineup(lineup: readonly string[]): string {
  return lineup.join(', ');
}

/** URL `https://` válida (la base de datos solo admite https, §7.1). */
export function isHttpsUrl(value: string): boolean {
  if (!/^https:\/\//i.test(value)) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && Boolean(url.hostname);
  } catch {
    return false;
  }
}

/** Ruta dentro del bucket de medios (misma regla que la migración 0004). */
export function isBucketPath(value: string): boolean {
  return /^[a-z0-9][a-z0-9._-]*(\/[a-z0-9][a-z0-9._-]*)*$/.test(value) && !value.includes('..');
}

/** Ruta del bucket o URL https (mixes, vídeo). */
export function isMediaRef(value: string): boolean {
  return isBucketPath(value) || isHttpsUrl(value);
}

function requiredText(message: string, max: number) {
  return z
    .string({ error: message })
    .transform(cleanText)
    .pipe(z.string().min(1, { error: message, abort: true }).max(max, MSG.tooLong(max)));
}

function optionalText(max: number) {
  return z
    .string()
    .transform(cleanText)
    .pipe(z.string().max(max, MSG.tooLong(max)))
    .optional();
}

const gigDate = z.string({ error: MSG.dateInvalid }).trim().refine(isGigDate, MSG.dateInvalid);

const ticketUrl = z
  .string()
  .trim()
  .max(LIMITS.ticketUrlMax, MSG.tooLong(LIMITS.ticketUrlMax))
  .refine(isHttpsUrl, MSG.urlInvalid)
  .optional();

// `nullish`: vacío llega como `null` (el esquema exterior es una tubería, no un opcional).
const lineupText = z
  .string()
  .nullish()
  .transform((text) => parseLineup(text))
  .pipe(
    z
      .array(z.string().max(LIMITS.artistMax, MSG.tooLong(LIMITS.artistMax)))
      .max(LIMITS.lineupMax, MSG.tooMany(LIMITS.lineupMax)),
  );

// --------------------------------------------------------------------------
// Login y MFA
// --------------------------------------------------------------------------

export const loginSchema = z.object({
  usuario: z
    .string({ error: MSG.identifierRequired })
    .trim()
    .min(1, { error: MSG.identifierRequired, abort: true })
    .max(LIMITS.identifierMax, MSG.tooLong(LIMITS.identifierMax)),
  password: z
    .string({ error: MSG.passwordRequired })
    .min(1, { error: MSG.passwordRequired, abort: true })
    .max(LIMITS.passwordMax, MSG.tooLong(LIMITS.passwordMax)),
  'cf-turnstile-response': z.string().max(2048).optional(),
});

export const mfaCodeSchema = z.object({
  codigo: z
    .string({ error: MSG.codeInvalid })
    .transform((value) => value.replace(/\s+/g, ''))
    .pipe(z.string().regex(/^\d{6}$/, MSG.codeInvalid)),
  factorId: z.string().max(100).optional(),
});

// --------------------------------------------------------------------------
// Barra de noticias
// --------------------------------------------------------------------------

export const tickerSchema = z.object({
  texto: z
    .string()
    .nullish()
    .transform((text) => normalizeTickerText(text ?? ''))
    .refine((text) => charLength(text) <= LIMITS.tickerMax, MSG.tooLong(LIMITS.tickerMax)),
  proximaFecha: z.boolean(),
});

// --------------------------------------------------------------------------
// Bolos
// --------------------------------------------------------------------------

const gigFields = {
  fiesta: optionalText(LIMITS.partyMax),
  sala: requiredText(MSG.venueRequired, LIMITS.venueMax),
  ciudad: requiredText(MSG.cityRequired, LIMITS.cityMax),
  lineup: lineupText,
  entradas: ticketUrl,
  publicado: z.boolean(),
  /** «Guardar igualmente» tras el aviso de duplicado. */
  forzar: z.boolean().optional(),
};

export const gigSchema = z.object({ fecha: gigDate, ...gigFields });

export const gigUpdateSchema = z.object({ id: z.uuid(), fecha: gigDate, ...gigFields });

export const gigBulkSchema = z.object({
  fechas: z
    .array(z.string().trim())
    .transform((dates) => [...new Set(dates.filter(Boolean))].sort())
    .pipe(
      z
        .array(z.string().refine(isGigDate, MSG.dateInvalid))
        .min(1, MSG.dateRequired)
        .max(LIMITS.bulkMax, MSG.tooMany(LIMITS.bulkMax)),
    ),
  ...gigFields,
});

export const gigDeleteSchema = z.object({ id: z.uuid() });

export type GigInput = z.infer<typeof gigSchema>;
export type GigBulkInput = z.infer<typeof gigBulkSchema>;

/** Fila para `insert`/`update` de `gigs`. */
export interface GigWrite {
  event_date: string;
  party_name: string | null;
  venue: string;
  city: string;
  lineup: string[];
  ticket_url: string | null;
  published: boolean;
}

type GigFields = Omit<GigInput, 'fecha'>;

export function toGigWrite(date: string, input: GigFields): GigWrite {
  return {
    event_date: date,
    party_name: input.fiesta || null,
    venue: input.sala,
    city: input.ciudad,
    lineup: input.lineup,
    ticket_url: input.entradas || null,
    published: input.publicado,
  };
}

/** Claves de la restricción `gigs_dedupe` (§7.1): `lower(btrim(…))`. */
export function venueKey(venue: string): string {
  return venue.trim().toLowerCase();
}

export function partyKey(party: string | null | undefined): string {
  return (party ?? '').trim().toLowerCase();
}

export interface ExistingGig {
  id: string;
  event_date: string;
  party_name: string | null;
  venue: string;
}

export interface DuplicateReport {
  /** Misma fecha y sala (otra fiesta): se avisa y se puede guardar igualmente. */
  sameVenue: ExistingGig[];
  /** Misma fecha, sala y fiesta: la base de datos no deja guardarlo. */
  exact: ExistingGig[];
}

/**
 * Bolos que chocan con los que se van a guardar (C19): misma fecha y sala. Si
 * además coincide la fiesta, es el mismo bolo (restricción `gigs_dedupe`).
 * `ignoreId`: al editar, el propio bolo no cuenta.
 */
export function findDuplicates(
  existing: readonly ExistingGig[],
  candidates: ReadonlyArray<{ event_date: string; venue: string; party_name: string | null }>,
  ignoreId?: string,
): DuplicateReport {
  const report: DuplicateReport = { sameVenue: [], exact: [] };
  for (const gig of existing) {
    if (ignoreId && gig.id === ignoreId) continue;
    const match = candidates.find(
      (candidate) => candidate.event_date === gig.event_date && venueKey(candidate.venue) === venueKey(gig.venue),
    );
    if (!match) continue;
    if (partyKey(match.party_name) === partyKey(gig.party_name)) report.exact.push(gig);
    else report.sameVenue.push(gig);
  }
  const byDate = (a: ExistingGig, b: ExistingGig) => a.event_date.localeCompare(b.event_date);
  report.sameVenue.sort(byDate);
  report.exact.sort(byDate);
  return report;
}

// --------------------------------------------------------------------------
// Info (P2)
// --------------------------------------------------------------------------

export const infoSchema = z.object({
  markdown: z
    .string()
    .nullish()
    .transform((text) => (text ?? '').replace(/\r\n?/g, '\n').trim())
    .refine((text) => text.length <= LIMITS.infoMax, MSG.tooLong(LIMITS.infoMax)),
  /** Volver al texto de src/content/info.md (guarda `null`). */
  restaurar: z.boolean().optional(),
});

// --------------------------------------------------------------------------
// Mixes (P2)
// --------------------------------------------------------------------------

const mediaRef = z.string().trim().max(500).refine(isMediaRef, MSG.pathInvalid);

export const mixUploadSchema = z.object({
  titulo: requiredText(MSG.titleRequired, LIMITS.mixTitleMax),
  tipo: z.enum(['audio', 'artwork']),
  contentType: z.string().trim().max(100),
  size: z.number().int().positive(),
});

const mixFields = {
  titulo: requiredText(MSG.titleRequired, LIMITS.mixTitleMax),
  subtitulo: optionalText(LIMITS.mixSubtitleMax),
  orden: z.number({ error: MSG.numberInvalid }).int(MSG.numberInvalid).min(-9999).max(9999).optional(),
  publicado: z.boolean(),
  caratula: mediaRef.optional(),
};

export const mixCreateSchema = z.object({
  ...mixFields,
  audio: mediaRef,
  duracion: z.number().int().positive().max(24 * 3600).optional(),
});

export const mixUpdateSchema = z.object({ id: z.uuid(), ...mixFields, quitarCaratula: z.boolean().optional() });

export const mixDeleteSchema = z.object({ id: z.uuid(), borrarArchivos: z.boolean().optional() });

// --------------------------------------------------------------------------
// Vídeo de Media (P2)
// --------------------------------------------------------------------------

const renditionSchema = z.object({
  hls: mediaRef,
  mp4: mediaRef,
  poster: z.object({ jpg: mediaRef, avif: mediaRef.optional() }),
  width: z.number().int().positive().max(10_000),
  height: z.number().int().positive().max(10_000),
});

/** Bloque que imprime scripts/video-to-hls.mjs (de `slug` a `mobile`). */
export const videoRenditionsSchema = renditionSchema.extend({
  slug: z.string().trim().min(1).max(120),
  audio: z.boolean().optional(),
  mobile: renditionSchema.optional().nullable(),
});

export type VideoRenditions = z.infer<typeof videoRenditionsSchema>;

/**
 * Lee el bloque que imprime el script. Acepta JSON o el objeto de TypeScript
 * tal cual (claves sin comillas, comillas simples, comas finales).
 */
export function parseRenditionsBlock(text: string): VideoRenditions | null {
  const trimmed = text.trim().replace(/;\s*$/, '');
  if (!trimmed) return null;
  const candidates = [trimmed, trimmed.startsWith('{') ? trimmed : `{${trimmed}}`];
  for (const candidate of candidates) {
    const json = candidate
      .replace(/\/\/[^\n]*$/gm, '')
      .replace(/'([^'\\]*(?:\\.[^'\\]*)*)'/g, (_, inner: string) => JSON.stringify(inner.replace(/\\'/g, "'")))
      .replace(/([{,]\s*)([A-Za-z_$][\w$]*)\s*:/g, '$1"$2":')
      .replace(/,\s*([}\]])/g, '$1');
    try {
      const parsed = videoRenditionsSchema.safeParse(JSON.parse(json));
      if (parsed.success) return parsed.data;
    } catch {
      // Siguiente forma.
    }
  }
  return null;
}

export const videoSchema = z.object({
  titulo: requiredText(MSG.titleRequired, 120),
  /** Punto focal en % (0–100); se guarda como 0–1. */
  focoX: z.number({ error: MSG.numberInvalid }).min(0).max(100),
  focoY: z.number({ error: MSG.numberInvalid }).min(0).max(100),
  setCompleto: z.boolean(),
  setUrl: ticketUrl,
  setTexto: optionalText(60),
  /** Bloque de scripts/video-to-hls.mjs; vacío = se queda el que hay. */
  bloque: z
    .string()
    .max(8000, MSG.tooLong(8000))
    .optional()
    .superRefine((text, ctx) => {
      if (text && text.trim() && !parseRenditionsBlock(text)) ctx.addIssue({ code: 'custom', message: MSG.jsonInvalid });
    }),
  /** Volver al vídeo de src/config/media.ts (guarda `null`). */
  restaurar: z.boolean().optional(),
});
