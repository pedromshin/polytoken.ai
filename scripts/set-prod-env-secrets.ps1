# Batch A §2.1 — publish the three PROD_* secrets into the GitHub "Production"
# environment so deploy-migrate-prod.yml can self-serve.
#
# WHY THIS IS A SCRIPT YOU RUN: reading .env.production and writing credentials to
# a remote secret store is classifier-blocked for the agent. The logic below is
# exactly what the agent would have executed.
#
# WHAT IT DOES
#   - reads .env.production (never prints a value; only names, lengths, flags)
#   - appends the pooler-required ?uselibpqcompat=true&sslmode=require when absent
#     (newer `pg` treats bare sslmode=require as verify-full -> SELF_SIGNED_CERT_IN_CHAIN;
#      this is the trap documented in deploy-migrate-prod.yml's header)
#   - REFUSES any value that does not carry the prod project ref
#   - pipes each value to `gh secret set` via stdin, so it never lands in a command
#     line or process listing
#
# PREREQ: `gh auth status` shows you logged in (it already does on this machine —
#         scopes repo+workflow are sufficient; you do NOT need a pasted PAT).
#
# USAGE (from repo root):
#   pwsh -File scripts/set-prod-env-secrets.ps1            # dry run: shows what WOULD be set
#   pwsh -File scripts/set-prod-env-secrets.ps1 -Apply     # actually writes the secrets

[CmdletBinding()]
param(
  [switch]$Apply,
  [string]$Repo = 'pedromshin/polytoken.ai',
  [string]$EnvName = 'Production'
)

$ErrorActionPreference = 'Stop'

$RepoRoot = Split-Path -Parent $PSScriptRoot
$EnvFile = Join-Path $RepoRoot '.env.production'
$ProdRef = 'dazyccjijdahxyciptkp'
$Compat = 'uselibpqcompat=true&sslmode=require'

if (-not (Test-Path $EnvFile)) { throw "ABORT: $EnvFile not found." }

$map = @{}
foreach ($line in Get-Content $EnvFile) {
  if ($line -match '^([A-Za-z_0-9]+)=(.*)$') { $map[$Matches[1]] = $Matches[2].Trim('"') }
}

function Add-Compat([string]$u) {
  if ([string]::IsNullOrWhiteSpace($u)) { return $u }
  if ($u -like '*uselibpqcompat*') { return $u }
  $sep = if ($u -like '*?*') { '&' } else { '?' }
  return "$u$sep$Compat"
}

# NEXT_PUBLIC_SUPABASE_URL is the project URL; PROD_SUPABASE_URL wants the same value.
$targets = @(
  @{ Name = 'PROD_POSTGRES_URL_NON_POOLING'; Value = (Add-Compat $map['POSTGRES_URL_NON_POOLING']); Expect = ':5432' }
  @{ Name = 'PROD_POSTGRES_URL';             Value = (Add-Compat $map['POSTGRES_URL']);             Expect = ':6543' }
  @{ Name = 'PROD_SUPABASE_URL';             Value = $map['NEXT_PUBLIC_SUPABASE_URL'];              Expect = 'supabase.co' }
)

$mode = if ($Apply) { 'APPLY' } else { 'DRY RUN' }
"Target: $Repo / environment '$EnvName' — mode: $mode`n"

$failures = 0
foreach ($t in $targets) {
  $name = $t.Name; $value = $t.Value; $expect = $t.Expect

  if ([string]::IsNullOrWhiteSpace($value)) { "SKIP  $name  — source value empty in .env.production"; $failures++; continue }
  if ($value -notlike "*$ProdRef*")         { "SKIP  $name  — value does not carry the prod project ref"; $failures++; continue }
  if ($value -notlike "*$expect*")          { "SKIP  $name  — expected marker '$expect' not found"; $failures++; continue }

  $shape = "len=$($value.Length) compat=$([bool]($value -like '*uselibpqcompat*'))"
  if (-not $Apply) { "WOULD-SET  $name  ($shape)"; continue }

  $value | gh secret set $name --env $EnvName --repo $Repo
  if ($LASTEXITCODE -eq 0) { "SET   $name  ($shape)" } else { "FAIL  $name  exit=$LASTEXITCODE"; $failures++ }
}

if ($Apply) {
  "`n--- verification (names + timestamps only) ---"
  gh secret list --env $EnvName --repo $Repo
}

if ($failures -gt 0) { "`n$failures target(s) did not go through — a human must look."; exit 1 }
if (-not $Apply) { "`nDRY RUN — nothing written. Re-run with -Apply." }
exit 0
