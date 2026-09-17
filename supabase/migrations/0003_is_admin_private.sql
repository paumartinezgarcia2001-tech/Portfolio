-- 0003 · `is_admin()` fuera de la API y índices de claves ajenas
--
-- Los advisors de Supabase avisaron (lints 0028 y 0029) de que
-- `public.is_admin()` era una función SECURITY DEFINER ejecutable por `anon`
-- y por `authenticated` a través de /rest/v1/rpc/is_admin. Como indica el
-- prompt maestro (§7.2), se mueve a un esquema que no está expuesto en la
-- Data API; las políticas la siguen usando igual.
-- También se indexan las claves ajenas `updated_by` (lint 0001).

create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to anon, authenticated;

create or replace function private.is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.admins a where a.user_id = (select auth.uid()));
$$;
revoke all on function private.is_admin() from public;
grant execute on function private.is_admin() to anon, authenticated;

drop policy settings_admin_update on public.site_settings;
create policy settings_admin_update on public.site_settings
  for update to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));

drop policy gigs_public_read on public.gigs;
create policy gigs_public_read on public.gigs
  for select to anon, authenticated using (published or (select private.is_admin()));
drop policy gigs_admin_insert on public.gigs;
create policy gigs_admin_insert on public.gigs
  for insert to authenticated with check ((select private.is_admin()));
drop policy gigs_admin_update on public.gigs;
create policy gigs_admin_update on public.gigs
  for update to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));
drop policy gigs_admin_delete on public.gigs;
create policy gigs_admin_delete on public.gigs
  for delete to authenticated using ((select private.is_admin()));

drop policy mixes_public_read on public.mixes;
create policy mixes_public_read on public.mixes
  for select to anon, authenticated using (published or (select private.is_admin()));
drop policy mixes_admin_insert on public.mixes;
create policy mixes_admin_insert on public.mixes
  for insert to authenticated with check ((select private.is_admin()));
drop policy mixes_admin_update on public.mixes;
create policy mixes_admin_update on public.mixes
  for update to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));
drop policy mixes_admin_delete on public.mixes;
create policy mixes_admin_delete on public.mixes
  for delete to authenticated using ((select private.is_admin()));

drop function public.is_admin();

create index gigs_updated_by_idx on public.gigs (updated_by);
create index site_settings_updated_by_idx on public.site_settings (updated_by);
