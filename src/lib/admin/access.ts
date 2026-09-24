/**
 * Acceso al panel (C19): funciones puras, sin módulos de Astro.
 */

/**
 * ¿El parámetro de la URL es el nombre secreto del panel (`ADMIN_PATH`)?
 * Compara en tiempo constante para no dar pistas por lo que tarda. Sin
 * secreto configurado, el panel no existe (siempre `false`).
 */
export function matchesAdminPath(param: string | undefined, secret: string | undefined): boolean {
  if (!secret || !param) return false;
  const a = new TextEncoder().encode(param);
  const b = new TextEncoder().encode(secret);
  let diff = a.length ^ b.length;
  const length = Math.max(a.length, b.length);
  for (let i = 0; i < length; i += 1) diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return diff === 0;
}

export interface LoginAlias {
  /** Alias corto (secreto `ADMIN_USERNAME`), sin distinguir mayúsculas. */
  username: string | undefined;
  /** Email de Supabase Auth al que apunta (secreto `ADMIN_EMAIL`). */
  email: string | undefined;
}

/**
 * Email con el que se entra: el que se escribe o, si se escribe el alias,
 * el suyo. `null` si no hay forma de saberlo (se responde con el error
 * genérico, sin decir qué ha fallado).
 */
export function resolveLoginEmail(identifier: string, alias: LoginAlias): string | null {
  const value = identifier.trim();
  if (!value) return null;
  if (value.includes('@')) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) ? value.toLowerCase() : null;
  }
  if (alias.username && alias.email && value.toLowerCase() === alias.username.trim().toLowerCase()) {
    return alias.email.trim().toLowerCase();
  }
  return null;
}

/** Códigos de error de Supabase Auth que no son «usuario o contraseña». */
export type LoginFailure = 'credentials' | 'captcha' | 'rate-limit' | 'unavailable';

export function classifyAuthError(error: { code?: string | undefined; status?: number | undefined; message?: string }): LoginFailure {
  const code = error.code ?? '';
  if (code === 'captcha_failed') return 'captcha';
  if (code === 'over_request_rate_limit' || code === 'over_email_send_rate_limit' || error.status === 429) {
    return 'rate-limit';
  }
  if (typeof error.status === 'number' && error.status >= 500) return 'unavailable';
  // Credenciales, email sin confirmar, usuario bloqueado…: todo es «incorrecto».
  return 'credentials';
}
