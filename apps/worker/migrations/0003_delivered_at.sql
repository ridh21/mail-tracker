-- Real "delivered" state. Stamped on arrival evidence (Apple Mail and mail
-- security gateways fetch images the moment mail lands), on the first open, or
-- when the bounce window closes with no bounce. Before this the double tick
-- existed only as a client-side timer, so it often never showed.
ALTER TABLE messages ADD COLUMN delivered_at INTEGER;
