# OrbitFi keeper - one-time setup.
#
# Generates a DEDICATED hot wallet for the price-baseline keeper, uploads its
# key to Cloudflare as a Worker secret, and deploys the Worker.
#
# The private key is never printed to the screen and never passed as a command
# line argument. It goes from `cast` straight into a temp file, into the
# Cloudflare secret store, and the temp file is then overwritten and deleted.
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

# Prefer a repo-local wrangler, fall back to whatever is on PATH, then npx.
$Wrangler = $null
foreach ($cand in @(
        (Join-Path $Here "node_modules\.bin\wrangler.cmd"),
        (Join-Path $RepoRoot "frontend\node_modules\.bin\wrangler.cmd")
    )) {
    if (Test-Path $cand) { $Wrangler = $cand; break }
}
if (-not $Wrangler) {
    $onPath = Get-Command wrangler -ErrorAction SilentlyContinue
    if ($onPath) { $Wrangler = $onPath.Source } else { $Wrangler = "npx wrangler" }
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

# --- upload as a Cloudflare secret -------------------------------------------
# Written with the .NET file API (ASCII, no BOM) rather than a text cmdlet:
# PowerShell 5.1 would otherwise pick its own encoding, and on a non-ASCII path
# that is how these files get silently mangled.
try {
    $payload = @{ KEEPER_PRIVATE_KEY = $wallet.private_key } | ConvertTo-Json -Compress
    [System.IO.File]::WriteAllText($TmpFile, $payload, [System.Text.Encoding]::ASCII)

    Write-Host "Uploading the key to Cloudflare as a Worker secret..." -ForegroundColor Cyan
    & $Wrangler secret bulk $TmpFile -c $Config
    if ($LASTEXITCODE -ne 0) { Fail "wrangler secret bulk failed - nothing was changed." }

    Write-Host "Deploying the Worker (creates the hourly cron trigger)..." -ForegroundColor Cyan
    & $Wrangler deploy -c $Config
    if ($LASTEXITCODE -ne 0) { Fail "wrangler deploy failed. The secret is already stored; re-run just this script or deploy by hand." }
}
finally {
    if (Test-Path $TmpFile) {
        # overwrite before deleting so the key is not left recoverable in slack space
        $len = (Get-Item $TmpFile).Length
        [System.IO.File]::WriteAllText($TmpFile, ("x" * [Math]::Max(1, $len)), [System.Text.Encoding]::ASCII)
        Remove-Item $TmpFile -Force
    }
}

# --- what the operator still has to do ---------------------------------------
Write-Host ""
Write-Host "Done. Worker deployed, cron runs hourly." -ForegroundColor Green
Write-Host ""
Write-Host "  HOT WALLET ADDRESS (send Base ETH here):" -ForegroundColor Yellow
Write-Host "    $($wallet.address)" -ForegroundColor Yellow
Write-Host ""
Write-Host "  Suggested funding: 0.01 ETH (~7 months at hourly). 0.001 ETH lasts about 3 weeks."
Write-Host "  This wallet needs NO protocol role - updatePrice() is permissionless."
Write-Host "  Keep this key separate from any admin key. Never reuse it anywhere else."
Write-Host ""
Write-Host "Verify once funded:"
Write-Host "    curl https://orbitfi-keeper.<your-subdomain>.workers.dev"
Write-Host ""
