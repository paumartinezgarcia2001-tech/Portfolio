-- 0004 · Mixes con rutas relativas al bucket y un mix por archivo (D46, fase 4)
--
-- Como el vídeo de Media (src/config/media.ts), los mixes guardan la ruta del
-- archivo dentro del bucket de medios (`mixes/<slug>-<hash>.mp3`) y la web le
-- pone delante PUBLIC_MEDIA_BASE_URL. Así las filas no cambian cuando cambie el
-- dominio del bucket (URL r2.dev → media.<dominio>). Se siguen admitiendo URLs
-- https completas. Las rutas: minúsculas, números, «.», «_», «-» y «/», sin
-- segmentos que empiecen por punto (nada de «..»).
--
-- `audio_url` pasa a ser única: scripts/add-mix.mjs hace upsert por ella.

alter table public.mixes drop constraint mixes_audio_url_check;
alter table public.mixes add constraint mixes_audio_url_check check (
  audio_url ~* '^https://'
  or audio_url ~ '^[a-z0-9][a-z0-9._-]*(/[a-z0-9][a-z0-9._-]*)*$'
);

alter table public.mixes add constraint mixes_artwork_url_check check (
  artwork_url is null
  or artwork_url ~* '^https://'
  or artwork_url ~ '^[a-z0-9][a-z0-9._-]*(/[a-z0-9][a-z0-9._-]*)*$'
);

alter table public.mixes add constraint mixes_audio_url_key unique (audio_url);

comment on column public.mixes.audio_url is
  'Ruta dentro del bucket de medios (mixes/<slug>-<hash>.mp3), relativa a PUBLIC_MEDIA_BASE_URL, o URL https completa.';
comment on column public.mixes.artwork_url is
  'Carátula cuadrada (1000 × 1000): ruta dentro del bucket o URL https completa.';
