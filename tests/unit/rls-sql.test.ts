/**
 * Migraciones y RLS (§7.2, fase 6) en un Postgres de verdad, sin red: PGlite
 * (Postgres compilado a WebAssembly) con lo mínimo de Supabase simulado
 * (roles `anon`/`authenticated`, `auth.users`, `auth.uid()`, `auth.jwt()` y
 * `auth.mfa_factors`).
 *
 * - Aplica supabase/migrations/0001…0005 en orden (si alguna no compila, falla).
 * - Ejecuta supabase/tests/rls.sql (la misma comprobación que se pega en el
 *   SQL Editor de Supabase) con y sin administradora.
 * - Comprueba el TOTP obligatorio para escribir (0005) y `updated_by`.
 *
 * No sustituye a probar en Supabase (npm run test:rls y rls.sql en el SQL
 * Editor), pero pilla errores de SQL y de políticas antes de aplicarlas.
 */
import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(import.meta.dirname, '../..');
const MIGRATIONS = path.join(ROOT, 'supabase', 'migrations');
const RLS_SQL = readFileSync(path.join(ROOT, 'supabase', 'tests', 'rls.sql'), 'utf8');

const ADMIN = '11111111-1111-4111-8111-111111111111';
const MFA_ADMIN = '33333333-3333-4333-8333-333333333333';

const SUPABASE_STUB = `
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create schema auth;
create table auth.users (id uuid primary key, email text);
create table auth.mfa_factors (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  status text not null,
  factor_type text not null default 'totp'
);
create function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
create function auth.uid() returns uuid language sql stable as $$
  select nullif(auth.jwt() ->> 'sub', '')::uuid $$;
grant usage on schema auth to anon, authenticated;
grant execute on function auth.jwt(), auth.uid() to anon, authenticated;
grant usage on schema public to anon, authenticated;
alter default privileges in schema public grant select on tables to anon;
alter default privileges in schema public grant select, insert, update, delete on tables to authenticated;
`;

async function database(): Promise<PGlite> {
  const db = new PGlite();
  await db.exec(SUPABASE_STUB);
  const files = readdirSync(MIGRATIONS)
    .filter((name) => name.endsWith('.sql'))
    .sort();
  for (const file of files) {
    await db.exec(readFileSync(path.join(MIGRATIONS, file), 'utf8'));
  }
  return db;
}

async function runRlsCheck(db: PGlite): Promise<Array<{ prueba: string; resultado: string }>> {
  await db.exec(RLS_SQL.replace(/^select \* from pg_temp\.rls_check\(\);\s*$/m, ''));
  const { rows } = await db.query<{ prueba: string; resultado: string }>('select * from pg_temp.rls_check()');
  return rows;
}

