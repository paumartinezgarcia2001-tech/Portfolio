/**
 * Esquema del formulario de contacto (C17), el mismo para el envío con JS
 * (Action por `fetch`) y sin JS (POST del formulario). Astro convierte el
 * FormData en objeto antes de validar:
 * - un campo obligatorio vacío llega como `null` → mensaje de «obligatorio»;
 * - uno opcional vacío llega como `undefined`;
 * - una casilla marcada llega como `true` y una sin marcar, como `false`.
 */
import { z } from 'astro/zod';
import {
  CONTACT_FIELD_ERRORS as MSG,
  CONTACT_LIMITS as LIMITS,
  CONTACT_REASON_VALUES,
  DATE_REASON,
  DEFAULT_REASON,
} from '../../config/contact';
import { isIsoDate } from '../dates';

/** Saltos de línea de Windows y del viejo Mac → «\n» (el textarea envía «\r\n»). */
function normalizeNewlines(value: string): string {
  return value.replace(/\r\n?/g, '\n');
}

/** Fecha del evento: `AAAA-MM-DD` que existe en el calendario, entre 2000 y 2100. */
export function isEventDate(value: string): boolean {
  return isIsoDate(value) && value >= '2000-01-01' && value <= '2100-12-31';
}

/** Texto obligatorio: `null`/vacío/solo espacios → `required` (y para ahí). */
function requiredText(required: string) {
  return z.string({ error: required }).trim().min(1, { error: required, abort: true });
}

export const contactSchema = z.object({
  nombre: requiredText(MSG.nameRequired).max(LIMITS.nameMax, MSG.nameTooLong),
  email: requiredText(MSG.emailRequired)
    .max(LIMITS.emailMax, { error: MSG.emailInvalid, abort: true })
    .pipe(z.email({ error: MSG.emailInvalid })),
  motivo: z.enum(CONTACT_REASON_VALUES, { error: MSG.reasonInvalid }).default(DEFAULT_REASON),
  // Solo cuenta con el motivo «booking» (ver toContactMessage). Un <input
  // type="date"> solo envía fechas válidas o nada.
  fecha: z.string().trim().refine(isEventDate, MSG.dateInvalid).optional(),
  lugar: z.string().trim().max(LIMITS.placeMax, MSG.placeTooLong).optional(),
  mensaje: z
    .string({ error: MSG.messageRequired })
    .overwrite(normalizeNewlines)
    .trim()
    .min(1, { error: MSG.messageRequired, abort: true })
    .min(LIMITS.messageMin, MSG.messageTooShort)
    .max(LIMITS.messageMax, MSG.messageTooLong),
  privacidad: z.boolean({ error: MSG.privacyRequired }).refine((accepted) => accepted, MSG.privacyRequired),
  // Honeypot y token: nunca dan error de validación (se revisan en el handler).
  website: z.string().optional(),
  'cf-turnstile-response': z.string().optional(),
});

export type ContactInput = z.infer<typeof contactSchema>;

/** Lo que llega al email, ya limpio. */
export interface ContactMessage {
  name: string;
  email: string;
  reason: ContactInput['motivo'];
  /** Solo con el motivo «booking». */
  date?: string | undefined;
  place?: string | undefined;
  message: string;
}

export function toContactMessage(input: ContactInput): ContactMessage {
  return {
    name: input.nombre,
    email: input.email,
    reason: input.motivo,
    date: input.motivo === DATE_REASON && input.fecha ? input.fecha : undefined,
    place: input.lugar || undefined,
    message: input.mensaje,
  };
}

/** ¿El honeypot trae algo? (Los bots rellenan todos los campos.) */
export function isHoneypotFilled(input: Pick<ContactInput, 'website'>): boolean {
  return (input.website ?? '').trim().length > 0;
}
