import { describe, expect, it } from 'vitest';
import { CONTACT_FIELD_ERRORS as MSG, CONTACT_LIMITS as LIMITS, PHONE_PATTERN } from '../../src/config/contact';
import { contactSchema, isHoneypotFilled, isPhone, toContactMessage } from '../../src/lib/contact/schema';

/**
 * C17 · esquema del formulario (tres campos desde D58). Astro convierte el
 * FormData en objeto antes de validar: un campo obligatorio vacío llega como
 * `null`, uno opcional vacío como `undefined` y una casilla como `true`/`false`.
 * Aquí se prueba con esa forma; el camino completo (POST de verdad) lo cubren
 * los e2e.
 */

const valid = {
  email: ' ana@example.com ',
  telefono: ' +34 600 11 22 33 ',
  mensaje: ' Hola, quiero proponerte una fecha. ',
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
    expect(contactSchema.parse(valid)).toMatchObject({
      email: 'ana@example.com',
      telefono: '+34 600 11 22 33',
      mensaje: 'Hola, quiero proponerte una fecha.',
    });
  });

  it('solo pide email y mensaje: el teléfono es opcional', () => {
    expect(errors({ email: null, mensaje: null })).toEqual({
      email: MSG.emailRequired,
      mensaje: MSG.messageRequired,
    });
    expect(contactSchema.safeParse({ email: 'ana@example.com', mensaje: valid.mensaje }).success).toBe(true);
    expect(contactSchema.parse({ ...valid, telefono: undefined }).telefono).toBeUndefined();
  });

  it('trata «solo espacios» como vacío', () => {
    expect(errors({ ...valid, email: '   ', mensaje: '  \n ' })).toEqual({
      email: MSG.emailRequired,
      mensaje: MSG.messageRequired,
    });
  });

  it('comprueba el email', () => {
    expect(errors({ ...valid, email: 'ana@' }).email).toBe(MSG.emailInvalid);
    expect(errors({ ...valid, email: 'ana example.com' }).email).toBe(MSG.emailInvalid);
    expect(errors({ ...valid, email: `${'a'.repeat(LIMITS.emailMax)}@example.com` }).email).toBe(MSG.emailInvalid);
    expect(contactSchema.safeParse({ ...valid, email: 'ana+web@example.co.uk' }).success).toBe(true);
  });

  it('comprueba el teléfono: números, espacios y + - ( ), y al menos 6 cifras', () => {
    for (const telefono of ['600112233', '+34 600 11 22 33', '(+34) 600-11-22-33', '91 123 45 67']) {
      expect(contactSchema.safeParse({ ...valid, telefono }).success).toBe(true);
    }
    for (const telefono of ['12345', 'llámame', '600 11 22 33 ext. 4', '+++++++']) {
      expect(errors({ ...valid, telefono }).telefono).toBe(MSG.phoneInvalid);
    }
    expect(errors({ ...valid, telefono: '6'.repeat(LIMITS.phoneMax + 1) }).telefono).toBe(MSG.phoneInvalid);
  });

  it('respeta los límites de longitud del mensaje', () => {
    expect(errors({ ...valid, mensaje: 'a'.repeat(LIMITS.messageMax + 1) }).mensaje).toBe(MSG.messageTooLong);
    expect(errors({ ...valid, mensaje: 'corto' }).mensaje).toBe(MSG.messageTooShort);
    expect(contactSchema.safeParse({ ...valid, mensaje: 'a'.repeat(LIMITS.messageMin) }).success).toBe(true);
  });

  it('cuenta los saltos de línea de Windows como uno solo', () => {
    const lines = `${'a'.repeat(LIMITS.messageMax - 20)}${'\r\n'.repeat(10)}`;
    const parsed = contactSchema.parse({ ...valid, mensaje: lines });
    expect(parsed.mensaje).not.toContain('\r');
    expect(contactSchema.safeParse({ ...valid, mensaje: lines }).success).toBe(true);
  });

  it('el honeypot y el token no dan error de validación', () => {
    const parsed = contactSchema.parse({ ...valid, botcheck: true, 'cf-turnstile-response': 'x'.repeat(4000) });
    expect(parsed.botcheck).toBe(true);
    expect(parsed['cf-turnstile-response']).toHaveLength(4000);
  });
});

describe('isPhone', () => {
  it('mismo criterio que el `pattern` del formulario', () => {
    expect(isPhone('600112233')).toBe(true);
    expect(isPhone('+34 600 11 22 33')).toBe(true);
    expect(isPhone('12345')).toBe(false);
    expect(isPhone('600 11 22 33; DROP')).toBe(false);
  });

  /**
   * El navegador compila el atributo `pattern` como
   * `new RegExp('^(?:' + pattern + ')$', 'v')` y, si no compila, **se lo salta
   * sin avisar**: el campo aceptaría cualquier cosa. Pasó de verdad con los
   * paréntesis sin escapar dentro de la clase.
   */
  it('el `pattern` compila con la marca `v`, que es la que usa el navegador', () => {
    expect(() => new RegExp(`^(?:${PHONE_PATTERN})$`, 'v')).not.toThrow();
    const browserRe = new RegExp(`^(?:${PHONE_PATTERN})$`, 'v');
    expect(browserRe.test('(+34) 600-11-22-33')).toBe(true);
    expect(browserRe.test('llámame')).toBe(false);
  });
});

describe('toContactMessage', () => {
  it('pasa los tres campos al email', () => {
    expect(toContactMessage(contactSchema.parse(valid))).toEqual({
      email: 'ana@example.com',
      phone: '+34 600 11 22 33',
      message: 'Hola, quiero proponerte una fecha.',
    });
  });

  it('sin teléfono, no va la fila del teléfono', () => {
    const parsed = contactSchema.parse({ ...valid, telefono: undefined });
    expect(toContactMessage(parsed).phone).toBeUndefined();
  });
});

describe('isHoneypotFilled', () => {
  it('solo si la casilla viene marcada', () => {
    expect(isHoneypotFilled({ botcheck: undefined })).toBe(false);
    expect(isHoneypotFilled({ botcheck: false })).toBe(false);
    expect(isHoneypotFilled({ botcheck: true })).toBe(true);
  });
});
