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
# Design rules learned the hard way - do not "simplify" these away:
#
#  1. `--secrets-file` on deploy, NOT `secret bulk`. bulk prompts
#     "There doesn't seem to be a Worker called ... Do you want to create a new
#     Worker with that name and add secrets to it?" when the Worker does not
#     exist yet, and it exits 0 even when the operator answers no. That exit
#     code is therefore worthless as a success signal.
#
#  2. The address is announced ONLY after the secret is confirmed present in
#     the Worker. A wallet whose key has been wiped looks exactly like a
#     working one to anyone reading the output, and funding it burns the money
#     permanently. Never print a fundable-looking address before verification.
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
    # No backticks in this message: inside a double-quoted PS string a backtick
    # is an escape character, and backtick-n would become a newline.
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

# Self-check the EIP-55 checksum. `cast wallet new` normally emits it correctly,
# but this address gets copied BY EYE into explorer and multisig UIs, and a
# wrong-case variant is rejected there as "invalid address checksum". Asserting
# it here means the printed address is always paste-ready.
$canonical = (& cast to-checksum $wallet.address).Trim()
if ($canonical -ne $wallet.address) {
    Fail "cast wallet new emitted a non-EIP-55 address ('$($wallet.address)'); refusing to continue."
}
$wallet.address = $canonical
Write-Host "Generated (address withheld until the secret is confirmed):" -ForegroundColor DarkGray
Write-Host "    ...$($wallet.address.Substring($wallet.address.Length - 6))" -ForegroundColor DarkGray

# --- deploy + attach the secret atomically -----------------------------------
# Written with the .NET file API (ASCII, no BOM) rather than a text cmdlet:
# PS 5.1 would otherwise pick its own encoding, and that is how these files get
# silently mangled on a non-ASCII path.
$deployOk = $false
$secretOk = $false
try {
    $payload = @{ KEEPER_PRIVATE_KEY = $wallet.private_key } | ConvertTo-Json -Compress
    [System.IO.File]::WriteAllText($TmpFile, $payload, [System.Text.Encoding]::ASCII)

    Write-Host ""
    Write-Host "Deploying the Worker and attaching the secret..." -ForegroundColor Cyan
    & $Wrangler deploy --secrets-file $TmpFile -c $Config
    # Only record outcomes here. Do NOT exit/Fail inside the try: exiting from a
    # try block is not a reliable way to still run the finally, and the finally
    # is what wipes the key off disk.
    $deployOk = ($LASTEXITCODE -eq 0)

    if ($deployOk) {
        # Exit code alone proves nothing here - confirm the binding really exists.
        $listOut = (& $Wrangler secret list -c $Config 2>&1 | Out-String)
        $secretOk = $listOut -match "KEEPER_PRIVATE_KEY"
    }
}
finally {
    if (Test-Path $TmpFile) {
        # overwrite before deleting so the key is not left recoverable in slack space
        $len = (Get-Item $TmpFile).Length
        [System.IO.File]::WriteAllText($TmpFile, ("x" * [Math]::Max(1, $len)), [System.Text.Encoding]::ASCII)
        Remove-Item $TmpFile -Force
    }
}

# --- report ------------------------------------------------------------------
# The key is gone either way by now, so an unverified wallet is worthless. Say
# so loudly rather than printing an address that looks fundable.
if (-not ($deployOk -and $secretOk)) {
    Write-Host ""
    Write-Host "DO NOT SEND ANY FUNDS TO THIS WALLET." -ForegroundColor Red -BackgroundColor Black
    Write-Host ""
    Write-Host "  $($wallet.address)" -ForegroundColor Red
    Write-Host ""
    Write-Host "The key for it was wiped when this run ended, so anything sent to it"
    Write-Host "would be unrecoverable. It currently holds nothing, so nothing was lost."
    Write-Host ""
    if (-not $deployOk) { Write-Host "Reason: wrangler deploy failed." -ForegroundColor Red }
    else { Write-Host "Reason: deploy succeeded but the secret binding KEEPER_PRIVATE_KEY is not present on the Worker." -ForegroundColor Red }
    Write-Host ""
    Write-Host "Fix that first, then re-run this script to get a fresh wallet." -ForegroundColor Yellow
    exit 1
}

Write-Host ""
Write-Host "Done. Worker deployed with an hourly cron, secret confirmed." -ForegroundColor Green
Write-Host ""
Write-Host "  FUND THIS ADDRESS with Base ETH" -ForegroundColor Yellow
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
