# batch-a-finish.ps1 — everything left in Batch A §3–§4 that CAN be automated, in one run.
#
# WHY THIS EXISTS: the agent is classifier-blocked on remote mutations (gh variables/secrets,
# AWS writes, DB credentials). This is the exact sequence it would have executed, with the
# zero-churn terraform gate MACHINE-CHECKED instead of eyeballed.
#
# STEPS
#   1. gh repo variable WORKER_DEPLOY_ENABLED=true            (CUT-02)
#   2. Secrets Manager staging GRAPHILE_WORKER_CONNECTION_STRING, session-mode :5432  (CUT-05.2)
#   3. terraform.tfvars <- worker_db_url_secret_arn_staging = <ARN>                   (CUT-05.3)
#   4. terraform plan + AUTOMATED ZERO-CHURN GATE                                     (CUT-05.4)
#   5. terraform apply + wait services-stable                                         (CUT-05.5)
#   6. Vercel STRIPE_SECRET_KEY + BILLING_ENABLED   (only if you pass -StripeSecretKey)
#
# SAFETY
#   - DRY RUN BY DEFAULT. -Apply performs steps 1-3 and 6. Step 5 additionally requires
#     -ApplyTerraform, because it is the only step with mail-outage blast radius.
#   - The zero-churn gate is a HARD REFUSAL, not a checklist: the plan must change EXACTLY
#     the three allowed addresses. Any SES / SNS / inbound-S3 / ALB / ["production"] resource,
#     or ANY destroy, aborts before apply.
#   - Refuses a staging URL carrying the prod project ref, or a transaction-pooled :6543 URL
#     (transaction pooling silently breaks LISTEN/NOTIFY — the whole point of this worker).
#   - Never prints a secret or a connection string.
#   - Idempotent: re-running skips what already exists.
#
# USAGE (from repo root)
#   pwsh -File scripts/batch-a-finish.ps1                                  # dry run, changes nothing
#   pwsh -File scripts/batch-a-finish.ps1 -Apply                           # steps 1-3, plan + gate
#   pwsh -File scripts/batch-a-finish.ps1 -Apply -ApplyTerraform           # ... and apply
#   pwsh -File scripts/batch-a-finish.ps1 -Apply -StripeSecretKey 'rk_live_...'   # ... and Vercel
#
# NOT AUTOMATABLE (verified, not assumed) — see the summary this prints at the end.

[CmdletBinding()]
param(
  [switch]$Apply,
  [switch]$ApplyTerraform,
  [string]$StripeSecretKey,
  [string]$Repo = 'pedromshin/polytoken.ai',
  [string]$Region = 'us-east-1'
)

$ErrorActionPreference = 'Stop'

$RepoRoot   = Split-Path -Parent $PSScriptRoot
$TfDir      = Join-Path $RepoRoot 'infrastructure\aws'
$TfVars     = Join-Path $TfDir 'terraform.tfvars'
$EnvStaging = Join-Path $RepoRoot '.env.staging'
$PlanFile   = Join-Path $TfDir 'cut05.tfplan'

$StagingRef = 'fyfwkjvbcrmjqjysdyqw'
$ProdRef    = 'dazyccjijdahxyciptkp'
$SecretName = 'staging/nauta-services/GRAPHILE_WORKER_CONNECTION_STRING'
$Cluster    = 'nauta-services-email-listener'
$Service    = 'nauta-services-email-listener-staging'
$Compat     = 'uselibpqcompat=true&sslmode=require'

$mode = if ($ApplyTerraform) { 'APPLY + TERRAFORM APPLY' } elseif ($Apply) { 'APPLY (no terraform apply)' } else { 'DRY RUN' }
Write-Host "`n=== Batch A finisher — mode: $mode ===`n"

$results = [System.Collections.ArrayList]::new()
function Step([string]$id, [string]$state, [string]$detail) {
  [void]$results.Add([pscustomobject]@{ Step = $id; State = $state; Detail = $detail })
  Write-Host ("{0,-28} {1,-8} {2}" -f $id, $state, $detail)
}

