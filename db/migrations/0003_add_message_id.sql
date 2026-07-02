-- 0003: 给 mails 增加 message_id 列（原始邮件 Message-ID）。
-- 用于“回复”功能：把回复邮件通过 In-Reply-To / References 头串联回原会话。
-- 对已存在的数据库执行（部署新 Worker 之前先跑）：
--   npx wrangler d1 execute temp-mail --file db/migrations/0003_add_message_id.sql --remote
ALTER TABLE mails ADD COLUMN message_id TEXT;
