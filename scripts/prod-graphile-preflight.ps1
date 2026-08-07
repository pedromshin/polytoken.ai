# Batch A §2.2 — the HARD-ORDERED prerequisite for migration 0061.
#
# WHY THIS EXISTS: 0061 (and 0053/0054) reference the graphile_worker schema and RAISE
# without it. Installing it is a one-shot, idempotent operation that must happen BEFORE
# deploy-migrate-prod.yml is dispatched. Getting the order wrong means a failed prod
# migration run.
#
# WHY IT IS A SCRIPT YOU RUN: connecting to the prod database is classifier-blocked for
# the agent, including read-only. This is the exact logic it would have run.
#
# WHAT IT DOES
#   default (no flag): READ-ONLY. Reports whether prod already has the graphile_worker
#                      schema, whether public.enqueue_job exists, and how many migrations
#                      the drizzle journal has recorded. Writes nothing.
#   -Apply:            additionally runs apps/worker/dist/install-schema.js against prod,
#                      which is graphile-worker's OWN idempotent migrate (safe to re-run;
#                      it only applies graphile migrations that are missing).
#
# It appends the pooler-required ?uselibpqcompat=true&sslmode=require, refuses any URL that
# is not the prod project ref, and never prints a connection string.
#
# USAGE (from repo root):
#   pwsh -File scripts/prod-graphile-preflight.ps1           # read-only status
#   pwsh -File scripts/prod-graphile-preflight.ps1 -Apply    # install the schema if needed
#
# AFTER a green -Apply run, dispatch the migration:
#   gh workflow run deploy-migrate-prod.yml -f confirm=MIGRATE-PROD

[CmdletBinding()]
param([switch]$Apply)

$ErrorActionPreference = 'Stop'

$RepoRoot = Split-Path -Parent $PSScriptRoot
$EnvFile = Join-Path $RepoRoot '.env.production'
$Installer = Join-Path $RepoRoot 'apps\worker\dist\install-schema.js'
$ProdRef = 'dazyccjijdahxyciptkp'
$Compat = 'uselibpqcompat=true&sslmode=require'

if (-not (Test-Path $EnvFile)) { throw "ABORT: $EnvFile not found." }
if (-not (Test-Path $Installer)) { throw "ABORT: $Installer not built. Run: npm run build -w @polytoken/worker" }

$map = @{}
foreach ($line in Get-Content $EnvFile) {
  if ($line -match '^([A-Za-z_0-9]+)=(.*)$') { $map[$Matches[1]] = $Matches[2].Trim('"') }
}

$base = $map['POSTGRES_URL_NON_POOLING']
if ([string]::IsNullOrWhiteSpace($base)) { throw 'ABORT: POSTGRES_URL_NON_POOLING absent from .env.production' }
if (-not $base.Contains($ProdRef)) { throw 'ABORT: URL does not carry the prod project ref. Refusing.' }
if (-not $base.Contains(':5432')) { throw 'ABORT: expected the SESSION-mode pooler (:5432). Transaction mode (:6543) breaks LISTEN/NOTIFY.' }
# NOTE: .Contains, NEVER -like '*?*' — PowerShell's -like treats '?' as a single-character
# WILDCARD, so '*?*' is true for every non-empty string. That bug appended the compat query
# with '&' instead of '?', and the driver read it as part of the database name.
$url = if ($base.Contains('uselibpqcompat')) { $base } else { $sep = if ($base.Contains('?')) { '&' } else { '?' }; "$base$sep$Compat" }

# Prove the assembled URL is well-formed before we ever connect.
$parsed = [System.Uri]$url
$dbName = $parsed.AbsolutePath.TrimStart('/')
if ($dbName -notmatch '^[A-Za-z0-9_]+$') { throw "ABORT: malformed database segment '$dbName' — the query string leaked into the path." }

# --- read-only status probe (no writes, introspection only) -----------------------------
$probe = Join-Path ([System.IO.Path]::GetTempPath()) 'prod-graphile-status.mjs'
@'
import { createRequire } from 'node:module';
const require = createRequire(process.env.REPO_PKG);
const postgres = require('postgres');
const sql = postgres(process.env.PROBE_URL, { prepare: false, max: 1, connect_timeout: 20, idle_timeout: 5 });
try {
  const [{ db }] = await sql`select current_database() as db`;
  const [gw] = await sql`select 1 as p from pg_namespace where nspname = 'graphile_worker'`;
  const [enq] = await sql`select 1 as p from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname='public' and p.proname='enqueue_job'`;
  const [{ n }] = await sql`select count(*)::int as n from drizzle.__drizzle_migrations`;
  console.log(`STATUS db=${db} graphile_worker=${gw ? 'PRESENT' : 'ABSENT'} enqueue_job=${enq ? 'PRESENT' : 'ABSENT'} migrations_recorded=${n}`);
} catch (e) {
  console.log('PROBE-FAIL ' + String(e && e.message ? e.message : e).slice(0, 200));
  process.exitCode = 1;
} finally { await sql.end({ timeout: 5 }); }
'@ | Set-Content -LiteralPath $probe -Encoding utf8

$env:PROBE_URL = $url
$env:REPO_PKG = (Join-Path $RepoRoot 'package.json')
Push-Location $RepoRoot
try { node $probe } finally { Pop-Location; $env:PROBE_URL = $null }
$probeExit = $LASTEXITCODE
Remove-Item -LiteralPath $probe -Force -ErrorAction SilentlyContinue

if ($probeExit -ne 0) { "`nProbe failed — check the password is current (PEDRO-CHECKLIST §3 warns .env.production may hold the stale post-outage password)."; exit 1 }

if (-not $Apply) {
  "`nREAD-ONLY — nothing written. If graphile_worker is ABSENT, re-run with -Apply before dispatching 0061."
  exit 0
}

# --- install (idempotent: graphile-worker's own migrate) --------------------------------
"`nInstalling/upgrading the graphile_worker schema on prod (idempotent)..."
$env:GRAPHILE_WORKER_CONNECTION_STRING = $url
Push-Location $RepoRoot
try { node $Installer } finally { Pop-Location; $env:GRAPHILE_WORKER_CONNECTION_STRING = $null }
if ($LASTEXITCODE -ne 0) { "install-schema FAILED (exit $LASTEXITCODE)"; exit 1 }

"`nSchema step green. Now dispatch the migration:"
"  gh workflow run deploy-migrate-prod.yml -f confirm=MIGRATE-PROD"
exit 0
