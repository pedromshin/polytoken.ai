"""SES inbound → Gmail forwarder (polytoken personal-mail seam).

Triggered by an SES receipt rule that first writes the raw MIME to S3, then
invokes this function. We read the raw message, rewrite the envelope so SES
(sandbox or prod) will accept it — From must be our verified domain, Reply-To
carries the real sender — and re-send it to the operator's Gmail. The app's
agent-ingestion path is untouched: only mail matched by the personal-forward
receipt rule reaches this function.
"""
import os
import boto3
from email import message_from_bytes
from email.utils import parseaddr, formataddr

s3 = boto3.client("s3")
ses = boto3.client("ses")

BUCKET = os.environ["BUCKET"]
PREFIX = os.environ["PREFIX"]
FORWARD_TO = os.environ["FORWARD_TO"]
MAIL_FROM = os.environ["MAIL_FROM"]

STRIP = ("DKIM-Signature", "Return-Path", "Sender", "Message-ID",
         "Received", "ARC-Seal", "ARC-Message-Signature",
         "ARC-Authentication-Results", "Authentication-Results")


def handler(event, _ctx):
    for rec in event.get("Records", []):
        mail = rec["ses"]["mail"]
        message_id = mail["messageId"]
        key = f"{PREFIX}{message_id}"
        raw = s3.get_object(Bucket=BUCKET, Key=key)["Body"].read()
        msg = message_from_bytes(raw)

        orig_name, orig_addr = parseaddr(msg.get("From", ""))
        display = orig_name or orig_addr or "unknown sender"

        for h in STRIP:
            while h in msg:
                del msg[h]

        # From = our verified domain (SES will accept); show who it's really from.
        if "From" in msg:
            msg.replace_header("From", formataddr((f"{display} (via magnitudetech)", MAIL_FROM)))
        else:
            msg["From"] = formataddr((f"{display} (via magnitudetech)", MAIL_FROM))
        # Reply hits the real sender.
        if "Reply-To" in msg:
            msg.replace_header("Reply-To", msg.get("Reply-To"))
        elif orig_addr:
            msg["Reply-To"] = formataddr((orig_name, orig_addr))
        # Deliver to Gmail.
        if "To" in msg:
            msg.replace_header("To", FORWARD_TO)
        else:
            msg["To"] = FORWARD_TO

        ses.send_raw_email(
            Source=MAIL_FROM,
            Destinations=[FORWARD_TO],
            RawMessage={"Data": msg.as_bytes()},
        )
        print(f"forwarded messageId={message_id} from={orig_addr!r} to={FORWARD_TO}")
    return {"ok": True}
