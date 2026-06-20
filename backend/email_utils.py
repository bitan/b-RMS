"""Email sending utilities using Gmail SMTP (free, no API key needed)."""
from __future__ import annotations

import asyncio
import logging
import smtplib
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from typing import Optional

from .config import settings

logger = logging.getLogger(__name__)


def _send_email_sync(to_email: str, subject: str, html_body: str, text_body: str) -> None:
    """Blocking SMTP send — run in a thread pool to avoid blocking the event loop."""
    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"] = f"{settings.smtp_from_name} <{settings.smtp_user}>"
    msg["To"] = to_email

    msg.attach(MIMEText(text_body, "plain"))
    msg.attach(MIMEText(html_body, "html"))

    with smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=15) as server:
        server.ehlo()
        server.starttls()
        server.login(settings.smtp_user, settings.smtp_password)
        server.sendmail(settings.smtp_user, to_email, msg.as_string())


async def send_email(to_email: str, subject: str, html_body: str, text_body: Optional[str] = None) -> bool:
    """Send an email asynchronously. Returns True on success, False on failure."""
    if not settings.email_enabled:
        logger.warning("Email not configured — SMTP_USER/SMTP_PASSWORD missing. Skipping send.")
        return False
    plain = text_body or "Please view this email in an HTML-capable client."
    try:
        loop = asyncio.get_event_loop()
        await loop.run_in_executor(None, _send_email_sync, to_email, subject, html_body, plain)
        logger.info("Email sent to %s: %s", to_email, subject)
        return True
    except Exception as exc:
        logger.error("Failed to send email to %s: %s", to_email, exc)
        return False


async def send_password_reset_email(to_email: str, name: str, reset_token: str, frontend_url: str) -> bool:
    """Send a password reset link email."""
    reset_url = f"{frontend_url}/reset-password?token={reset_token}"
    subject = "Reset your SuperMarket password"

    html_body = f"""
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#F0EEFF;font-family:'Segoe UI',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#F0EEFF;padding:40px 20px;">
    <tr><td align="center">
      <table width="480" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:24px;overflow:hidden;box-shadow:0 4px 24px rgba(124,58,237,0.12);">
        <!-- Header -->
        <tr>
          <td style="background:linear-gradient(135deg,#7C3AED,#6D28D9);padding:32px 40px;text-align:center;">
            <div style="width:56px;height:56px;background:rgba(255,255,255,0.2);border-radius:16px;display:inline-flex;align-items:center;justify-content:center;margin-bottom:12px;">
              <span style="font-size:28px;">🛒</span>
            </div>
            <h1 style="color:#ffffff;margin:0;font-size:22px;font-weight:700;">SuperMarket System</h1>
            <p style="color:rgba(255,255,255,0.8);margin:4px 0 0;font-size:13px;">Password Reset Request</p>
          </td>
        </tr>
        <!-- Body -->
        <tr>
          <td style="padding:36px 40px;">
            <p style="color:#1E1B4B;font-size:16px;margin:0 0 8px;">Hi {name},</p>
            <p style="color:#6B7280;font-size:14px;line-height:1.6;margin:0 0 24px;">
              We received a request to reset your password. Click the button below to set a new password.
              This link expires in <strong>{settings.password_reset_expire_minutes} minutes</strong>.
            </p>
            <div style="text-align:center;margin:32px 0;">
              <a href="{reset_url}"
                 style="display:inline-block;background:linear-gradient(135deg,#7C3AED,#6D28D9);color:#ffffff;text-decoration:none;padding:14px 36px;border-radius:12px;font-size:15px;font-weight:600;box-shadow:0 4px 14px rgba(124,58,237,0.4);">
                Reset Password
              </a>
            </div>
            <p style="color:#9CA3AF;font-size:12px;line-height:1.6;margin:24px 0 0;">
              If you didn't request a password reset, you can safely ignore this email.
              Your password will not change.<br><br>
              Or copy this link into your browser:<br>
              <a href="{reset_url}" style="color:#7C3AED;word-break:break-all;">{reset_url}</a>
            </p>
          </td>
        </tr>
        <!-- Footer -->
        <tr>
          <td style="background:#F9FAFB;padding:20px 40px;text-align:center;border-top:1px solid #E5E7EB;">
            <p style="color:#9CA3AF;font-size:12px;margin:0;">SuperMarket Management System · Automated message, do not reply</p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>
"""

    text_body = f"""Hi {name},

We received a request to reset your SuperMarket password.

Reset your password here (expires in {settings.password_reset_expire_minutes} minutes):
{reset_url}

If you didn't request this, ignore this email — your password won't change.

SuperMarket Management System
"""
    return await send_email(to_email, subject, html_body, text_body)
