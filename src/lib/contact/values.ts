/**
 * Lo que había escrito en el formulario, para volver a pintarlo cuando el
 * envío falla sin JavaScript (C17). Astro lee el cuerpo de la petición con una
 * copia, así que la página todavía puede leerlo después de la Action.
 */
import { CONTACT_FIELDS, CONTACT_LIMITS } from '../../config/contact';

export interface ContactValues {
  nombre?: string;
  email?: string;
  motivo?: string;
  fecha?: string;
  lugar?: string;
  mensaje?: string;
  privacidad?: boolean;
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
    nombre: text(data, CONTACT_FIELDS.name, CONTACT_LIMITS.nameMax),
    email: text(data, CONTACT_FIELDS.email, CONTACT_LIMITS.emailMax),
    motivo: text(data, CONTACT_FIELDS.reason, 40),
    fecha: text(data, CONTACT_FIELDS.date, 10),
    lugar: text(data, CONTACT_FIELDS.place, CONTACT_LIMITS.placeMax),
    mensaje: text(data, CONTACT_FIELDS.message, CONTACT_LIMITS.messageMax),
    privacidad: data.has(CONTACT_FIELDS.privacy),
  };
}
