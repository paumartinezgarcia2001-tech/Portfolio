/**
 * Sesión del panel (C19): quién ha entrado y si puede tocar algo.
 *
 * - El JWT se valida con `getClaims()` (firma asimétrica con las claves JWKS
 *   de Supabase o, con claves simétricas, preguntando a Supabase).
 * - La pertenencia a `admins` se comprueba leyendo la propia fila (política
 *   `admins_self_read`), no por RPC: `is_admin()` está fuera de la API (D34).
 * - MFA (TOTP): si la cuenta tiene un factor verificado y la sesión todavía
 *   no lo ha usado (aal1), falta el segundo paso y no se deja hacer nada más.
 *   La base de datos también lo exige desde la migración 0005.
 *
 * Las políticas RLS siguen siendo la última barrera: aunque esto fallara, la
 * base de datos no deja escribir a quien no está en `admins`.
 */
import type { TypedSupabaseClient } from '../supabase/server';

export interface AdminSession {
  userId: string;
  email: string | null;
  /** La cuenta tiene TOTP y esta sesión aún no ha pasado el segundo paso. */
  needsMfa: boolean;
  /** Nivel de la sesión: `aal2` si ya ha usado el TOTP. */
  aal: 'aal1' | 'aal2';
  /** ¿Tiene algún factor TOTP verificado? */
  hasMfa: boolean;
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

    // Los factores se piden a Supabase (getUser), no se leen de la cookie: la
    // cookie la controla el navegador y quitarle los factores no puede
    // saltarse el segundo paso.
    const { data: factors, error: factorsError } = await withTimeout(supabase.auth.mfa.listFactors());
    if (factorsError) throw factorsError;
    const aal = claims.aal === 'aal2' ? 'aal2' : 'aal1';
    const hasMfa = (factors?.totp.length ?? 0) > 0;
    return {
      kind: 'admin',
      session: {
        userId,
        email: typeof claims.email === 'string' ? claims.email : null,
        aal,
        hasMfa,
        needsMfa: hasMfa && aal !== 'aal2',
      },
    };
  } catch (error) {
    console.warn(`[panel] No se ha podido leer la sesión: ${error instanceof Error ? error.message : String(error)}`);
    return { kind: 'anonymous' };
  }
}
