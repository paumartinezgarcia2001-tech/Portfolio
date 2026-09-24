-- 0005 · Panel oculto (fase 6)
--
-- 1. Quién guarda cada cambio (C19: «registro de updated_by y updated_at»).
--    Un trigger rellena `updated_by` con el usuario de la sesión (auth.uid())
--    en cada alta y cada edición de bolos, mixes y ajustes. Si no hay sesión
--    (scripts locales con la clave secreta), se respeta lo que venga.
--    `mixes` no tenía la columna: se añade, con su índice (lint 0001).
-- 2. Límites de los campos que ahora se editan desde el panel (P2):
--    `info_markdown` (texto de Info) y `video` (ajustes del vídeo de Media).
-- 3. Verificación en dos pasos (TOTP): si la cuenta tiene un factor
--    verificado, escribir exige una sesión que lo haya usado (aal2). El panel
--    ya lo pide; estas políticas RESTRICTIVE hacen que la base de datos
--    también lo exija (se suman a las de 0002/0003, no las sustituyen).
--
-- La función del trigger vive en el esquema `private` (fuera de la Data API),
-- como `private.is_admin()` desde la migración 0003.

alter table public.mixes
  add column if not exists updated_by uuid references auth.users (id) on delete set null;
create index if not exists mixes_updated_by_idx on public.mixes (updated_by);

create or replace function private.stamp_updated_by() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_by := coalesce((select auth.uid()), new.updated_by);
  return new;
end $$;
revoke all on function private.stamp_updated_by() from public;

create trigger gigs_stamp_updated_by before insert or update on public.gigs
  for each row execute function private.stamp_updated_by();
create trigger mixes_stamp_updated_by before insert or update on public.mixes
  for each row execute function private.stamp_updated_by();
create trigger settings_stamp_updated_by before insert or update on public.site_settings
  for each row execute function private.stamp_updated_by();

alter table public.site_settings
  add constraint site_settings_info_markdown_check
  check (info_markdown is null or char_length(info_markdown) <= 20000);
alter table public.site_settings
  add constraint site_settings_video_check
  check (video is null or jsonb_typeof(video) = 'object');

comment on column public.site_settings.info_markdown is
  'Texto de Info en Markdown sencillo (## titulillos, párrafos y [enlaces](url)). NULL = el de src/content/info.md.';
comment on column public.site_settings.video is
  'Vídeo de Media (MediaVideoConfig de src/config/media.ts) guardado desde el panel. NULL = el de src/config/media.ts.';

-- 3. TOTP obligatorio para escribir si la cuenta lo tiene activado.
create or replace function private.has_required_aal() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select auth.jwt() ->> 'aal'), 'aal1') = 'aal2'
    or not exists (
      select 1 from auth.mfa_factors f
      where f.user_id = (select auth.uid()) and f.status = 'verified'
    );
$$;
revoke all on function private.has_required_aal() from public;
grant execute on function private.has_required_aal() to authenticated;

create policy gigs_mfa_insert on public.gigs as restrictive
  for insert to authenticated with check ((select private.has_required_aal()));
create policy gigs_mfa_update on public.gigs as restrictive
  for update to authenticated
  using ((select private.has_required_aal())) with check ((select private.has_required_aal()));
create policy gigs_mfa_delete on public.gigs as restrictive
  for delete to authenticated using ((select private.has_required_aal()));

create policy mixes_mfa_insert on public.mixes as restrictive
  for insert to authenticated with check ((select private.has_required_aal()));
create policy mixes_mfa_update on public.mixes as restrictive
  for update to authenticated
  using ((select private.has_required_aal())) with check ((select private.has_required_aal()));
create policy mixes_mfa_delete on public.mixes as restrictive
  for delete to authenticated using ((select private.has_required_aal()));

create policy settings_mfa_update on public.site_settings as restrictive
  for update to authenticated
  using ((select private.has_required_aal())) with check ((select private.has_required_aal()));
