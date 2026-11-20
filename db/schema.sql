-- LEONIDA OS — schéma PostgreSQL cible (V1). Non utilisé par la V0 (données démo embarquées).
-- Miroir de src/lib/types.ts.

CREATE TYPE category    AS ENUM ('mission','collectible','activity','vehicle','secret','event');
CREATE TYPE reliability AS ENUM ('official','verified','community','rumor');
CREATE TYPE provenance  AS ENUM ('official','demo','community');

CREATE TABLE region (
  id          text PRIMARY KEY,
  name        text NOT NULL,
  tagline     text,
  provenance  provenance NOT NULL,
  source_url  text,
  checked_at  date,
  geom        jsonb NOT NULL            -- GeoJSON Polygon (coordonnées monde ou lng/lat MapLibre)
);

CREATE TABLE discovery (
  id                 text PRIMARY KEY,
  title              text NOT NULL,
  category           category NOT NULL,
  region_id          text NOT NULL REFERENCES region(id),
  x                  real NOT NULL,
  y                  real NOT NULL,
  summary            text,
  reward             text,
  duration_min       smallint,
  difficulty         smallint CHECK (difficulty BETWEEN 1 AND 3),
  spoiler_chapter    smallint NOT NULL DEFAULT 0,
  content_potential  smallint CHECK (content_potential BETWEEN 0 AND 100),
  source_label       text,
  source_reliability reliability NOT NULL,
  provenance         provenance NOT NULL,
  ends_at            timestamptz,
  updated_at         timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE discovery_prerequisite (
  discovery_id     text REFERENCES discovery(id) ON DELETE CASCADE,
  requires_id      text REFERENCES discovery(id),
  requires_chapter smallint,
  CHECK ((requires_id IS NULL) <> (requires_chapter IS NULL))
);

CREATE TABLE radar_signal (
  id                text PRIMARY KEY,
  title             text NOT NULL,
  summary           text,
  region_id         text REFERENCES region(id),
  category          category NOT NULL,
  reported_at       timestamptz NOT NULL,
  reliability       reliability NOT NULL,
  confirmations     integer NOT NULL DEFAULT 0,
  content_potential smallint,
  potential_visual  smallint,
  potential_rarity  smallint,
  potential_trend   smallint,
  spoiler_chapter   smallint NOT NULL DEFAULT 0,
  discovery_id      text REFERENCES discovery(id),
  provenance        provenance NOT NULL
);

CREATE TABLE player (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pseudo        text NOT NULL,
  console       text,
  edition       text,
  chapter       smallint NOT NULL DEFAULT 0,
  spoiler_mode  text NOT NULL DEFAULT 'strict',
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE player_progress (
  player_id     uuid REFERENCES player(id) ON DELETE CASCADE,
  discovery_id  text REFERENCES discovery(id),
  completed_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (player_id, discovery_id)
);

CREATE TABLE player_signal (
  player_id  uuid REFERENCES player(id) ON DELETE CASCADE,
  signal_id  text REFERENCES radar_signal(id),
  tracked    boolean NOT NULL DEFAULT false,
  seen_at    timestamptz,
  PRIMARY KEY (player_id, signal_id)
);

CREATE INDEX ON discovery (region_id);
CREATE INDEX ON radar_signal (reported_at DESC);
