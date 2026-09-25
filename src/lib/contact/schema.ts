/**
 * Esquema del formulario de contacto (C17), el mismo para el envío con JS
 * (Action por `fetch`) y sin JS (POST del formulario). Astro convierte el
 * FormData en objeto antes de validar:
 * - un campo obligatorio vacío llega como `null` → mensaje de «obligatorio»;
 * - uno opcional vacío llega como `undefined`;
 * - una casilla marcada llega como `true` y una sin marcar, como `false`.
 *
 * Tres campos (D58): email, teléfono (opcional) y mensaje.
 *
 * Esto solo corre en el servidor (Cloudflare). En el build estático de GitHub
 * Pages el envío va a Web3Forms y lo que valida es el navegador con los
 * atributos del formulario (required, type, minlength, pattern); el texto de
 * los errores sale de CONTACT_FIELD_ERRORS igual que aquí.
 */
import { z } from 'astro/zod';
import { CONTACT_FIELD_ERRORS as MSG, CONTACT_LIMITS as LIMITS, PHONE_PATTERN } from '../../config/contact';

/** Saltos de línea de Windows y del viejo Mac → «\n» (el textarea envía «\r\n»). */
function normalizeNewlines(value: string): string {
  return value.replace(/\r\n?/g, '\n');
}

const PHONE_RE = new RegExp(`^(?:${PHONE_PATTERN})$`);

/** ¿Es un teléfono válido? Mismo criterio que el `pattern` del formulario. */
export function isPhone(value: string): boolean {
  return PHONE_RE.test(value);
}

/** Texto obligatorio: `null`/vacío/solo espacios → `required` (y para ahí). */
function requiredText(required: string) {
  return z.string({ error: required }).trim().min(1, { error: required, abort: true });
}

export const contactSchema = z.object({
  email: requiredText(MSG.emailRequired)
    .max(LIMITS.emailMax, { error: MSG.emailInvalid, abort: true })
    .pipe(z.email({ error: MSG.emailInvalid })),
  telefono: z
    .string()
    .trim()
    .max(LIMITS.phoneMax, { error: MSG.phoneInvalid, abort: true })
    .refine(isPhone, MSG.phoneInvalid)
    .optional(),
  mensaje: z
    .string({ error: MSG.messageRequired })
    .overwrite(normalizeNewlines)
    .trim()
    .min(1, { error: MSG.messageRequired, abort: true })
    .min(LIMITS.messageMin, MSG.messageTooShort)
    .max(LIMITS.messageMax, MSG.messageTooLong),
  // Honeypot y token: nunca dan error de validación (se revisan en el handler).
  botcheck: z.boolean().optional(),
  'cf-turnstile-response': z.string().optional(),
});

export type ContactInput = z.infer<typeof contactSchema>;

/** Lo que llega al email, ya limpio. */
export interface ContactMessage {
  email: string;
  phone?: string | undefined;
  message: string;
}

export function toContactMessage(input: ContactInput): ContactMessage {
  return {
    email: input.email,
    phone: input.telefono || undefined,
    message: input.mensaje,
  };
}

/** ¿El honeypot viene marcado? (Los bots rellenan y marcan todo.) */
export function isHoneypotFilled(input: Pick<ContactInput, 'botcheck'>): boolean {
  return input.botcheck === true;
}
