-- An id is the time received, zero-padded, then a random suffix, so it sorts by time.
CREATE TABLE messages (
  id TEXT PRIMARY KEY NOT NULL,
  received_at INTEGER NOT NULL,
  recipient TEXT NOT NULL,
  header_from TEXT NOT NULL,
  subject TEXT NOT NULL,
  raw BLOB NOT NULL
);

CREATE INDEX messages_received_at ON messages (received_at);
