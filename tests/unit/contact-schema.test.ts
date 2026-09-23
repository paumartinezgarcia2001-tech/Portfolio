import { describe, expect, it } from 'vitest';
import { CONTACT_FIELD_ERRORS as MSG, CONTACT_LIMITS as LIMITS } from '../../src/config/contact';
import { contactSchema, isEventDate, isHoneypotFilled, toContactMessage } from '../../src/lib/contact/schema';

/**
 * C17 · esquema del formulario. Astro convierte el FormData en objeto antes de
 * validar: un campo obligatorio vacío llega como `null`, uno opcional vacío
 * como `undefined` y una casilla como `true`/`false`. Aquí se prueba con esa
 * forma; el camino completo (POST de verdad) lo cubren los e2e.
 */

const valid = {
  nombre: ' Ana Prueba ',
  email: ' ana@example.com ',
  motivo: 'booking',
  fecha: '2026-10-15',
  lugar: ' LA MARIQUEEN, Madrid ',
  mensaje: ' Hola, quiero proponerte una fecha. ',
  privacidad: true,
};

/** Primer mensaje de error de cada campo. */
function errors(input: Record<string, unknown>): Record<string, string> {
  const result = contactSchema.safeParse(input);
  if (result.success) return {};
  const fields: Record<string, string> = {};
  for (const issue of result.error.issues) {
    const key = issue.path.join('.');
    fields[key] ??= issue.message;
  }
  return fields;
}

describe('contactSchema', () => {
  it('acepta un envío válido, recorta los espacios y deja los opcionales', () => {
    const parsed = contactSchema.parse(valid);
    expect(parsed).toMatchObject({
      nombre: 'Ana Prueba',
      email: 'ana@example.com',
      motivo: 'booking',
      fecha: '2026-10-15',
      lugar: 'LA MARIQUEEN, Madrid',
      mensaje: 'Hola, quiero proponerte una fecha.',
      privacidad: true,
    });
  });

  it('pide nombre, email, mensaje y privacidad cuando vienen vacíos', () => {
    expect(errors({ nombre: null, email: null, motivo: 'booking', mensaje: null, privacidad: false })).toEqual({
      nombre: MSG.nameRequired,
      email: MSG.emailRequired,
      mensaje: MSG.messageRequired,
      privacidad: MSG.privacyRequired,
    });
  });

  it('trata «solo espacios» como vacío', () => {
    expect(errors({ ...valid, nombre: '   ', mensaje: '  \n ' })).toEqual({
      nombre: MSG.nameRequired,
      mensaje: MSG.messageRequired,
    });
  });

  it('comprueba el email', () => {
    expect(errors({ ...valid, email: 'ana@' }).email).toBe(MSG.emailInvalid);
    expect(errors({ ...valid, email: 'ana example.com' }).email).toBe(MSG.emailInvalid);
    expect(errors({ ...valid, email: `${'a'.repeat(LIMITS.emailMax)}@example.com` }).email).toBe(MSG.emailInvalid);
    expect(contactSchema.safeParse({ ...valid, email: 'ana+web@example.co.uk' }).success).toBe(true);
  });

  it('respeta los límites de longitud de C17', () => {
    expect(errors({ ...valid, nombre: 'a'.repeat(LIMITS.nameMax + 1) }).nombre).toBe(MSG.nameTooLong);
    expect(errors({ ...valid, lugar: 'a'.repeat(LIMITS.placeMax + 1) }).lugar).toBe(MSG.placeTooLong);
    expect(errors({ ...valid, mensaje: 'a'.repeat(LIMITS.messageMax + 1) }).mensaje).toBe(MSG.messageTooLong);
    expect(errors({ ...valid, mensaje: 'corto' }).mensaje).toBe(MSG.messageTooShort);
    expect(contactSchema.safeParse({ ...valid, nombre: 'a'.repeat(LIMITS.nameMax) }).success).toBe(true);
    expect(contactSchema.safeParse({ ...valid, mensaje: 'a'.repeat(LIMITS.messageMin) }).success).toBe(true);
  });

  it('cuenta los saltos de línea de Windows como uno solo', () => {
    const lines = `${'a'.repeat(LIMITS.messageMax - 20)}${'\r\n'.repeat(10)}`;
    const parsed = contactSchema.parse({ ...valid, mensaje: lines });
    expect(parsed.mensaje).not.toContain('\r');
    expect(contactSchema.safeParse({ ...valid, mensaje: lines }).success).toBe(true);
  });

  it('solo acepta los cuatro motivos, y sin motivo usa booking', () => {
    expect(errors({ ...valid, motivo: 'spam' }).motivo).toBe(MSG.reasonInvalid);
    expect(errors({ ...valid, motivo: null }).motivo).toBe(MSG.reasonInvalid);
    expect(contactSchema.parse({ ...valid, motivo: undefined }).motivo).toBe('booking');
  });

  it('valida la fecha del evento cuando viene', () => {
    expect(errors({ ...valid, fecha: '15/10/2026' }).fecha).toBe(MSG.dateInvalid);
    expect(errors({ ...valid, fecha: '2026-02-30' }).fecha).toBe(MSG.dateInvalid);
    expect(errors({ ...valid, fecha: '1899-01-01' }).fecha).toBe(MSG.dateInvalid);
    expect(contactSchema.parse({ ...valid, fecha: undefined }).fecha).toBeUndefined();
  });

  it('el honeypot y el token no dan error de validación', () => {
    const parsed = contactSchema.parse({ ...valid, website: 'http://spam.example', 'cf-turnstile-response': 'x'.repeat(4000) });
    expect(parsed.website).toBe('http://spam.example');
    expect(parsed['cf-turnstile-response']).toHaveLength(4000);
  });
});

describe('isEventDate', () => {
  it('acepta AAAA-MM-DD del calendario entre 2000 y 2100', () => {
    expect(isEventDate('2026-09-25')).toBe(true);
    expect(isEventDate('2026-2-5')).toBe(false);
    expect(isEventDate('2026-13-01')).toBe(false);
    expect(isEventDate('2100-12-31')).toBe(true);
    expect(isEventDate('2101-01-01')).toBe(false);
  });
});

describe('toContactMessage', () => {
  it('la fecha solo cuenta con el motivo booking', () => {
    const parsed = contactSchema.parse(valid);
    expect(toContactMessage(parsed).date).toBe('2026-10-15');
    expect(toContactMessage({ ...parsed, motivo: 'prensa' }).date).toBeUndefined();
  });

  it('deja fuera los campos opcionales vacíos', () => {
    const parsed = contactSchema.parse({ ...valid, lugar: undefined, fecha: undefined });
    expect(toContactMessage(parsed)).toEqual({
      name: 'Ana Prueba',
      email: 'ana@example.com',
      reason: 'booking',
      date: undefined,
      place: undefined,
      message: 'Hola, quiero proponerte una fecha.',
    });
  });
});

describe('isHoneypotFilled', () => {
  it('solo con contenido de verdad', () => {
    expect(isHoneypotFilled({ website: undefined })).toBe(false);
    expect(isHoneypotFilled({ website: '   ' })).toBe(false);
    expect(isHoneypotFilled({ website: 'http://spam.example' })).toBe(true);
  });
});
