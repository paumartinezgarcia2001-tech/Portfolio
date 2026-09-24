/**
 * Utilidades de las páginas del panel (src/pages/[admin]/…).
 */
import type { AstroGlobal } from 'astro';
import { actions, isInputError } from 'astro:actions';
import { adminHref } from '../../config/admin';
import type { TypedSupabaseClient } from '../supabase/server';
import type { AdminSession } from './session';

export interface AdminPageState {
  slug: string;
  /** Sesión completa de una administradora (con TOTP si lo tiene). */
  signedIn: boolean;
  supabase: TypedSupabaseClient | null;
  session: AdminSession | null;
  /** Respuesta que hay que devolver ya (redirección tras un POST sin JavaScript). */
  redirect?: Response | undefined;
  /** Error de un POST sin JavaScript (login, código, salir). */
  error?: string | undefined;
}

/**
 * Estado de la página y, si llega un POST sin JavaScript (login, código TOTP
 * o cerrar sesión), redirección → GET para que recargar no reenvíe nada.
 */
export function adminPage(Astro: AstroGlobal): AdminPageState {
  const admin = Astro.locals.admin;
  if (!admin) throw new Error('Falta el contexto del panel (src/middleware.ts).');
  const session = admin.state.kind === 'admin' ? admin.state.session : null;
  const state: AdminPageState = {
    slug: admin.slug,
    signedIn: Boolean(session && !session.needsMfa && admin.supabase),
    supabase: admin.supabase,
    session,
  };

  const logout = Astro.getActionResult(actions.admin.logout);
  if (logout && !logout.error) return { ...state, redirect: Astro.redirect(adminHref(admin.slug), 303) };

  for (const action of [actions.admin.login, actions.admin.verifyMfa]) {
    const result = Astro.getActionResult(action);
    if (!result) continue;
    if (!result.error) return { ...state, redirect: Astro.redirect(Astro.url.pathname, 303) };
    Astro.response.status = result.error.status;
    const message = isInputError(result.error)
      ? Object.values(result.error.fields).flat().find(Boolean)
      : result.error.message;
    return { ...state, error: message ?? result.error.message };
  }
  return state;
}
