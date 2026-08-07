# scripts/sauce-backup.ps1 — the "sauce backup" milestone-close ritual.
# Standing rule (decision .planning/decisions/2026-08-07-HARNESS-LOCK.md §4): run at EVERY
# milestone completion. Captures the product's core IP at the boundary:
#   1. dated git tag            sauce-<date>-<label>            (pushed to origin)
#   2. full-ref git bundle      polytoken-all-refs-<date>.bundle (every branch + tag)
#   3. non-git zip              sauce-nongit-<date>.zip          (agent memory dir, user-scope
#      .claude agents/commands/skills/gsd, global CLAUDE.md, repo-scope gitignored .claude/skills)
# into C:\Users\pc\polytoken-backups\.
#
# BACKUP FAILURE = MILESTONE-CLOSE BLOCKER. Any error aborts with exit 1 — do not close the
# milestone until this script exits 0.
#
# Usage (from repo root):  pwsh scripts/sauce-backup.ps1 [-Label pre-v2.0]

param(
  [string]$Label = "milestone-close"
)

$ErrorActionPreference = "Stop"

$RepoRoot = Split-Path -Parent $PSScriptRoot
$BackupDir = "C:\Users\pc\polytoken-backups"
$Date = Get-Date -Format "yyyy-MM-dd"

New-Item -ItemType Directory -Force $BackupDir | Out-Null

# --- 1. Dated tag, pushed ---------------------------------------------------
$Tag = "sauce-$Date-$Label"
Push-Location $RepoRoot
try {
  git rev-parse -q --verify "refs/tags/$Tag" *> $null
  $tagExists = ($LASTEXITCODE -eq 0)
  if ($tagExists) {
    # Same-day rerun: disambiguate rather than move an existing tag.
    $Tag = "$Tag-$(Get-Date -Format HHmm)"
  }
  git tag $Tag
  if ($LASTEXITCODE -ne 0) { throw "git tag $Tag failed" }
  git push origin $Tag
  if ($LASTEXITCODE -ne 0) { throw "git push origin $Tag failed — BACKUP INCOMPLETE" }
  Write-Host "TAG      $Tag (pushed)"

  # --- 2. Full-ref bundle (every branch, every tag) -------------------------
  $Bundle = Join-Path $BackupDir "polytoken-all-refs-$Date.bundle"
  git bundle create $Bundle --all
  if ($LASTEXITCODE -ne 0) { throw "git bundle create failed" }
  git bundle verify $Bundle *> $null
  if ($LASTEXITCODE -ne 0) { throw "git bundle verify failed — bundle is corrupt" }
  Write-Host "BUNDLE   $Bundle (verified)"
}
finally {
  Pop-Location
}

# --- 3. Non-git zip: the IP that lives OUTSIDE the repo ----------------------
$MemoryDir = "C:\Users\pc\.claude\projects\c--Users-pc-Desktop-nauta-services-email-listener\memory"
$UserClaude = Join-Path $env:USERPROFILE ".claude"

# Hard-required members: the ritual is pointless without these.
$required = @(
  $MemoryDir,
  (Join-Path $UserClaude "CLAUDE.md")
)
foreach ($p in $required) {
  if (-not (Test-Path $p)) { throw "REQUIRED backup member missing: $p — BACKUP BLOCKED" }
}

# Optional members: include when present, note when absent.
$optional = @(
  (Join-Path $UserClaude "agents"),
  (Join-Path $UserClaude "commands"),
  (Join-Path $UserClaude "skills"),
  (Join-Path $UserClaude "gsd"),
  (Join-Path $UserClaude "rules"),
  (Join-Path $RepoRoot ".claude\skills")   # gitignored wholesale → absent from the bundle
)

$members = @($required)
foreach ($p in $optional) {
  if (Test-Path $p) { $members += $p } else { Write-Host "note: optional member absent, skipped: $p" }
}

$Zip = Join-Path $BackupDir "sauce-nongit-$Date.zip"
if (Test-Path $Zip) { Remove-Item -Force $Zip }
Compress-Archive -Path $members -DestinationPath $Zip
if (-not (Test-Path $Zip) -or ((Get-Item $Zip).Length -lt 1kb)) {
  throw "zip missing or implausibly small — BACKUP BLOCKED"
}
Write-Host "ZIP      $Zip ($([math]::Round((Get-Item $Zip).Length / 1mb, 1)) MB)"

Write-Host ""
Write-Host "SAUCE BACKUP COMPLETE — $Date ($Tag). Milestone close may proceed."