/** Ejecuta `sql` como `authenticated` con esos claims y devuelve cuántas filas tocó (o el código de error). */
async function asUser(db: PGlite, claims: Record<string, unknown>, sql: string): Promise<string> {
  const escaped = JSON.stringify(claims).replace(/'/g, "''");
  await db.exec(`
    create or replace function pg_temp.try_as() returns text language plpgsql as $f$
    declare n int;
    begin
      set local role authenticated;
      perform set_config('request.jwt.claims', '${escaped}', true);
      begin
        ${sql};
        get diagnostics n = row_count;
      exception when others then
        reset role;
        return 'error ' || sqlstate;
      end;
      reset role;
      return n::text;
    end $f$;`);
  const { rows } = await db.query<{ r: string }>('select pg_temp.try_as() as r');
  return rows[0]!.r;
}

// Cada test arranca su propio Postgres (PGlite es Postgres compilado a
// WebAssembly) y aplica las migraciones: unos segundos por test, más en las
// máquinas de GitHub Actions. Sin este margen, el límite de 5 s de vitest corta
// los tests y con ellos el despliegue.
describe('migraciones y RLS (PGlite)', { timeout: 60_000 }, () => {
  it('rls.sql sin administradoras: todo bloqueado o sin efecto', async () => {
    const db = await database();
    const rows = await runRlsCheck(db);
    expect(rows.length).toBeGreaterThan(10);
    for (const { prueba, resultado } of rows) {
      expect(resultado, prueba).not.toMatch(/mal|PERMITIDO|SÍ \(mal\)|VE FILAS/);
    }
    expect(rows.find((row) => row.prueba === 'auth no admin: insert gigs')?.resultado).toBe('bloqueado (42501)');
    expect(rows.find((row) => row.prueba === 'auth no admin: update site_settings')?.resultado).toBe('sin efecto (correcto)');
    expect(rows.find((row) => row.prueba === 'auth no admin: delete gigs')?.resultado).toBe('sin efecto (correcto)');
    expect(rows.find((row) => row.prueba === 'admin')?.resultado).toContain('sin comprobar');
    await db.close();
  });

  it('rls.sql con una administradora: puede escribir y no deja rastro', async () => {
    const db = await database();
    await db.exec(`insert into auth.users values ('${ADMIN}', 'pau@e2e.test');
      insert into public.admins (user_id) values ('${ADMIN}');`);
    const rows = await runRlsCheck(db);
    for (const { prueba, resultado } of rows) {
      expect(resultado, prueba).not.toMatch(/mal|PERMITIDO|VE FILAS/);
    }
    expect(rows.find((row) => row.prueba === 'admin: update gigs')?.resultado).toBe('permitido (correcto)');
    expect(rows.find((row) => row.prueba === 'admin: updated_by automático (0005)')?.resultado).toBe('correcto');
    // Lo que hace como administradora se deshace.
    const settings = await db.query<{ updated_by: string | null }>('select updated_by from public.site_settings');
    expect(settings.rows[0]!.updated_by).toBeNull();
    const gigs = await db.query<{ n: number }>('select count(*)::int as n from public.gigs');
    expect(gigs.rows[0]!.n).toBe(0);
    await db.close();
  });

  it('una cuenta con TOTP necesita una sesión aal2 para escribir (0005)', async () => {
    const db = await database();
    await db.exec(`insert into auth.users values ('${MFA_ADMIN}', 'mfa@e2e.test');
      insert into public.admins (user_id) values ('${MFA_ADMIN}');
      insert into auth.mfa_factors (user_id, status) values ('${MFA_ADMIN}', 'verified');
      insert into public.gigs (event_date, venue, city) values ('2099-01-01', 'SALA', 'Madrid');`);
    const aal1 = { sub: MFA_ADMIN, role: 'authenticated', aal: 'aal1' };
    const aal2 = { sub: MFA_ADMIN, role: 'authenticated', aal: 'aal2' };

    expect(await asUser(db, aal1, "update public.gigs set city = 'X' where true")).toBe('0');
    expect(await asUser(db, aal1, "insert into public.gigs (event_date, venue, city) values ('2099-02-02', 'S', 'M')")).toBe(
      'error 42501',
    );
    expect(await asUser(db, aal1, "update public.site_settings set ticker_text = 'X' where id = 1")).toBe('0');
    expect(await asUser(db, aal1, "insert into public.mixes (title, audio_url) values ('M', 'mixes/m.mp3')")).toBe(
      'error 42501',
    );

    expect(await asUser(db, aal2, "update public.gigs set city = 'Sevilla' where true")).toBe('1');
    expect(await asUser(db, aal2, "insert into public.mixes (title, audio_url) values ('M', 'mixes/m.mp3')")).toBe('1');
    const stamped = await db.query<{ updated_by: string }>('select updated_by from public.gigs');
    expect(stamped.rows[0]!.updated_by).toBe(MFA_ADMIN);
    await db.close();
  });

  it('sin TOTP, una administradora escribe con aal1 (y una sin fila en admins, no)', async () => {
    const db = await database();
    await db.exec(`insert into auth.users values ('${ADMIN}', 'pau@e2e.test');
      insert into public.admins (user_id) values ('${ADMIN}');`);
    const admin = { sub: ADMIN, role: 'authenticated', aal: 'aal1' };
    const other = { sub: '44444444-4444-4444-8444-444444444444', role: 'authenticated', aal: 'aal2' };
    expect(await asUser(db, admin, "update public.site_settings set ticker_text = 'HOLA' where id = 1")).toBe('1');
    expect(await asUser(db, other, "update public.site_settings set ticker_text = 'HACK' where id = 1")).toBe('0');
    expect(await asUser(db, other, "insert into public.gigs (event_date, venue, city) values ('2099-02-02', 'S', 'M')")).toBe(
      'error 42501',
    );
    const text = await db.query<{ ticker_text: string }>('select ticker_text from public.site_settings');
    expect(text.rows[0]!.ticker_text).toBe('HOLA');
    await db.close();
  });

  it('límites nuevos de site_settings (0005)', async () => {
    const db = await database();
    await expect(db.exec(`update public.site_settings set video = '[1,2]'::jsonb`)).rejects.toThrow(/site_settings_video_check/);
    await expect(db.exec(`update public.site_settings set info_markdown = repeat('x', 20001)`)).rejects.toThrow(
      /site_settings_info_markdown_check/,
    );
    await db.close();
  });
});
