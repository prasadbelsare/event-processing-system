CREATE TABLE IF NOT EXISTS packages (
  package_id       TEXT PRIMARY KEY,
  current_status   TEXT NOT NULL,
  current_location TEXT,
  last_event_at    TIMESTAMPTZ NOT NULL,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS package_events (
  event_id    UUID PRIMARY KEY,
  package_id  TEXT NOT NULL,
  event_type  TEXT NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL,
  payload     JSONB NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_package_events_package
  ON package_events (package_id, occurred_at);