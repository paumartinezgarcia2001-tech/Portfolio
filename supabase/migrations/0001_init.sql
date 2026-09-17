-- 0001 · Esquema inicial (prompt maestro §7.1)
-- Tablas: admins, site_settings, gigs y mixes, más el trigger de updated_at.

create table public.admins (
  user_id uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

comment on table public.admins is 'Usuarios de Supabase Auth que pueden editar la web desde el panel oculto.';

-- Ajustes: una sola fila
create table public.site_settings (
  id smallint primary key default 1 check (id = 1),
  ticker_text text not null default '' check (char_length(ticker_text) <= 500),
  ticker_append_next_gig boolean not null default true,
  info_markdown text,          -- opcional (editor de Info, P2)
  video jsonb,                 -- opcional (P2): {hls, mp4, poster, focusX, focusY, pixelBlock}
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null
);

comment on table public.site_settings is 'Ajustes editables de la web (una sola fila): texto de la barra de noticias, etc.';

insert into public.site_settings (id, ticker_text)
values (1, 'travest15m0 · DJ · Madrid') on conflict do nothing;

create table public.gigs (
  id uuid primary key default gen_random_uuid(),
  event_date date not null,
  party_name text check (party_name is null or char_length(party_name) between 1 and 120),
  venue text not null check (char_length(venue) between 1 and 120),
  city text not null check (char_length(city) between 1 and 80),
  lineup text[] not null default '{}',
  ticket_url text check (ticket_url is null or ticket_url ~* '^https://'),
  published boolean not null default true,
  venue_key text generated always as (lower(btrim(venue))) stored,
  party_key text generated always as (lower(btrim(coalesce(party_name, '')))) stored,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null,
  constraint gigs_dedupe unique (event_date, venue_key, party_key)
);

comment on table public.gigs is 'Bolos de travest15m0. Próximos y archivo se separan por fecha (corte a las 08:00, hora de Madrid).';

create index gigs_event_date_idx on public.gigs (event_date);

create table public.mixes (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(title) between 1 and 140),
  subtitle text,
  audio_url text not null check (audio_url ~* '^https://'),
  duration_seconds integer check (duration_seconds > 0),
  artwork_url text,
  published boolean not null default false,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.mixes is 'Mixes propios servidos desde R2 para el reproductor.';

create or replace function public.touch_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin new.updated_at := now(); return new; end $$;

create trigger gigs_touch before update on public.gigs
  for each row execute function public.touch_updated_at();
create trigger mixes_touch before update on public.mixes
  for each row execute function public.touch_updated_at();
create trigger settings_touch before update on public.site_settings
  for each row execute function public.touch_updated_at();
