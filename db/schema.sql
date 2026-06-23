/* temp-mail D1 schema (cold archive + rate-limit token bucket, all free tier). No line comments so it stays valid even if pasted as a single line in the D1 Console. */
CREATE TABLE IF NOT EXISTS mails (id TEXT PRIMARY KEY, mailbox TEXT NOT NULL, sender TEXT NOT NULL, subject TEXT, preview TEXT, has_attachment INTEGER DEFAULT 0, code TEXT, category TEXT, raw_key TEXT, received_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS idx_mails_mailbox_time ON mails (mailbox, received_at DESC);
CREATE INDEX IF NOT EXISTS idx_mails_received ON mails (received_at);
CREATE TABLE IF NOT EXISTS addresses (address TEXT PRIMARY KEY, password TEXT, user_id TEXT, created_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS idx_addresses_user ON addresses (user_id);
CREATE TABLE IF NOT EXISTS blocklist (pattern TEXT PRIMARY KEY, reason TEXT, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS rate_limits (scope_key TEXT PRIMARY KEY, tokens REAL NOT NULL, updated_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS idx_rate_limits_updated ON rate_limits (updated_at);
