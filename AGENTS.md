# temp-mail — AI Agent 集成说明

本项目内置对 AI Agent 友好的能力（保留并增强自原项目）。

## 可用于 Agent 的接口

- `POST /api/auth/one-time` — 为指定邮箱生成一次性访问 token。
- `GET  /api/mailbox/mails` — 拉取最新邮件（含 AI 提取的 `code` / `category` / `summary`）。

## 典型用法：获取验证码

1. 调用 `/api/auth/one-time` 拿到 token。
2. 轮询 `/api/mailbox/mails`，读取第一条邮件的 `code` 字段即为验证码。

## 安全提醒

- 一次性 token 默认 10 分钟过期且用后即焦。
- 所有接口受 IP/域名/地址三维限流保护。
