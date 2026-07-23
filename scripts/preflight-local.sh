#!/usr/bin/env bash
#
# preflight-local.sh — bash port of scripts/preflight-local.ps1 for Linux/macOS sessions.
#
# Bring the local polytoken stack to a known-green DB state, idempotently.
# Companion script to docs/RUN-LOCAL.md. Runs, in this exact order:
#   1. Kill stale python/uvicorn/node processes (zombie-process preflight).
#   2. Ensure Supabase is up under project_id=polytoken (stop a stale nauta
#      stack first if one is detected), then read the service_role key +
#      API URL from `npm run sb:status`.
#   3. Seed EXACTLY ONE auth.users row via the GoTrue admin/users API,
#      BEFORE migrating (the 0032 tenancy-backfill migration precondition).
#   4. Run `npm run db:migrate` (applies 0000-0035 via Drizzle).
#   5. Apply idempotent Supabase-role GRANTs + NOTIFY pgrst, piped into the
#      DB container via `docker exec -i` (plain `docker exec` drops stdin).
#   6. DB-based green assertion (has_table_privilege) -> PASS/FAIL, exits
#      nonzero on FAIL.
#
# Never echoes the service_role key or any other secret to stdout. All
# values this script emits are kept ASCII (a non-ASCII secret once caused
# a production outage -- same discipline applies here).
#
# Intentional divergences from the .ps1 (Windows-only checks skipped):
#   - Get-NetTCPConnection port check -> replaced with `ss`/`lsof` where available;
#     if neither tool exists we warn and continue (informational only in the .ps1 too).
#   - Get-Process/Stop-Process -> pkill by process name. Windows zombie-child
#     stdout-detach semantics don't apply on POSIX, but stale listeners do,
#     so the kill step is kept for behavior parity.

set -u

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

SEED_EMAIL="pedromaschio.shin@gmail.com"
DB_CONTAINER="supabase_db_polytoken"
API_URL_FALLBACK="http://127.0.0.1:54321"

cyan()   { printf '\033[36m%s\033[0m\n' "$*"; }
green()  { printf '\033[32m%s\033[0m\n' "$*"; }
yellow() { printf '\033[33m%s\033[0m\n' "$*"; }
red()    { printf '\033[31m%s\033[0m\n' "$*"; }

step() { echo ""; cyan "==> $*"; }
ok()   { green "[OK] $*"; }
warn() { yellow "[WARN] $*"; }
fail() { red "[FAIL] $*"; }

# ---------------------------------------------------------------------------
# Step 1: Kill stale processes (zombie-process preflight, see RUN-LOCAL.md #4)
# ---------------------------------------------------------------------------
step "Step 1/6: Killing stale python/uvicorn/node processes"

killed=0
for name in python python3 uvicorn node; do
    # pkill -x: exact process-name match, mirroring Get-Process name matching.
    if pkill -x "$name" 2>/dev/null; then
        killed=1
    fi
done
if [ "$killed" -eq 1 ]; then
    ok "Stopped stale process(es)"
else
    warn "No stale python/uvicorn/node processes found (nothing to kill)"
fi

port_listening() {
    local port="$1"
    if command -v ss >/dev/null 2>&1; then
        ss -ltn 2>/dev/null | awk '{print $4}' | grep -Eq "[:.]${port}\$"
    elif command -v lsof >/dev/null 2>&1; then
        lsof -iTCP:"$port" -sTCP:LISTEN -t >/dev/null 2>&1
    else
        return 2
    fi
}

for port in 8000 3000; do
    port_listening "$port"
    case $? in
        0) warn "Port $port is still LISTEN after kill -- a non-matched process may be holding it" ;;
        1) ok "Port $port is free" ;;
        *) warn "Neither ss nor lsof available -- skipping port $port check" ;;
    esac
done

# ---------------------------------------------------------------------------
# Step 2: Ensure Supabase is up under project_id=polytoken
# ---------------------------------------------------------------------------
step "Step 2/6: Ensuring Supabase is up (project_id=polytoken)"

if docker ps -a --format '{{.Names}}' 2>/dev/null | grep -q '_nauta$'; then
    warn "Stale nauta-project containers detected -- stopping them first"
    if ! npx supabase stop --project-id nauta; then
        warn "supabase stop --project-id nauta failed (continuing -- may already be stopped)"
    fi
fi

if ! npm run sb:start; then
    warn "npm run sb:start failed -- checking if the stack is already running"
fi

if ! status_output="$(npm run sb:status 2>&1)"; then
    fail "npm run sb:status failed -- Supabase does not appear to be running under project_id=polytoken"
    exit 1
fi

api_url="$API_URL_FALLBACK"
service_role_key=""

parsed_api_url="$(printf '%s\n' "$status_output" | sed -n 's/^[[:space:]]*API URL:[[:space:]]*\([^[:space:]]\{1,\}\)[[:space:]]*$/\1/p' | head -n1)"
[ -n "$parsed_api_url" ] && api_url="$parsed_api_url"
service_role_key="$(printf '%s\n' "$status_output" | sed -n 's/^[[:space:]]*service_role key:[[:space:]]*\([^[:space:]]\{1,\}\)[[:space:]]*$/\1/p' | head -n1)"

