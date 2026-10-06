-- 0007 · Colores de la web desde el panel (Luna, 06-10-2026)
--
-- `site_settings.theme` guarda los colores que se eligen en el panel oculto
-- (página «colores»): los cinco de las secciones, los dos fondos y el del
-- reproductor, que puede ir aparte o seguir el color de cada sección.
-- NULL = los colores del código (src/config/theme.ts y src/styles/tokens.css).
--
-- Forma (src/lib/theme.ts):
--   {"info":"#ff00ff","next":"#00ffff","media":"#ffff00","archive":"#00ff00",
--    "contact":"#ff5f1f","menuBg":"#27272b","panelBg":"#c5c7d6",
--    "player":"#bf00ff","playerFollowsSection":false}
--
-- Las políticas de site_settings (0002/0003) ya cubren la columna: la lee
-- cualquiera y solo la escribe una administradora. El trigger de updated_by
-- (0005) también.

alter table public.site_settings
  add column if not exists theme jsonb;

alter table public.site_settings
  drop constraint if exists site_settings_theme_check;
alter table public.site_settings
  add constraint site_settings_theme_check
  check (theme is null or (jsonb_typeof(theme) = 'object' and pg_column_size(theme) <= 2048));

comment on column public.site_settings.theme is
  'Colores de la web guardados desde el panel (src/lib/theme.ts). NULL = los del código.';
