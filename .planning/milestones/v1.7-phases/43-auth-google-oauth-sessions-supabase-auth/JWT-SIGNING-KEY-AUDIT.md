# JWT Signing-Key Mode Audit (Phase 44 prerequisite)

**Recorded:** 2026-07-10 (AUTH-05, Section 6)

**Verified 2026-07-10 (Phase 49, plan 49-05):** content re-checked and unchanged; folded into the
tracked planning tree (was previously untracked). User to re-confirm live in the Supabase
Dashboard (Settings -> API -> JWT Keys, both hosted projects) during the 49-06 checkpoint per
`MORNING-CHECKLIST.md` Section A.

## Staging (`fyfwkjvbcrmjqjysdyqw` / nauta-staging)

- **Current key:** ECC (P-256) — asymmetric ES256
- **Previous key:** Legacy HS256 (Shared Secret), rotated ~1 month ago

## Production (`dazyccjijdahxyciptkp` / nauta-prod)

- **Current key:** ECC (P-256) — asymmetric ES256
- **Previous key:** Legacy HS256 (Shared Secret), rotated ~1 month ago

## Local (Supabase CLI)

- Defaults to legacy HS256 as of this writing (verify at Phase 44 implementation time).

## Phase 44 implication

Both hosted environments are on **asymmetric ES256**. FastAPI JWT verification should use
the JWKS endpoint approach:

```
https://<project-ref>.supabase.co/auth/v1/.well-known/jwks.json
```

Use `jwt.PyJWKClient` to fetch and cache the public key — no shared secret needed.
