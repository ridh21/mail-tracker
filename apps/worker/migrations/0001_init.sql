-- All timestamps are unix epoch milliseconds.

CREATE TABLE users (
  id               TEXT PRIMARY KEY,
  google_sub       TEXT NOT NULL UNIQUE,
  email            TEXT NOT NULL UNIQUE,
  name             TEXT,
  picture          TEXT,
  settings         TEXT NOT NULL DEFAULT '{}',
  -- Base64 HMAC key handed to the extension for signing click-tracking URLs.
  link_key         TEXT NOT NULL,
  gmail_status     TEXT NOT NULL DEFAULT 'ok',
  history_id       TEXT,
  watch_expires_at INTEGER,
  created_at       INTEGER NOT NULL
);

CREATE TABLE oauth_tokens (
  user_id           TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  refresh_token_enc TEXT NOT NULL,
  access_token_enc  TEXT,
  access_expires_at INTEGER,
  scope             TEXT NOT NULL,
  updated_at        INTEGER NOT NULL
);

CREATE TABLE sessions (
  id           TEXT PRIMARY KEY,
  token_hash   TEXT NOT NULL UNIQUE,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind         TEXT NOT NULL CHECK (kind IN ('web', 'extension')),
  label        TEXT,
  created_at   INTEGER NOT NULL,
  last_used_at INTEGER NOT NULL,
  expires_at   INTEGER NOT NULL
);
CREATE INDEX sessions_user ON sessions(user_id);

CREATE TABLE threads (
  user_id          TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  id               TEXT NOT NULL,
  subject          TEXT NOT NULL DEFAULT '',
  last_activity_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, id)
);
CREATE INDEX threads_activity ON threads(user_id, last_activity_at DESC);

-- One row per message the user sent. Tracked messages carry a tracking_id;
-- messages sent from other clients are picked up by Gmail sync with tracking_id NULL.
CREATE TABLE messages (
  id               TEXT PRIMARY KEY,
  user_id          TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tracking_id      TEXT UNIQUE,
  gmail_message_id TEXT,
  thread_id        TEXT,
  subject          TEXT NOT NULL DEFAULT '',
  recipients       TEXT NOT NULL DEFAULT '[]',
  is_reply         INTEGER NOT NULL DEFAULT 0,
  registered_at    INTEGER NOT NULL,
  sent_at          INTEGER,
  gmail_confirmed  INTEGER NOT NULL DEFAULT 0,
  bounced_at       INTEGER,
  open_count       INTEGER NOT NULL DEFAULT 0,
  click_count      INTEGER NOT NULL DEFAULT 0,
  first_open_at    INTEGER,
  last_open_at     INTEGER,
  UNIQUE (user_id, gmail_message_id)
);
CREATE INDEX messages_user_sent ON messages(user_id, sent_at DESC);
CREATE INDEX messages_thread ON messages(user_id, thread_id);

CREATE TABLE links (
  message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  idx        INTEGER NOT NULL,
  url        TEXT NOT NULL,
  PRIMARY KEY (message_id, idx)
);

-- Raw pixel / click hits. user_id and message_id stay NULL until the
-- tracking id is registered (the pixel can load before registration lands).
CREATE TABLE open_events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  tracking_id TEXT NOT NULL,
  user_id     TEXT,
  message_id  TEXT,
  kind        TEXT NOT NULL CHECK (kind IN ('open', 'click')),
  link_idx    INTEGER,
  at          INTEGER NOT NULL,
  source      TEXT NOT NULL,
  counted     INTEGER NOT NULL DEFAULT 0,
  reason      TEXT,
  user_agent  TEXT,
  ip_hash     TEXT,
  country     TEXT,
  city        TEXT,
  asn         INTEGER
);
CREATE INDEX open_events_tracking ON open_events(tracking_id, at);
CREATE INDEX open_events_message ON open_events(message_id, at);
CREATE INDEX open_events_user ON open_events(user_id, at);

-- Inbound messages in tracked threads (replies and bounces).
CREATE TABLE replies (
  user_id          TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  gmail_message_id TEXT NOT NULL,
  thread_id        TEXT NOT NULL,
  from_email       TEXT NOT NULL,
  from_name        TEXT,
  at               INTEGER NOT NULL,
  is_bounce        INTEGER NOT NULL DEFAULT 0,
  snippet          TEXT,
  PRIMARY KEY (user_id, gmail_message_id)
);
CREATE INDEX replies_thread ON replies(user_id, thread_id, at);
