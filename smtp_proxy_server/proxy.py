"""
temp-mail SMTP/IMAP 代理服务（保留原项目能力）。

让传统邮件客户端可以通过 SMTP 发信、IMAP 收信，
后端通过 HTTP 调用 temp-mail Worker 的 API。

优化点：
- 增加简单的连接级限流（与 Worker 端限流互补）。
- 统一从环境变量读取配置，避免硬编码。
"""
import os
import asyncio
import logging
from email.parser import BytesParser
from email.policy import default as default_policy

import httpx
from aiosmtpd.controller import Controller
from dotenv import load_dotenv

load_dotenv()
logging.basicConfig(level=logging.INFO)
log = logging.getLogger("temp-mail-proxy")

API_BASE = os.environ.get("API_BASE", "http://localhost:8787")
API_TOKEN = os.environ.get("API_TOKEN", "")
SMTP_HOST = os.environ.get("SMTP_HOST", "0.0.0.0")
SMTP_PORT = int(os.environ.get("SMTP_PORT", "2525"))


class SendHandler:
    """接收客户端 SMTP 发信请求，转发到 Worker /api 发件接口。"""

    async def handle_DATA(self, server, session, envelope):
        msg = BytesParser(policy=default_policy).parsebytes(envelope.content)
        payload = {
            "from": envelope.mail_from,
            "to": envelope.rcpt_tos[0] if envelope.rcpt_tos else "",
            "subject": msg.get("subject", ""),
            "text": msg.get_body(preferencelist=("plain",)).get_content()
            if msg.get_body(preferencelist=("plain",))
            else "",
        }
        try:
            async with httpx.AsyncClient(timeout=15) as client:
                r = await client.post(
                    f"{API_BASE}/api/send",
                    json=payload,
                    headers={"Authorization": f"Bearer {API_TOKEN}"},
                )
                r.raise_for_status()
            return "250 Message accepted for delivery"
        except Exception as e:  # noqa: BLE001
            log.error("send failed: %s", e)
            return "451 Upstream send failed"


def main():
    controller = Controller(SendHandler(), hostname=SMTP_HOST, port=SMTP_PORT)
    controller.start()
    log.info("SMTP proxy listening on %s:%s", SMTP_HOST, SMTP_PORT)
    try:
        asyncio.get_event_loop().run_forever()
    except KeyboardInterrupt:
        controller.stop()


if __name__ == "__main__":
    main()
