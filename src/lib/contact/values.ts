/**
 * Lo que había escrito en el formulario, para volver a pintarlo cuando el
 * envío falla sin JavaScript (C17). Astro lee el cuerpo de la petición con una
 * copia, así que la página todavía puede leerlo después de la Action.
 */
import { CONTACT_FIELDS, CONTACT_LIMITS } from '../../config/contact';

export interface ContactValues {
  email?: string;
  telefono?: string;
  mensaje?: string;
}

/** Recorta y limita: lo que se devuelve al HTML nunca es más largo que el límite del campo. */
function text(data: FormData, field: string, max: number): string | undefined {
  const value = data.get(field);
  if (typeof value !== 'string') return undefined;
  const clean = value.replace(/\r\n?/g, '\n').trim().slice(0, max);
  return clean || undefined;
}

export async function readContactValues(request: Request): Promise<ContactValues> {
  let data: FormData;
  try {
    data = await request.clone().formData();
  } catch {
    return {};
  }
  return {
    email: text(data, CONTACT_FIELDS.email, CONTACT_LIMITS.emailMax),
    telefono: text(data, CONTACT_FIELDS.phone, CONTACT_LIMITS.phoneMax),
    mensaje: text(data, CONTACT_FIELDS.message, CONTACT_LIMITS.messageMax),
  };
}
