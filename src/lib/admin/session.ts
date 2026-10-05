/**
 * Sesión del panel (C19): quién ha entrado y si puede tocar algo.
 *
 * - El JWT se valida con `getClaims()` (firma asimétrica con las claves JWKS
 *   de Supabase o, con claves simétricas, preguntando a Supabase).
 * - La pertenencia a `admins` se comprueba leyendo la propia fila (política
 *   `admins_self_read`), no por RPC: `is_admin()` está fuera de la API (D34).
 * - Solo usuario (o alias) y contraseña: sin verificación en dos pasos ni
 *   CAPTCHA (D61, Luna, 05-10-2026).
 *
 * Las políticas RLS siguen siendo la última barrera: aunque esto fallara, la
 * base de datos no deja escribir a quien no está en `admins`.
 */
import type { TypedSupabaseClient } from '../supabase/server';

export interface AdminSession {
  userId: string;
  email: string | null;
}

export type SessionState =
  | { kind: 'anonymous' }
  /** Sesión válida, pero la cuenta no está en `admins`. */
  | { kind: 'forbidden'; userId: string }
  | { kind: 'admin'; session: AdminSession };

const TIMEOUT_MS = 4000;

function withTimeout<T>(promise: PromiseLike<T>, ms = TIMEOUT_MS): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    Promise.resolve(promise),
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`tiempo agotado (${ms} ms)`)), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

/** Lee la sesión de las cookies y comprueba que es de una administradora. */
export async function readSessionState(supabase: TypedSupabaseClient): Promise<SessionState> {
  try {
    const { data, error } = await withTimeout(supabase.auth.getClaims());
    const claims = data?.claims;
    if (error || !claims || typeof claims.sub !== 'string' || claims.role !== 'authenticated') {
      return { kind: 'anonymous' };
    }
    const userId = claims.sub;

    const { data: row, error: rowError } = await withTimeout(
      supabase.from('admins').select('user_id').eq('user_id', userId).maybeSingle(),
    );
    if (rowError || !row) return { kind: 'forbidden', userId };

    return {
      kind: 'admin',
      session: { userId, email: typeof claims.email === 'string' ? claims.email : null },
    };
  } catch (error) {
    console.warn(`[panel] No se ha podido leer la sesión: ${error instanceof Error ? error.message : String(error)}`);
    return { kind: 'anonymous' };
  }
}
