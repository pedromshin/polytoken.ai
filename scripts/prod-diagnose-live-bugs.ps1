# prod-diagnose-live-bugs.ps1 — secure-prompt wrapper for prod-diagnose-live-bugs.mjs.
#
# WHY THIS WRAPPER EXISTS: the SUPABASE_SERVICE_ROLE_KEY has now been pasted into a shell
# once (my fault — I handed over bash `VAR=x cmd` syntax, which PowerShell does not support,
# so it landed in the terminal and the transcript). That key bypasses RLS on every table for
# every tenant and does not expire until 2096.
#
# It also cannot come from `vercel env pull`: Vercel marks it **Sensitive**, which is
# write-only, so the pulled file contains `SUPABASE_SERVICE_ROLE_KEY=""` — verified 2026-08-08.
# BILLING_ENABLED, STRIPE_PRICE_* and BILLING_APP_URL are the same; a pulled file can never
# supply them.
#
# So: prompt for it, hold it only for the child process, and clear it after. Read-Host
# -AsSecureString keeps it out of the console, out of PSReadLine history, and out of the
# process list.
#
# USAGE (from repo root):
#   pwsh -File scripts/prod-diagnose-live-bugs.ps1            # read-only
#   pwsh -File scripts/prod-diagnose-live-bugs.ps1 -Apply     # + create the user-files bucket
#
# Get the key from: Supabase dashboard -> Project Settings -> API -> service_role.
# ROTATE IT afterwards if it has ever been pasted anywhere (it has).

[CmdletBinding()]
param([switch]$Apply)

$ErrorActionPreference = 'Stop'
$RepoRoot = Split-Path -Parent $PSScriptRoot
$Script = Join-Path $RepoRoot 'scripts\prod-diagnose-live-bugs.mjs'
if (-not (Test-Path $Script)) { throw "ABORT: $Script not found." }

Write-Host "Paste the Supabase service_role key (input is hidden):"
$secure = Read-Host -AsSecureString
$plain = [Runtime.InteropServices.Marshal]::PtrToStringBSTR(
  [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure))

if ([string]::IsNullOrWhiteSpace($plain)) { throw 'ABORT: no key entered.' }
# A Supabase service_role key is a JWT: three dot-separated segments. Fail fast on a paste
# that lost characters rather than sending a truncated credential over the wire.
if (($plain -split '\.').Count -ne 3) { throw 'ABORT: that does not look like a JWT (expected three dot-separated segments).' }

try {
  $env:SUPABASE_SERVICE_ROLE_KEY = $plain
  Push-Location $RepoRoot
  try {
    $nodeArgs = @($Script)
    if ($Apply) { $nodeArgs += '--apply' }
    & node @nodeArgs
  } finally { Pop-Location }
} finally {
  # Clear on every path, including a throw or Ctrl-C.
  $env:SUPABASE_SERVICE_ROLE_KEY = $null
  $plain = $null
  [GC]::Collect()
}

Write-Host "`nKey cleared from this session's environment."
Write-Host "If this key has ever been pasted into a terminal or a chat, ROTATE it:"
Write-Host "  Supabase -> Project Settings -> API -> service_role -> rotate, then update Vercel."