# ---------------------------------------------------------------------------------------
# 1. Repo variable WORKER_DEPLOY_ENABLED (CUT-02)
# ---------------------------------------------------------------------------------------
$existing = (gh variable list --repo $Repo 2>$null | Select-String -Pattern '^WORKER_DEPLOY_ENABLED\s')
if ($existing) {
  Step '1 WORKER_DEPLOY_ENABLED' 'SKIP' 'already set'
} elseif (-not $Apply) {
  Step '1 WORKER_DEPLOY_ENABLED' 'WOULD' 'gh variable set WORKER_DEPLOY_ENABLED=true'
} else {
  gh variable set WORKER_DEPLOY_ENABLED --body 'true' --repo $Repo | Out-Null
  if ($LASTEXITCODE -eq 0) { Step '1 WORKER_DEPLOY_ENABLED' 'OK' 'set to true' }
  else { Step '1 WORKER_DEPLOY_ENABLED' 'FAIL' "gh exit $LASTEXITCODE"; throw 'step 1 failed' }
}

# ---------------------------------------------------------------------------------------
# 2. Secrets Manager — staging session-mode connection string (CUT-05.2)
# ---------------------------------------------------------------------------------------
if (-not (Test-Path $EnvStaging)) { throw "ABORT: $EnvStaging not found." }
$envMap = @{}
foreach ($line in Get-Content $EnvStaging) {
  if ($line -match '^([A-Za-z_0-9]+)=(.*)$') { $envMap[$Matches[1]] = $Matches[2].Trim('"') }
}
$base = $envMap['POSTGRES_URL_NON_POOLING']
if ([string]::IsNullOrWhiteSpace($base)) { throw 'ABORT: POSTGRES_URL_NON_POOLING absent from .env.staging' }
if ($base.Contains($ProdRef))   { throw 'ABORT: the staging URL carries the PROD project ref. Refusing.' }
if (-not $base.Contains($StagingRef)) { throw "ABORT: URL does not carry the staging project ref ($StagingRef)." }
if ($base.Contains(':6543'))    { throw 'ABORT: transaction-pooled :6543 URL. graphile-worker needs SESSION mode (:5432) — transaction pooling silently breaks LISTEN/NOTIFY.' }
if (-not $base.Contains(':5432')) { throw 'ABORT: expected a session-mode :5432 URL.' }

# .Contains, never -like '*?*' — PowerShell's -like treats '?' as a single-char wildcard.
$secretValue = if ($base.Contains('uselibpqcompat')) { $base }
               elseif ($base.Contains('pooler.supabase.com')) { $sep = if ($base.Contains('?')) { '&' } else { '?' }; "$base$sep$Compat" }
               else { $base }
$dbSeg = ([System.Uri]$secretValue).AbsolutePath.TrimStart('/')
if ($dbSeg -notmatch '^[A-Za-z0-9_]+$') { throw "ABORT: malformed database segment '$dbSeg' — query string leaked into the path." }

$secretArn = $null
$describeArgs = @('secretsmanager', 'describe-secret', '--region', $Region, '--secret-id', $SecretName, '--query', 'ARN', '--output', 'text')
$found = (& aws @describeArgs 2>$null)
if ($LASTEXITCODE -eq 0 -and $found -and $found -ne 'None') {
  $secretArn = $found.Trim()
  Step '2 secretsmanager' 'SKIP' "exists ($($secretArn.Split(':')[-1]))"
} elseif (-not $Apply) {
  Step '2 secretsmanager' 'WOULD' "create-secret $SecretName (session-mode, len=$($secretValue.Length))"
} else {
  $createArgs = @(
    'secretsmanager', 'create-secret',
    '--region', $Region,
    '--name', $SecretName,
    '--description', 'Session-mode (non-pooling, port 5432) Postgres URL for graphile-worker LISTEN/NOTIFY - staging. NEVER a transaction-pooled (6543) URL.',
    '--secret-string', $secretValue,
    '--query', 'ARN', '--output', 'text'
  )
  $secretArn = (& aws @createArgs 2>&1)
  if ($LASTEXITCODE -ne 0) { Step '2 secretsmanager' 'FAIL' 'create-secret failed'; throw 'step 2 failed' }
  $secretArn = $secretArn.Trim()
  Step '2 secretsmanager' 'OK' "created ($($secretArn.Split(':')[-1]))"
}

