-- Preserve the To / Cc / Bcc split. Before this column existed the worker
-- flattened every recipient into one list, so the dashboard labelled Cc and
-- Bcc people as "To" and notifications implied the first recipient opened it.
ALTER TABLE messages ADD COLUMN envelope TEXT;

-- Message lists page on COALESCE(sent_at, registered_at); an expression index
-- keeps that off a full sort as the mailbox grows.
CREATE INDEX IF NOT EXISTS messages_user_sort ON messages(user_id, COALESCE(sent_at, registered_at) DESC);

-- Insights aggregates counted opens per user over a date range.
CREATE INDEX IF NOT EXISTS open_events_user_counted ON open_events(user_id, kind, counted, at);
