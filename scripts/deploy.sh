#!/usr/bin/env bash
# 一键部署（P2）— 迁移数据库 → 部署 Worker → 部署前端。
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "==> [1/4] 安装依赖"
pnpm install --frozen-lockfile || pnpm install

echo "==> [2/4] 执行 D1 schema"
npx wrangler d1 execute temp-mail --file db/schema.sql --remote || true

echo "==> [3/4] 部署 Worker"
pnpm --filter worker deploy

echo "==> [4/4] 构建并部署前端 (Cloudflare Pages)"
pnpm --filter frontend build
npx wrangler pages deploy frontend/dist --project-name temp-mail || \
  echo "(跳过 Pages 部署：请先创建 Pages 项目 temp-mail)"

echo "✅ 部署完成"