# ---------------------------------------------------------------------------------------
# 3. tfvars line (CUT-05.3)
# ---------------------------------------------------------------------------------------
if (-not $secretArn) {
  Step '3 tfvars' 'SKIP' 'no ARN yet (dry run)'
} else {
  $tfLine = "worker_db_url_secret_arn_staging = `"$secretArn`""
  $tfText = if (Test-Path $TfVars) { Get-Content $TfVars -Raw } else { '' }
  if ($tfText -match '(?m)^\s*worker_db_url_secret_arn_staging\s*=\s*"([^"]*)"') {
    if ($Matches[1] -eq $secretArn) { Step '3 tfvars' 'SKIP' 'line already correct' }
    elseif (-not $Apply) { Step '3 tfvars' 'WOULD' 'replace existing line with the live ARN' }
    else {
      ($tfText -replace '(?m)^\s*worker_db_url_secret_arn_staging\s*=\s*"[^"]*"', $tfLine) | Set-Content -LiteralPath $TfVars -NoNewline
      Step '3 tfvars' 'OK' 'line replaced'
    }
  } elseif (-not $Apply) {
    Step '3 tfvars' 'WOULD' 'append worker_db_url_secret_arn_staging'
  } else {
    Add-Content -LiteralPath $TfVars -Value "`n$tfLine`n"
    Step '3 tfvars' 'OK' 'line appended'
  }
}

# ---------------------------------------------------------------------------------------
# 4. terraform plan + AUTOMATED ZERO-CHURN GATE (CUT-05.4)
# ---------------------------------------------------------------------------------------
# NOTE: native args are SPLATTED from an array, never written inline. PowerShell's inline
# native-argument parsing mangles `-out=...`-style flags here and terraform rejects the result
# with "Too many command line arguments". Splatting passes them through verbatim.
Push-Location $TfDir
try {
  $planArgs = @('plan', '-input=false', '-lock-timeout=120s', '-out=cut05.tfplan', '-no-color')
  & terraform @planArgs | Out-Null
  if ($LASTEXITCODE -ne 0) { Step '4 terraform plan' 'FAIL' "plan exit $LASTEXITCODE"; throw 'plan failed' }
  $showArgs = @('show', '-json', 'cut05.tfplan')
  $planJson = (& terraform @showArgs) | ConvertFrom-Json
} finally { Pop-Location }

$changes = @($planJson.resource_changes | Where-Object { $_.change.actions -notcontains 'no-op' })

$ALLOWED = @(
  'aws_ecs_task_definition.service["staging"]',
  'aws_ecs_service.service["staging"]',
  'aws_iam_role_policy.ecs_execution_secrets',
  'aws_iam_role_policy.ecs_execution_secrets[0]'
)
# Mail-outage class + anything production + any destroy. See runsheet §0.2.
$stopPatterns = @('aws_ses_', 'aws_sns_', 'aws_s3_bucket', 'aws_lb', 'aws_lambda', '\["production"\]')

$violations = [System.Collections.ArrayList]::new()
foreach ($c in $changes) {
  $addr = $c.address
  $acts = ($c.change.actions -join ',')
  if ($acts -match 'delete' -and $acts -notmatch 'create') { [void]$violations.Add("DESTROY $addr ($acts)") ; continue }
  foreach ($p in $stopPatterns) { if ($addr -match $p) { [void]$violations.Add("STOP-LIST $addr ($acts)"); break } }
  if ($ALLOWED -notcontains $addr) { [void]$violations.Add("UNEXPECTED $addr ($acts)") }
}

Write-Host "`n--- zero-churn gate ---"
if ($changes.Count -eq 0) {
  # "No changes" means one of two very different things — say which, rather than guessing.
  $wired = (Test-Path $TfVars) -and ((Get-Content $TfVars -Raw) -match 'worker_db_url_secret_arn_staging\s*=\s*"arn:')
  $why = if ($wired) { 'ARN is wired — infrastructure already matches, nothing left to apply' }
         else { 'secret ARN not wired yet, so the worker container is not in the plan' }
  Step '4 zero-churn gate' 'NOOP' "plan shows no changes ($why)"
} else {
  foreach ($c in $changes) { Write-Host ("    {0,-14} {1}" -f ($c.change.actions -join ','), $c.address) }
  if ($violations.Count -gt 0) {
    foreach ($v in $violations) { Write-Host "    !! $v" -ForegroundColor Red }
    Step '4 zero-churn gate' 'REFUSE' "$($violations.Count) violation(s) — NOT applying"
    Write-Host "`nGATE REFUSED. The plan touches resources outside the allowed three."
    Write-Host "Allowed: staging task-def (replace), staging service (update), read-secrets policy (update)."
    Write-Host "Read runsheet §CUT-05.4 before doing anything by hand. Plan saved at $PlanFile."
    exit 1
  }
  Step '4 zero-churn gate' 'PASS' "$($changes.Count) change(s), all allowed"
}

# ---------------------------------------------------------------------------------------
# 5. terraform apply + first-roll stability watch (CUT-05.5)
# ---------------------------------------------------------------------------------------
# ⛔ ORDERING GATE — the image must exist BEFORE the task def references it.
# ecs.tf:142-145: "The worker image must exist in ECR (:latest / :staging) BEFORE enabling,
# or every task start fails on image pull — essential=false does NOT cover an unpullable
# image." So an apply without the tag does not degrade gracefully; it takes the whole
# staging task down, listener included.
$imageOk = $true
if ($changes.Count -gt 0) {
  $tagArgs = @('ecr', 'list-images', '--region', $Region, '--repository-name', 'nauta-services-email-worker', '--query', 'imageIds[].imageTag', '--output', 'text')
  $tags = (& aws @tagArgs 2>$null)
  $imageOk = ($LASTEXITCODE -eq 0 -and $tags -and ($tags -split '\s+') -contains 'staging')
  if ($imageOk) { Step '4b worker image' 'PASS' 'ECR carries the :staging tag' }
  else {
    Step '4b worker image' 'REFUSE' 'no :staging image in nauta-services-email-worker'
    Write-Host "`nAPPLY BLOCKED — the plan adds a container referencing"
    Write-Host "  nauta-services-email-worker:staging   which does NOT exist in ECR."
    Write-Host "Per ecs.tf:142-145 an unpullable image fails EVERY task start; essential=false"
    Write-Host "does not cover it, so this would take the staging listener down too."
    Write-Host "`nBuild and push it first (WORKER_DEPLOY_ENABLED is set, so CI will):"
    Write-Host "  gh workflow run deploy-email-listener-staging.yml"
    Write-Host "then re-run this script."
  }
}

if ($changes.Count -eq 0) {
  Step '5 terraform apply' 'SKIP' 'nothing to apply'
} elseif (-not $imageOk) {
  Step '5 terraform apply' 'REFUSE' 'worker image missing — see above'
  exit 1
} elseif (-not $ApplyTerraform) {
  Step '5 terraform apply' 'WOULD' 're-run with -ApplyTerraform (gate passed)'
} else {
  Push-Location $TfDir
  try {
    $applyArgs = @('apply', '-input=false', '-lock-timeout=120s', '-no-color', 'cut05.tfplan')
    & terraform @applyArgs
    if ($LASTEXITCODE -ne 0) { Step '5 terraform apply' 'FAIL' "apply exit $LASTEXITCODE"; throw 'apply failed' }
  } finally { Pop-Location }
  Step '5 terraform apply' 'OK' 'applied'

  Write-Host "`nWaiting for the staging service to stabilise (watch for OOM on the first roll)..."
  $waitArgs = @('ecs', 'wait', 'services-stable', '--cluster', $Cluster, '--services', $Service, '--region', $Region)
  & aws @waitArgs
  if ($LASTEXITCODE -eq 0) { Step '5 services-stable' 'OK' 'staging service stable' }
  else { Step '5 services-stable' 'FAIL' 'did NOT stabilise — check ECS events + task memory' }
}

# ---------------------------------------------------------------------------------------
# 6. Vercel Stripe env (§4) — only with a key you minted in the dashboard
# ---------------------------------------------------------------------------------------
# NOTE: call vercel.cmd EXPLICITLY. `vercel` on this machine resolves to vercel.ps1, a
# PowerShell script that collapses splatted arguments into one token ("env ls" arrives as a
# single arg and the CLI rejects it as a directory). The .cmd shim passes them through.
$VercelCmd = Join-Path $env:APPDATA 'npm\vercel.cmd'

if ([string]::IsNullOrWhiteSpace($StripeSecretKey)) {
  Step '6 vercel stripe' 'SKIP' 'no -StripeSecretKey passed'
} elseif (-not $StripeSecretKey.StartsWith('rk_') -and -not $StripeSecretKey.StartsWith('sk_')) {
  Step '6 vercel stripe' 'FAIL' 'key is neither rk_ nor sk_ — refusing'
} elseif (-not (Test-Path $VercelCmd)) {
  Step '6 vercel stripe' 'FAIL' "vercel.cmd not found at $VercelCmd"
} else {
  # VALIDATE THE KEY BEFORE PUBLISHING IT. A dead or under-scoped key silently breaks
  # checkout at the worst possible moment; one read-only call proves it now.
  $probe = $null
  try {
    $probe = Invoke-RestMethod -Uri 'https://api.stripe.com/v1/products?limit=1' -Method Get `
      -Headers @{ Authorization = "Bearer $StripeSecretKey" } -ErrorAction Stop
  } catch {
    Step '6 stripe key check' 'FAIL' "Stripe rejected the key: $($_.Exception.Message)"
    $probe = $null
  }
  if ($null -eq $probe) {
    Step '6 vercel stripe' 'REFUSE' 'key failed live validation — not publishing it'
  } elseif (-not $Apply) {
    Step '6 stripe key check' 'PASS' "key valid (products readable: $($probe.data.Count))"
    Step '6 vercel stripe' 'WOULD' 'set STRIPE_SECRET_KEY (production)'
  } else {
    Step '6 stripe key check' 'PASS' "key valid (products readable: $($probe.data.Count))"
    Push-Location $RepoRoot
    try {
      # Both vars ALREADY EXIST on this project (set 2026-08-06), so `add` would fail —
      # `update` is the correct verb. Value goes over stdin, never a command line.
      $existing = (& $VercelCmd env ls production 2>&1 | Out-String)
      $verb = if ($existing -match 'STRIPE_SECRET_KEY') { 'update' } else { 'add' }
      # Non-interactive mode needs --yes (NOT --force, which this CLI does not accept here).
      # Value rides stdin so it never enters a command line or process listing.
      # Output is CAPTURED, not discarded — swallowing it hid the real error once already.
      $vout = ($StripeSecretKey | & $VercelCmd env $verb STRIPE_SECRET_KEY production --yes 2>&1 | Out-String)
      $ok = ($LASTEXITCODE -eq 0)
    } finally { Pop-Location }
    if ($ok) { Step '6 vercel stripe' 'OK' "STRIPE_SECRET_KEY $verb`d — REDEPLOY web for it to take effect" }
    else {
      Step '6 vercel stripe' 'FAIL' "vercel env $verb exited $LASTEXITCODE"
      # Print the CLI's own diagnosis; it is usually precise about what it wants.
      ($vout -split "`n") | Where-Object { $_.Trim() } | Select-Object -Last 12 | ForEach-Object { Write-Host "      $_" }
    }
  }
}

# BILLING_ENABLED is deliberately NOT touched here. It already exists on the project, and
# flipping it is what makes pricing publicly live — the BILL-05 boundary (ASSUMPTIONS A4),
# which is explicitly NOT assumable. Set it yourself when the legal pack is settled:
#   'true' | & "$env:APPDATA\npm\vercel.cmd" env update BILLING_ENABLED production --force

# ---------------------------------------------------------------------------------------
Write-Host "`n=== summary ==="
$results | Format-Table -AutoSize

Write-Host @"
=== STILL HUMAN-ONLY (verified, not assumed) ===
  §4 Mint the Stripe restricted key   — dashboard UI only. Then re-run this script with
                                        -Apply -StripeSecretKey '<key>' to wire Vercel.
  §5 BILL-04 checkout                 — needs your real card in a browser.
     BTAP-07                          — flip CANVAS_EMIT_TOOL_ENABLED, then a live chat turn.
     MCPX-09                          — an mcpServers entry in YOUR Claude Code config.
  §6 SES case 178464704400134 reply   — AWS Support CONSOLE. The Support API is unavailable
                                        on this account (SubscriptionRequiredException: no
                                        Premium Support plan), so it cannot be scripted at all.
                                        Draft text: .planning/PEDRO-DECISION-SHEET-2026-08-07.md §C1
"@
if (-not $Apply) { Write-Host "DRY RUN — nothing was changed. Re-run with -Apply." }
exit 0