if [ -z "$service_role_key" ]; then
    fail "Could not parse service_role key out of 'npm run sb:status' output -- is Supabase running?"
    exit 1
fi
ok "Supabase is up (project_id=polytoken); API URL: $api_url; service_role key captured (not printed)"

# Known gotcha (docs/RUN-LOCAL.md #2): Google OAuth env() refs in config.toml resolve from the
# PROCESS env, not .env.local. Non-fatal warning -- does not block the DB-green gate.
if [ -z "${SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID:-}" ] || [ -z "${SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_SECRET:-}" ]; then
    warn "SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID/_SECRET not set in the process env -- local Google sign-in will silently fail to configure (see RUN-LOCAL.md #2)"
fi

# ---------------------------------------------------------------------------
# Step 3: Seed EXACTLY ONE auth user BEFORE migrating (0032 backfill precondition)
# ---------------------------------------------------------------------------
step "Step 3/6: Seeding single auth user ($SEED_EMAIL) via GoTrue admin API"

seed_body="{\"email\":\"$SEED_EMAIL\",\"email_confirm\":true}"
seed_response="$(curl -sS -w '\n%{http_code}' -X POST "$api_url/auth/v1/admin/users" \
    -H "apikey: $service_role_key" \
    -H "Authorization: Bearer $service_role_key" \
    -H "Content-Type: application/json" \
    -d "$seed_body" 2>&1)" || {
    fail "Failed to reach GoTrue admin API at $api_url"
    exit 1
}
seed_status="$(printf '%s' "$seed_response" | tail -n1)"
seed_json="$(printf '%s' "$seed_response" | sed '$d')"

if [ "$seed_status" = "200" ] || [ "$seed_status" = "201" ]; then
    seed_id="$(printf '%s' "$seed_json" | sed -n 's/.*"id"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -n1)"
    ok "Seeded auth user (id: $seed_id)"
elif printf '%s' "$seed_json" | grep -Eqi 'already.*registered|already exists|email_exists'; then
    ok "Auth user already exists -- treating as success (idempotent)"
else
    fail "Failed to seed auth user (HTTP $seed_status)"
    exit 1
fi

# ---------------------------------------------------------------------------
# Step 4: Run migrations (0000-0035 via Drizzle)
# ---------------------------------------------------------------------------
step "Step 4/6: Running db:migrate"

if ! npm run db:migrate; then
    fail "npm run db:migrate failed"
    exit 1
fi
ok "Migrations applied"

# ---------------------------------------------------------------------------
# Step 5: Idempotent Supabase-role GRANTs + NOTIFY pgrst, piped via docker exec -i
# ---------------------------------------------------------------------------
step "Step 5/6: Applying Supabase-role grants and reloading PostgREST"

grant_sql='GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON ALL ROUTINES IN SCHEMA public TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON ROUTINES TO anon, authenticated, service_role;
NOTIFY pgrst, '\''reload schema'\'';'

# NOTE: plain `docker exec` (without -i) drops stdin -- always use `docker exec -i` here.
if ! printf '%s\n' "$grant_sql" | docker exec -i "$DB_CONTAINER" psql -U postgres -d postgres -v ON_ERROR_STOP=1; then
    fail "Grant SQL failed against container '$DB_CONTAINER' (docker exec -i failed)"
    exit 1
fi
ok "Grants applied and PostgREST schema reload notified"

# ---------------------------------------------------------------------------
# Step 6: DB-based green assertion (trust the DB, not the terminal)
# ---------------------------------------------------------------------------
step "Step 6/6: DB-based green assertion"

priv_result="$(docker exec -i "$DB_CONTAINER" psql -U postgres -d postgres -tAc \
    "SELECT has_table_privilege('service_role', 'public.chat_conversations', 'SELECT');" 2>&1 | tr -d '[:space:]')"

table_count="$(docker exec -i "$DB_CONTAINER" psql -U postgres -d postgres -tAc \
    "SELECT count(*) FROM pg_tables WHERE schemaname = 'public';" 2>&1 | tr -d '[:space:]')"

priv_ok=false
[ "$priv_result" = "t" ] && priv_ok=true
table_count_ok=false
case "$table_count" in
    ''|*[!0-9]*) : ;;
    0) : ;;
    *) table_count_ok=true ;;
esac

if $priv_ok && $table_count_ok; then
    ok "PASS: has_table_privilege(service_role, public.chat_conversations, SELECT) = t; $table_count tables in public schema"
    echo ""
    green "Local stack is DB-verified green. Start the listener and web app per docs/RUN-LOCAL.md #3."
    exit 0
else
    fail "DB-based green assertion FAILED"
    if ! $priv_ok; then
        fail "  has_table_privilege check returned '$priv_result' (expected 't') -- grants may not have applied"
    fi
    if ! $table_count_ok; then
        fail "  public schema table count is '$table_count' (expected > 0) -- migrations may not have applied"
    fi
    exit 1
fi
