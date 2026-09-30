#!/usr/bin/env bash
#
# Verify the OrbitFi Base mainnet contracts on BaseScan (Etherscan API V2).
#
# Usage:
#   BASESCAN_API_KEY=TVNSF... bash scripts/verify-basescan.sh
#
# Notes learned by running this for real:
#  - api.etherscan.io is unreachable from this network directly; it needs the
#    local proxy. Override with PROXY= if that ever changes.
#  - The V2 endpoint requires `chainid`, and this version of forge does not add
#    it on its own. It works by putting it in the verifier URL:
#      --verifier-url "https://api.etherscan.io/v2/api?chainid=8453"
#    forge appends its own parameters after it, so the chainid rides along.
#  - `wrangler secret bulk`-style exit codes are irrelevant here, but note that
#    `wrangler secret bulk`-style "exits 0 on abort" applies to nothing here;
#    forge verify-check reports the authoritative Pass/FAIL.

set -uo pipefail

KEY="${BASESCAN_API_KEY:-}"
if [ -z "$KEY" ]; then
  echo "ERROR: set BASESCAN_API_KEY (create one at https://basescan.org/myapikey)"
  exit 1
fi

PROXY="${PROXY:-http://127.0.0.1:7897}"
export HTTPS_PROXY="$PROXY"
export HTTP_PROXY="$PROXY"

# forge must run from contracts/ — it reads foundry.toml there for solc version,
# optimizer and via_ir. Run it from the repo root and every verify fails with
# "If cache is disabled, compiler version must be ... provided".
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONTRACTS_DIR="$(cd "$SCRIPT_DIR/../contracts" && pwd)"
cd "$CONTRACTS_DIR" || { echo "ERROR: contracts dir not found"; exit 1; }

VURL="https://api.etherscan.io/v2/api?chainid=8453"
RPC="${RPC_URL:-https://base-rpc.publicnode.com}"

USDC=0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913
ORACLE=0x1964A89320110B8f171CD737448C754c5aF768d7
IRM=0xDFA18803701508c4e597EbF3e7095Cb6B1F75184
RM=0x9A07c7C7C1769217E68238c2FCc56d4Cd03cd4FA
LM=0x84eA9699ebC335E323A0448DCC730b6D7dA7C09D
RSV=0xc957294CF1444B916FD0DF966Dc2cb0dA050973a
POOL=0xFeB11Be6e2F26ac19dBB4526Cbd1D540E07653e1
RE=0x2a70dd793E50FC95392ABBf0FAA436c533f8E883
ADMIN=0xec8d3193E0E128DF0e38F921122a7978F2f921ed
DELAY=172800

CA_RSV=$(cast abi-encode "constructor(address)" "$USDC")
CA_POOL=$(cast abi-encode "constructor(address,address,address,address,address,address)" "$USDC" "$ORACLE" "$IRM" "$RM" "$LM" "$RSV")
CA_RE=$(cast abi-encode "constructor(address,address)" "$ORACLE" "$POOL")
CA_TL=$(cast abi-encode "constructor(uint256,address[],address[],address)" "$DELAY" "[$ADMIN]" "[$ADMIN]" "$ADMIN")

verify() {
  local label="$1" addr="$2" target="$3"; shift 3
  echo ""
  echo "==================================================="
  echo " $label"
  echo " $addr"
  echo "==================================================="
  forge verify-contract \
    --rpc-url "$RPC" \
    --verifier etherscan \
    --verifier-url "$VURL" \
    --etherscan-api-key "$KEY" \
    "$addr" "$target" "$@" 2>&1 | tail -8
}

verify "ChainlinkOracle"     "$ORACLE" src/oracle/ChainlinkOracle.sol:ChainlinkOracle
verify "InterestRateModel"   "$IRM"    src/InterestRateModel.sol:InterestRateModel
verify "RiskManager"         "$RM"     src/RiskManager.sol:RiskManager
verify "LiquidationManager"  "$LM"     src/LiquidationManager.sol:LiquidationManager

verify "ReserveManager"      "$RSV"    src/ReserveManager.sol:ReserveManager \
  --constructor-args "$CA_RSV"

verify "LendingPool"         "$POOL"   src/LendingPool.sol:LendingPool \
  --constructor-args "$CA_POOL"

verify "RiskEngine"          "$RE"     src/risk/RiskEngine.sol:RiskEngine \
  --constructor-args "$CA_RE"

verify "TimelockController"  "0xe517c46e3Cc12E16E5C55E7e2508059EdB33Ae0a" \
  lib/openzeppelin-contracts/contracts/governance/TimelockController.sol:TimelockController \
  --constructor-args "$CA_TL"

echo ""
echo "==================================================="
echo " 提交完毕。逐个确认（API 会稍后才显示 Pass）："
echo "   bash scripts/verify-basescan-check.sh"
echo "==================================================="
