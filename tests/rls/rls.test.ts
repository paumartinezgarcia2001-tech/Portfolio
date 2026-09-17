/**
 * RLS desde fuera, con la clave publicable (la misma que usa la web).
 * Se ejecuta con `npm run test:rls` y solo si hay .env con
 * PUBLIC_SUPABASE_URL y PUBLIC_SUPABASE_PUBLISHABLE_KEY. Necesita salida a
 * internet hacia supabase.co.
 *
 * La comprobación equivalente dentro de la base de datos (incluidos los
 * bolos sin publicar y el rol `authenticated`) está en supabase/tests/rls.sql.
 */
import { createClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';

const url = process.env.PUBLIC_SUPABASE_URL;
const key = process.env.PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const configured = Boolean(url && key);

describe.runIf(configured)('RLS con la clave publicable', () => {
  const supabase = createClient(url!, key!, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

  it('puede leer los bolos publicados', async () => {
    const { data, error } = await supabase.from('gigs').select('id, published').limit(200);
    expect(error).toBeNull();
    expect(data?.length).toBeGreaterThan(0);
    expect(data?.every((row) => row.published)).toBe(true);
  });

  it('puede leer los ajustes', async () => {
    const { data, error } = await supabase.from('site_settings').select('ticker_text').eq('id', 1).single();
    expect(error).toBeNull();
    expect(typeof data?.ticker_text).toBe('string');
  });

  it('no puede insertar bolos', async () => {
    const { error } = await supabase
      .from('gigs')
      .insert({ event_date: '2099-01-01', venue: 'PRUEBA', city: 'PRUEBA' });
    expect(error).not.toBeNull();
  });

  it('no puede modificar ni borrar bolos', async () => {
    const { error: updateError } = await supabase.from('gigs').update({ city: 'HACK' }).neq('id', '');
    expect(updateError).not.toBeNull();
    const { error: deleteError } = await supabase.from('gigs').delete().neq('id', '');
    expect(deleteError).not.toBeNull();
  });

  it('no puede cambiar los ajustes', async () => {
    const { error } = await supabase.from('site_settings').update({ ticker_text: 'HACK' }).eq('id', 1);
    expect(error).not.toBeNull();
  });

  it('no puede leer la tabla de administradoras', async () => {
    const { error } = await supabase.from('admins').select('user_id');
    expect(error).not.toBeNull();
  });

  it('no puede llamar a is_admin() por RPC (está fuera de la API)', async () => {
    // La función vive en el esquema `private` desde la migración 0003.
    const { error } = await supabase.rpc('is_admin' as never);
    expect(error).not.toBeNull();
  });
});
