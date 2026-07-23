# Runbook — listener trust-boundary hardening (task #13 remainder)

> Status: STAGED, not applied. The web/tRPC boundary is already tenant-safe
> (Phase 44 TENA-03 — every proxy asserts ownership before calling the
> listener). This runbook closes the *infra* gaps that sit behind that guard.
> Apply from a keyboard; each step is reversible and ordered so live inbound
> mail never breaks. — 2026-07-23

## Threat model (be precise about what this fixes)

The listener ALB (`aws_lb.main`, `infrastructure/aws/alb.tf`) is **internet-facing
and plaintext HTTP :80**, and auth is a **single shared static key**
(`Settings.API_KEY`, header `X-API-Key`) plus a **caller-asserted `X-User-Id`**
header that the listener *trusts* on the emails/chat endpoints
(`app/presentation/middleware/user_context.py`).

Consequences if the shared key leaks (or is sniffed off the wire, since it's
cleartext):
- An attacker hitting the ALB directly bypasses the web ownership checks and
  can read/mutate **any** tenant's data — they just set `X-User-Id` to the
  victim's uuid. Nothing on the listener verifies that header.
- All email content transits in cleartext between Vercel and AWS.

**Single-tenant caveat (today):** Pedro is the only tenant, so "any tenant" ==
Pedro. The leaked-key blast radius is one account. This is why deferring until
onboarding is defensible — but do it before the second user exists.

Fix has three independent changes. Do them in this order.

---

## Change 1 — TLS on the ALB (kills cleartext transit)

Needs a hostname + an ACM cert. The listener currently answers on the raw ELB
DNS name; give it a real subdomain (e.g. `listener.polytoken.ai`).

1. Add an ACM cert (DNS-validated) + a 443 listener, keep :80 as a redirect:

```hcl
# alb.tf — additive
resource "aws_acm_certificate" "listener" {
  domain_name       = "listener.polytoken.ai"
  validation_method = "DNS"
  lifecycle { create_before_destroy = true }
  tags = local.tags
}

# Create the CNAME(s) from aws_acm_certificate.listener.domain_validation_options
# in whatever hosts polytoken.ai DNS (Vercel/Cloudflare/Route53), then:

resource "aws_lb_listener" "https" {
  load_balancer_arn = aws_lb.main.arn
  port              = 443
  protocol          = "HTTPS"
  ssl_policy        = "ELBSecurityPolicy-TLS13-1-2-2021-06"
  certificate_arn   = aws_acm_certificate.listener.arn
  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.service["production"].arn
  }
  tags = local.tags
}
```

2. Open 443 on `aws_security_group.alb` (network.tf) alongside the existing
   80/8080 ingress.
3. Point DNS `listener.polytoken.ai` → the ALB (alias/CNAME to its DNS name).
4. Flip the web env: **Vercel → `nauta-web` Production → `EMAIL_LISTENER_URL`**
   from `http://nauta-services-...elb.amazonaws.com` to
   `https://listener.polytoken.ai`. Redeploy web.
5. Verify: `curl -sS https://listener.polytoken.ai/health` → 200. Then convert
   the :80 listener to a 301→443 redirect (don't delete it until the web env is
   confirmed flipped, so a mistake leaves the old path live).

Rollback: revert `EMAIL_LISTENER_URL` to the HTTP ELB name; the :80 listener
still forwards.

---

## Change 2 + 3 — per-user signed tokens (kills X-User-Id spoofing)

Replace the trusted-plaintext `X-User-Id` with a short-lived HMAC (HS256) token
the web **signs** and the listener **verifies**. Same shared-secret family as
the API key, but now the listener cryptographically proves the caller minted the
identity — a leaked *API key* alone no longer lets an attacker assert an
arbitrary user.

New shared secret: `LISTENER_USER_TOKEN_SECRET` (32+ random bytes). Provision it
in **both** ECS (Secrets Manager → task env, like `SUPABASE_SECRET_KEY`) and
Vercel Production. **Classifier note:** setting the ECS/Secrets-Manager value and
the Vercel value is Pedro's to do — do not paste secrets inline.

### Rollout ordering (dual-accept — never a flag day)

1. **Listener first, dual-accept.** Add `require_user_token` that, when
   `LISTENER_USER_TOKEN_SECRET` is set, accepts a valid signed token in a new
   `Authorization: Bearer <jwt>` (or `X-User-Token`) header AND, as a fallback,
   still honours legacy `X-User-Id`. When the secret is unset it behaves exactly
   like today's `require_user_id`. Deploy. (No behaviour change yet — secret
   unset.)
2. **Set the secret in ECS**, redeploy listener. Still dual-accept, so legacy
   `X-User-Id` from the current web build keeps working.
3. **Set the same secret in Vercel**, ship a web build where `getListenerConfig()`
   mints the token (`jsonwebtoken.sign({ sub: user.id }, secret, { expiresIn: '2m' })`)
   and sends it on every listener call, in addition to `X-API-Key`.
4. **Enforce.** Once web is confirmed sending tokens, drop the legacy
   `X-User-Id` fallback in the listener (verify-or-401) and deploy. Now a leaked
   API key cannot impersonate a user without the signing secret too.

### Listener verification sketch (`user_context.py`)

```python
# require_user_token — verify a web-minted HS256 token; fall back to legacy
# X-User-Id ONLY while USER_TOKEN_SECRET is unset (dual-accept window).
import jwt  # PyJWT — add to pyproject
def require_user_token(request: Request) -> str:
    secret = get_settings().USER_TOKEN_SECRET
    if secret:
        raw = request.headers.get("Authorization", "")
        token = raw[7:] if raw.startswith("Bearer ") else ""
        if token:
            try:
                claims = jwt.decode(token, secret, algorithms=["HS256"])
                sub = claims.get("sub")
                if sub:
                    return str(sub)
            except jwt.PyJWTError:
                raise HTTPException(status_code=401, detail="Unauthorized")
        # dual-accept window only — remove this branch at step 4:
    uid = request.headers.get("X-User-Id")
    if not uid:
        raise HTTPException(status_code=401, detail="Unauthorized")
    return uid
```

Swap `Depends(require_user_id)` → `Depends(require_user_token)` on the
emails/chat routers (they already depend on `require_user_id`). Ownership stays
where it is — this only hardens *identity*, not authorization.

Rollback at any step: unset `USER_TOKEN_SECRET` in ECS → listener reverts to
legacy `X-User-Id` on next task cycle. Keep the legacy fallback in code until
step 4 is verified in prod.

---

## Change 2b (optional, cheaper than tokens) — lock ALB ingress

If per-user tokens are more than you want right now, at least stop the public
internet from reaching the listener: restrict `aws_security_group.alb` ingress
to Vercel's egress range. Caveat: Vercel serverless egress IPs are **not a small
static set** on non-Enterprise plans, so this is unreliable unless you route the
web→listener calls through a fixed-IP egress (e.g. a NAT/Static-IP proxy). For a
robust IP allowlist you'd need Vercel's Secure Compute / a static-egress add-on.
Given that friction, **the signed-token change (2+3) is the better primary fix**;
treat ALB IP-locking as belt-and-suspenders only if a static egress already
exists.

---

## Verification checklist (post-apply)

- `curl https://listener.polytoken.ai/health` → 200 (TLS valid).
- `curl http://<elb>:80/health` → 301 to https.
- With a stale/absent token after step 4: emails/chat endpoints → 401.
- Web app end-to-end: inbox loads, email detail loads, reprocess works
  (proves the web is minting+sending valid tokens).
- `deploy-email-listener.yml` green on each listener deploy (ruff/mypy/pytest).
