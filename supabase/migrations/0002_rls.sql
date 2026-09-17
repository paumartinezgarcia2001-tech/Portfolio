-- 0002 · Seguridad a nivel de fila (prompt maestro §7.2)
-- Solo lectura pública de lo publicado; escritura solo para usuarios de `admins`.

-- Ojo: los advisors avisaron de que esta función queda expuesta en la API
-- (lints 0028 y 0029). La migración 0003 la mueve al esquema `private`.
create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.admins a where a.user_id = (select auth.uid()));
$$;
revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to anon, authenticated;

alter table public.admins        enable row level security;
alter table public.site_settings enable row level security;
alter table public.gigs          enable row level security;
alter table public.mixes         enable row level security;

-- Permisos mínimos sobre la Data API (RLS filtra siempre por encima).
revoke all on table public.admins, public.site_settings, public.gigs, public.mixes from anon, authenticated;
grant select on table public.admins to authenticated;
grant select on table public.site_settings to anon, authenticated;
grant update on table public.site_settings to authenticated;
grant select on table public.gigs, public.mixes to anon;
grant select, insert, update, delete on table public.gigs, public.mixes to authenticated;

create policy admins_self_read on public.admins
  for select to authenticated using (user_id = (select auth.uid()));

create policy settings_public_read on public.site_settings
  for select to anon, authenticated using (true);
create policy settings_admin_update on public.site_settings
  for update to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

create policy gigs_public_read on public.gigs
  for select to anon, authenticated using (published or (select public.is_admin()));
create policy gigs_admin_insert on public.gigs
  for insert to authenticated with check ((select public.is_admin()));
create policy gigs_admin_update on public.gigs
  for update to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
create policy gigs_admin_delete on public.gigs
  for delete to authenticated using ((select public.is_admin()));

-- mixes: mismas cuatro políticas que gigs
create policy mixes_public_read on public.mixes
  for select to anon, authenticated using (published or (select public.is_admin()));
create policy mixes_admin_insert on public.mixes
  for insert to authenticated with check ((select public.is_admin()));
create policy mixes_admin_update on public.mixes
  for update to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
create policy mixes_admin_delete on public.mixes
  for delete to authenticated using ((select public.is_admin()));
