/**
 * Formulario de contacto (C17, fase 5): campos, límites y textos.
 *
 * Tres campos y nada más (D58): email de contacto, teléfono (opcional) y
 * mensaje. Ni nombre, ni motivo, ni fecha: quien escribe lo cuenta en el
 * mensaje.
 *
 * Los textos marcados con §8 son los del prompt maestro. El resto son
 * propuestas de la fase 5 (D47): cámbialos aquí si Pau o Luna prefieren otros.
 *
 * El email de destino nunca se escribe aquí: en Cloudflare es el secret
 * CONTACT_TO_EMAIL y en el build estático lo guarda la cuenta de Web3Forms
 * (D58). El que sí aparece a la vista es SITE.contactEmail, el enlace `mailto:`
 * que Luna pidió publicar.
 */

/** Nombres de los campos en el formulario (atributo `name`). */
export const CONTACT_FIELDS = {
  email: 'email',
  phone: 'telefono',
  message: 'mensaje',
  /**
   * Honeypot: casilla oculta. Si llega marcada, el mensaje se descarta sin
   * avisar. Se llama `botcheck` porque es el nombre que también comprueba
   * Web3Forms en el build estático (D58): un solo campo sirve para los dos
   * caminos.
   */
  honeypot: 'botcheck',
  /** Lo añade el widget de Turnstile (nombre por defecto de Cloudflare). */
  turnstile: 'cf-turnstile-response',
} as const;

export type ContactFieldName = (typeof CONTACT_FIELDS)[keyof typeof CONTACT_FIELDS];

/** Límites de C17. */
export const CONTACT_LIMITS = {
  /** Longitud máxima de una dirección de email (RFC 5321). */
  emailMax: 254,
  phoneMax: 25,
  /** Un teléfono tiene al menos 6 cifras (los cortos de España). */
  phoneDigitsMin: 6,
  messageMin: 10,
  messageMax: 3000,
  /** Longitud máxima de un token de Turnstile (documentación de Cloudflare). */
  turnstileTokenMax: 2048,
} as const;

/**
 * Teléfono válido: solo números, espacios y `+ - ( ) .`, entre 6 y 25
 * caracteres, y con al menos 6 cifras. Se usa en dos sitios a la vez, así que
 * está escrito una sola vez: como `pattern` del `<input type="tel">` (lo
 * comprueba el navegador) y dentro de `isPhone()` (lo comprueba el servidor).
 * Sin anclas: `pattern` las pone el navegador e `isPhone` las añade.
 *
 * Los paréntesis van escapados aunque estén dentro de una clase: el navegador
 * compila `pattern` con la marca `v`, y ahí `( ) [ ] { } / - \ |` son
 * caracteres reservados dentro de las clases. Si no compila, el navegador se
 * salta el `pattern` **sin avisar** y cualquier texto pasaría por teléfono
 * (probado: pasaba «llámame»). Lo vigila un test de contact-schema.
 */
export const PHONE_PATTERN =
  `(?=(?:\\D*\\d){${CONTACT_LIMITS.phoneDigitsMin},})` +
  `[+\\(\\)\\d\\s.\\-]{${CONTACT_LIMITS.phoneDigitsMin},${CONTACT_LIMITS.phoneMax}}`;

/** 5 envíos por hora por IP (C17), con ventana deslizante. Solo en Cloudflare. */
export const CONTACT_RATE_LIMIT = {
  max: 5,
  windowSeconds: 60 * 60,
} as const;

/** Acción del widget de Turnstile; el servidor comprueba que coincide. */
export const TURNSTILE_ACTION = 'contact';

/**
 * Página de «mensaje enviado». Sin JavaScript, el envío acaba ahí
 * (POST → redirección → GET, así recargar no reenvía): en Cloudflare redirige
 * la propia página y en el build estático lo hace Web3Forms con su campo
 * `redirect`. Con JavaScript no se navega: el aviso sale en el sitio.
 */
export const CONTACT_SENT_PATH = '/mensaje-enviado';

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
  /** Sin formulario posible: sin Turnstile (Cloudflare) o sin clave de Web3Forms (estático). */
  unavailable: 'formulario — próximamente',
  /** Solo en Cloudflare: allí Turnstile necesita JavaScript. */
  noscript: 'Para enviar el formulario hace falta JavaScript: la comprobación anti-spam lo necesita.',
  submit: 'enviar',
  sending: 'enviando…',
  retry: 'reintentar',
  optional: '(opcional)',
  /** Antes del enlace `mailto:` (D58). */
  mailIntro: 'O escribe directamente a',
  labels: {
    email: 'Email',
    phone: 'Teléfono',
    message: 'Mensaje',
    /** Va seguido del enlace a /privacidad. */
    privacyBefore: 'Al enviar aceptas la',
    privacyLink: 'política de privacidad',
    turnstile: 'Comprobación anti-spam',
  },
} as const;

/** Mensajes de validación de cada campo (esquema de src/lib/contact/schema.ts). */
export const CONTACT_FIELD_ERRORS = {
  emailRequired: 'Escribe tu email.',
  emailInvalid: 'Escribe un email válido.',
  phoneInvalid: 'Escribe un teléfono válido, solo con números, espacios y + - ( ).',
  messageRequired: 'Escribe tu mensaje.',
  messageTooShort: `Escribe al menos ${CONTACT_LIMITS.messageMin} caracteres.`,
  messageTooLong: `Máximo ${CONTACT_LIMITS.messageMax} caracteres.`,
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

let warnedNoSiteKey = false;

/** Aviso (una vez) de que falta la clave pública de Turnstile. */
export function warnMissingTurnstileSiteKey(): void {
  if (warnedNoSiteKey) return;
  warnedNoSiteKey = true;
  console.warn(`[contact] Falta PUBLIC_TURNSTILE_SITE_KEY: /contact muestra «${CONTACT_TEXT.unavailable}».`);
}

let warnedNoAccessKey = false;

/** Aviso (una vez) de que falta la clave de Web3Forms en el build estático. */
export function warnMissingWeb3FormsKey(): void {
  if (warnedNoAccessKey) return;
  warnedNoAccessKey = true;
  console.warn(`[contact] Falta PUBLIC_WEB3FORMS_KEY: /contact muestra «${CONTACT_TEXT.unavailable}».`);
}
