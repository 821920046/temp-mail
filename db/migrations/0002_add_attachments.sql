-- 0002: 给 mails 增加 attachments 列（JSON：附件元数据清单），
-- 使附件下载列表在邮件被热缓存淘汰后仍可从 D1 恢复。
-- 对已存在的数据库执行（部署新 Worker 之前先跑）：
--   npx wrangler d1 execute temp-mail --file db/migrations/0002_add_attachments.sql --remote
ALTER TABLE mails ADD COLUMN attachments TEXT;
