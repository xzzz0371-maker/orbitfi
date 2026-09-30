# OrbitFi keeper - one-time setup.
#
# Generates a DEDICATED hot wallet for the price-baseline keeper, uploads its
# key to Cloudflare as a Worker secret, and deploys the Worker - in one
# non-interactive step.
#
# The private key is never printed to the screen and never passed as a command
# line argument. It goes from `cast` straight into a temp file, into the
# Cloudflare secret store via `wrangler deploy --secrets-file`, and the temp
# file is then overwritten and deleted.
#
# `--secrets-file` is used rather than `wrangler secret bulk` on purpose:
# bulk prompts "There doesn't seem to be a Worker called ... Do you want to
# create a new Worker with that name and add secrets to it?" when the Worker
# does not exist yet. `deploy --secrets-file` creates the Worker and attaches
# the secret in a single non-interactive operation.
#
# Run from anywhere:
#     powershell -ExecutionPolicy Bypass -File services\keeper-worker\setup.ps1
#
# What you still have to do by hand afterwards: send Base ETH to the address
# the script prints. The keeper cannot pay gas without it.

$ErrorActionPreference = "Stop"

$Here     = $PSScriptRoot
$RepoRoot = Split-Path -Parent (Split-Path -Parent $Here)
$Config   = Join-Path $Here "wrangler.toml"
$TmpFile  = Join-Path $env:TEMP ("orbitfi-keeper-secret-" + [guid]::NewGuid().ToString("N") + ".json")

function Fail($msg) {
    Write-Host ""
    Write-Host "ERROR: $msg" -ForegroundColor Red
    exit 1
}

# --- tool checks -------------------------------------------------------------
$cast = Get-Command cast -ErrorAction SilentlyContinue
if (-not $cast) { Fail "cast not found. Install Foundry and make sure it is on PATH." }

# Prefer a repo-local wrangler, fall back to whatever is on PATH.
$Wrangler = $null
foreach ($cand in @(
        (Join-Path $Here "node_modules\.bin\wrangler.cmd"),
        (Join-Path $RepoRoot "frontend\node_modules\.bin\wrangler.cmd")
    )) {
    if (Test-Path $cand) { $Wrangler = $cand; break }
}
if (-not $Wrangler) {
    $onPath = Get-Command wrangler -ErrorAction SilentlyContinue
    # No backticks in this message: inside a double-quoted PowerShell string a
    # backtick is an escape character, and `n would turn into a newline.
    if ($onPath) { $Wrangler = $onPath.Source } else { Fail "wrangler not found. Run 'npm install' in services\keeper-worker first." }
}
Write-Host "Using wrangler: $Wrangler"

# --- generate the wallet -----------------------------------------------------
Write-Host ""
Write-Host "Generating a dedicated hot wallet..." -ForegroundColor Cyan

$raw = & cast wallet new --json
if ($LASTEXITCODE -ne 0 -or -not $raw) { Fail "cast wallet new failed." }

$parsed = $raw | ConvertFrom-Json
$wallet = $parsed.data[0]
if (-not $wallet.address -or -not $wallet.private_key) { Fail "could not parse cast wallet new output." }

# Print the address BEFORE anything that can fail. If a later step dies, the
# key is wiped and this address is the only trace - it must not stay a secret.
Write-Host ""
Write-Host "  HOT WALLET ADDRESS" -ForegroundColor Yellow
Write-Host "    $($wallet.address)" -ForegroundColor Yellow
Write-Host ""

# --- deploy + attach the secret atomically -----------------------------------
# Written with the .NET file API (ASCII, no BOM) rather than a text cmdlet:
# PowerShell 5.1 would otherwise pick its own encoding, and that is how these
# files get silently mangled on a non-ASCII path.
$deployOk = $false
try {
    $payload = @{ KEEPER_PRIVATE_KEY = $wallet.private_key } | ConvertTo-Json -Compress
    [System.IO.File]::WriteAllText($TmpFile, $payload, [System.Text.Encoding]::ASCII)

    Write-Host "Deploying the Worker and attaching the secret..." -ForegroundColor Cyan
    & $Wrangler deploy --secrets-file $TmpFile -c $Config
    # Only record success. Do NOT call exit/Fail in here: exiting from inside a
    # try block is not a reliable way to still run the finally below, and the
    # finally is what wipes the private key off disk.
    $deployOk = ($LASTEXITCODE -eq 0)
}
finally {
    if (Test-Path $TmpFile) {
        # overwrite before deleting so the key is not left recoverable in slack space
        $len = (Get-Item $TmpFile).Length
        [System.IO.File]::WriteAllText($TmpFile, ("x" * [Math]::Max(1, $len)), [System.Text.Encoding]::ASCII)
        Remove-Item $TmpFile -Force
    }
}

if (-not $deployOk) {
    Fail "wrangler deploy failed. The wallet holds no funds yet, so nothing was lost - safe to re-run."
}

# --- what the operator still has to do ---------------------------------------
Write-Host ""
Write-Host "Done. Worker deployed with an hourly cron." -ForegroundColor Green
Write-Host ""
Write-Host "  NEXT: send Base ETH to this address"
Write-Host "    $($wallet.address)" -ForegroundColor Yellow
Write-Host ""
Write-Host "  Suggested funding: 0.01 ETH (~7 months hourly). 0.001 ETH lasts about 3 weeks."
Write-Host "  This wallet needs NO protocol role - updatePrice() is permissionless."
Write-Host "  Keep this key separate from any admin key. Never reuse it anywhere else."
Write-Host ""
Write-Host "Verify after funding. workers.dev is DNS-poisoned on some networks, so"
Write-Host "read the logs rather than the URL:"
Write-Host ""
Write-Host '    cd services\keeper-worker'
Write-Host '    npm run tail'
Write-Host '    # expect "sent":5 in the hourly summary'
Write-Host ""
