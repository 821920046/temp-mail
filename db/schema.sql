-- temp-mail D1 schema（冷数据归档）

CREATE TABLE IF NOT EXISTS mails (
  id            TEXT PRIMARY KEY,
  mailbox       TEXT NOT NULL,
  sender        TEXT NOT NULL,
  subject       TEXT,
  preview       TEXT,
  has_attachment INTEGER DEFAULT 0,
  code          TEXT,
  category      TEXT,
  raw_key       TEXT,
  received_at   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_mails_mailbox_time ON mails (mailbox, received_at DESC);
CREATE INDEX IF NOT EXISTS idx_mails_received ON mails (received_at);

-- 用户/地址绑定
CREATE TABLE IF NOT EXISTS addresses (
  address     TEXT PRIMARY KEY,
  password    TEXT,           -- 地址级独立密码（可选）
  user_id     TEXT,
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_addresses_user ON addresses (user_id);

-- 黑名单
CREATE TABLE IF NOT EXISTS blocklist (
  pattern    TEXT PRIMARY KEY, -- 发件人/域名/关键词
  reason     TEXT,
  created_at INTEGER NOT NULL
);

-- 限流令牌桶（免费方案：D1 持久化，替代付费的 RateLimiterDO）
CREATE TABLE IF NOT EXISTS rate_limits (
  scope_key   TEXT PRIMARY KEY, -- 形如 ip:1.2.3.4 / domain:x.com / address:a@x.com
  tokens      REAL NOT NULL,
  updated_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_rate_limits_updated ON rate_limits (updated_at);
