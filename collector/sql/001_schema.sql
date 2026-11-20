-- LEONIDA OS — schéma cible Supabase/Postgres (V1).
-- Même modèle que le stockage fichier de la V0.5 (branche `data`) : migration sans changer le pipeline.
-- Lecture publique bornée par RLS ; écriture réservée au rôle service (Edge Function / job planifié).

create table if not exists source_registry (
  id text primary key,
  name text not null,
  kind text not null check (kind in ('youtube-feed','youtube-api','rss','reddit','unsupported')),
  official boolean not null default false,
  enabled boolean not null default true,
  interval_minutes int not null default 60,
  config jsonb not null default '{}'::jsonb,      -- URL, channelId, requêtes… jamais de secret
  access_rules text not null,
  trust text not null check (trust in ('official','high','medium','low')),
  last_success_at timestamptz,
  last_attempt_at timestamptz,
  consecutive_failures int not null default 0,
  status text not null default 'never-run',
  status_detail text,
  etag text,
  quota_day date,
  quota_used int default 0
);

create table if not exists ingestion_runs (
  id bigint generated always as identity primary key,
  source_id text not null references source_registry(id),
  started_at timestamptz not null,
  finished_at timestamptz,
  ok boolean not null,
  skipped text,
  fetched int not null default 0,
  new_items int not null default 0,
  updated_items int not null default 0,
  errors text[] not null default '{}',
  attempts int not null default 0,
  quota_used int
);

create table if not exists raw_items (
  key text primary key,                         -- source_id:external_id
  source_id text not null references source_registry(id),
  external_id text not null,
  url text not null,                            -- canonique
  title text not null,
  excerpt text not null check (char_length(excerpt) <= 300),  -- extrait court, jamais l'article entier
  published_at timestamptz,
  fetched_at timestamptz not null,
  first_seen_at timestamptz not null,
  hash text not null,
  author text,
  video_ids text[] not null default '{}',
  metadata jsonb not null default '{}'::jsonb
);
create index if not exists raw_items_source_idx on raw_items(source_id, fetched_at desc);

create table if not exists discoveries (
  id text primary key,
  title text not null,
  title_fr text,
  summary text not null,
  summary_fr text,
  category text not null,
  reliability text not null check (reliability in ('official','confirmed','reported','rumor')),  -- jamais 'personal' côté serveur
  status text not null default 'active' check (status in ('active','disputed','outdated','retracted')),
  reviewed boolean not null default false,
  reasons text[] not null default '{}',
  spoiler text not null check (spoiler in ('low','high')),
  actionable boolean not null default false,
  region_id text,
  place text,
  location_precision text not null default 'none' check (location_precision in ('none','region','named-place','validated')),
  x double precision,
  y double precision,
  conditions jsonb not null default '{}'::jsonb,
  score int not null default 0,
  opportunity jsonb not null default '{}'::jsonb,
  first_seen_at timestamptz not null,
  updated_at timestamptz not null,
  published_at timestamptz,
  last_verified_at timestamptz not null,
  -- Pas de point sur la carte sans validation
  constraint coords_only_if_validated check ((x is null and y is null) or location_precision = 'validated')
);
create index if not exists discoveries_rank_idx on discoveries(status, score desc);

create table if not exists discovery_evidence (
  discovery_id text not null references discoveries(id) on delete cascade,
  raw_key text not null references raw_items(key) on delete cascade,
  official boolean not null default false,
  origins text[] not null default '{}',          -- indépendance des preuves
  quotes text[] not null default '{}',
  primary key (discovery_id, raw_key)
);

create table if not exists discovery_revisions (
  id bigint generated always as identity primary key,
  discovery_id text not null references discoveries(id) on delete cascade,
  at timestamptz not null default now(),
  reason text not null,
  changes text[] not null default '{}'
);

create table if not exists media_references (
  discovery_id text not null references discoveries(id) on delete cascade,
  kind text not null check (kind in ('youtube')),
  video_id text not null,
  url text not null,
  thumbnail text not null check (thumbnail like 'https://i.ytimg.com/%'),  -- hébergé par YouTube, jamais copié
  credit text not null,
  rights text not null check (rights = 'youtube-terms'),
  primary key (discovery_id, video_id)
);

create table if not exists discovery_overrides (
  discovery_id text primary key references discoveries(id) on delete cascade,
  status text check (status in ('active','disputed','outdated','retracted')),
  reliability text check (reliability in ('official','confirmed','reported','rumor')),
  x double precision,
  y double precision,
  note text,
  updated_by uuid,
  updated_at timestamptz not null default now()
);

-- Progression joueur : la V0.5 garde le localStorage ; table prête pour une synchronisation optionnelle.
create table if not exists player_progress (
  user_id uuid not null,
  discovery_id text not null,
  completed_at timestamptz not null default now(),
  primary key (user_id, discovery_id)
);

-- ── RLS : lecture publique bornée, aucune écriture anonyme ──────────────────────
alter table source_registry enable row level security;
alter table ingestion_runs enable row level security;
alter table raw_items enable row level security;
alter table discoveries enable row level security;
alter table discovery_evidence enable row level security;
alter table discovery_revisions enable row level security;
alter table media_references enable row level security;
alter table discovery_overrides enable row level security;
alter table player_progress enable row level security;

create policy public_read_sources on source_registry for select to anon, authenticated using (true);
create policy public_read_discoveries on discoveries for select to anon, authenticated using (status <> 'retracted');
create policy public_read_evidence on discovery_evidence for select to anon, authenticated
  using (exists (select 1 from discoveries d where d.id = discovery_id and d.status <> 'retracted'));
create policy public_read_media on media_references for select to anon, authenticated using (true);
create policy public_read_revisions on discovery_revisions for select to anon, authenticated using (true);
-- raw_items, ingestion_runs, overrides : service uniquement (aucune policy = aucun accès anon)
create policy own_progress on player_progress for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Planification (Supabase) : pg_cron + pg_net appellent l'Edge Function « collect » toutes les 15 min.
-- select cron.schedule('leonida-collect', '*/15 * * * *', $$
--   select net.http_post(url := 'https://<PROJECT>.supabase.co/functions/v1/collect',
--     headers := jsonb_build_object('Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'collect_token')));
-- $$);
