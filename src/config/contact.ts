/**
 * Formulario de contacto (C17, fase 5): campos, límites y textos.
 *
 * Los textos marcados con §8 son los del prompt maestro. El resto son
 * propuestas de la fase 5 (D47): cámbialos aquí si Pau o Luna prefieren otros.
 * No pongas aquí el email ni el teléfono de Pau: la dirección de destino es el
 * secret CONTACT_TO_EMAIL y nunca llega al HTML.
 */

/** Nombres de los campos en el formulario (atributo `name`). */
export const CONTACT_FIELDS = {
  name: 'nombre',
  email: 'email',
  reason: 'motivo',
  date: 'fecha',
  place: 'lugar',
  message: 'mensaje',
  privacy: 'privacidad',
  /** Honeypot: oculto; si llega relleno, el mensaje se descarta sin avisar. */
  honeypot: 'website',
  /** Lo añade el widget de Turnstile (nombre por defecto de Cloudflare). */
  turnstile: 'cf-turnstile-response',
} as const;

export type ContactFieldName = (typeof CONTACT_FIELDS)[keyof typeof CONTACT_FIELDS];

/**
 * Motivos del desplegable (C17). `value` va en el formulario; `label`, en el
 * desplegable; `subject`, en el asunto del email: «[web] {motivo} — {nombre}».
 */
export const CONTACT_REASONS = [
  { value: 'booking', label: 'Booking', subject: 'booking' },
  { value: 'prensa', label: 'Prensa', subject: 'prensa' },
  { value: 'colaboracion', label: 'Colaboración', subject: 'colaboración' },
  { value: 'otro', label: 'Otro', subject: 'otro' },
] as const;

export type ContactReason = (typeof CONTACT_REASONS)[number]['value'];

export const CONTACT_REASON_VALUES = CONTACT_REASONS.map((reason) => reason.value) as [ContactReason, ...ContactReason[]];

/** Motivo por defecto. La fecha del evento solo se pide con este motivo. */
export const DEFAULT_REASON: ContactReason = 'booking';
export const DATE_REASON: ContactReason = 'booking';

/** Límites de C17. */
export const CONTACT_LIMITS = {
  nameMax: 100,
  /** Longitud máxima de una dirección de email (RFC 5321). */
  emailMax: 254,
  placeMax: 120,
  messageMin: 10,
  messageMax: 3000,
  /** Longitud máxima de un token de Turnstile (documentación de Cloudflare). */
  turnstileTokenMax: 2048,
} as const;

/** 5 envíos por hora por IP (C17), con ventana deslizante. */
export const CONTACT_RATE_LIMIT = {
  max: 5,
  windowSeconds: 60 * 60,
} as const;

/** Acción del widget de Turnstile; el servidor comprueba que coincide. */
export const TURNSTILE_ACTION = 'contact';

/**
 * Tras un envío correcto sin JavaScript, el servidor redirige a
 * `/contact?enviado=1` (POST → redirección → GET): recargar no reenvía.
 */
export const CONTACT_SENT_PARAM = 'enviado';

/** Códigos de error que devuelve la Action (en `error.message`). */
export const CONTACT_ERROR_CODES = {
  rateLimited: 'rate-limited',
  turnstileMissing: 'turnstile-missing',
  turnstileFailed: 'turnstile-failed',
  notConfigured: 'not-configured',
  sendFailed: 'send-failed',
} as const;

export type ContactErrorCode = (typeof CONTACT_ERROR_CODES)[keyof typeof CONTACT_ERROR_CODES];

/** Textos del formulario y de la página. */
export const CONTACT_TEXT = {
  /** §8 */
  intro: 'Booking, prensa y colaboraciones.',
  /** §8 */
  success: 'Mensaje enviado. Te respondo pronto.',
  /** §8 */
  error: 'No se ha podido enviar. Inténtalo de nuevo en unos minutos.',
  /** §8 */
  rateLimited: 'Has enviado demasiados mensajes. Prueba más tarde.',
  turnstileMissing: 'Falta la comprobación anti-spam. Espera a que termine y vuelve a enviar.',
  turnstileFailed: 'No se ha podido completar la comprobación anti-spam. Vuelve a intentarlo.',
  /** Sin servidor (GitHub Pages) o sin Turnstile configurado. Como «reproductor — próximamente». */
  unavailable: 'formulario — próximamente',
  noscript: 'Para enviar el formulario hace falta JavaScript: la comprobación anti-spam lo necesita.',
  submit: 'enviar',
  sending: 'enviando…',
  retry: 'reintentar',
  optional: '(opcional)',
  labels: {
    name: 'Nombre',
    email: 'Email',
    reason: 'Motivo',
    date: 'Fecha del evento',
    place: 'Sala / ciudad',
    message: 'Mensaje',
    /** Va seguido del enlace a /privacidad. */
    privacyBefore: 'He leído y acepto la',
    privacyLink: 'política de privacidad',
    honeypot: 'No rellenes este campo',
    turnstile: 'Comprobación anti-spam',
  },
} as const;

/** Mensajes de validación de cada campo (esquema de src/lib/contact/schema.ts). */
export const CONTACT_FIELD_ERRORS = {
  nameRequired: 'Escribe tu nombre.',
  nameTooLong: `Máximo ${CONTACT_LIMITS.nameMax} caracteres.`,
  emailRequired: 'Escribe tu email.',
  emailInvalid: 'Escribe un email válido.',
  reasonInvalid: 'Elige un motivo.',
  dateInvalid: 'Escribe una fecha válida.',
  placeTooLong: `Máximo ${CONTACT_LIMITS.placeMax} caracteres.`,
  messageRequired: 'Escribe tu mensaje.',
  messageTooShort: `Escribe al menos ${CONTACT_LIMITS.messageMin} caracteres.`,
  messageTooLong: `Máximo ${CONTACT_LIMITS.messageMax} caracteres.`,
  privacyRequired: 'Acepta la política de privacidad para enviar el mensaje.',
} as const;

/** Texto para cada código de error de la Action. */
export function contactErrorText(code: string | undefined): string {
  switch (code) {
    case CONTACT_ERROR_CODES.rateLimited:
      return CONTACT_TEXT.rateLimited;
    case CONTACT_ERROR_CODES.turnstileMissing:
      return CONTACT_TEXT.turnstileMissing;
    case CONTACT_ERROR_CODES.turnstileFailed:
      return CONTACT_TEXT.turnstileFailed;
    default:
      return CONTACT_TEXT.error;
  }
}

export function reasonSubject(reason: ContactReason): string {
  return CONTACT_REASONS.find((item) => item.value === reason)?.subject ?? reason;
}

let warnedNoSiteKey = false;

/** Aviso (una vez) de que falta la clave pública de Turnstile. */
export function warnMissingTurnstileSiteKey(): void {
  if (warnedNoSiteKey) return;
  warnedNoSiteKey = true;
  console.warn(`[contact] Falta PUBLIC_TURNSTILE_SITE_KEY: /contact muestra «${CONTACT_TEXT.unavailable}».`);
}
