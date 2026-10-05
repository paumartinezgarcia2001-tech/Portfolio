-- 0006 · Fuera la verificación en dos pasos del panel (D61, Luna, 05-10-2026)
--
-- El panel ya solo pide usuario (alias o email) y contraseña: sin CAPTCHA ni
-- código TOTP. Esta migración deshace el punto 3 de 0005: quita las políticas
-- RESTRICTIVE que exigían una sesión aal2 a las cuentas con un factor TOTP
-- verificado, y la función que las calculaba.
--
-- Escribir sigue exigiendo estar en `admins` (políticas de 0002/0003, que no
-- se tocan), y el trigger de `updated_by` y los límites de 0005 se quedan.
--
-- Es idempotente (`if exists`): se puede aplicar aunque 0005 no se aplicara
-- entera. Si la cuenta de Pau tenía un factor TOTP, bórralo en el dashboard
-- (Authentication → Users → la cuenta → Multi-Factor) para que Supabase no
-- devuelva sesiones a medias.

drop policy if exists gigs_mfa_insert on public.gigs;
drop policy if exists gigs_mfa_update on public.gigs;
drop policy if exists gigs_mfa_delete on public.gigs;

drop policy if exists mixes_mfa_insert on public.mixes;
drop policy if exists mixes_mfa_update on public.mixes;
drop policy if exists mixes_mfa_delete on public.mixes;

drop policy if exists settings_mfa_update on public.site_settings;

drop function if exists private.has_required_aal();
