#!/usr/bin/env bash
#
# Check whether the OrbitFi Base mainnet contracts are source-verified on BaseScan.
#
# Usage:
#   BASESCAN_API_KEY=TVNSF... bash scripts/verify-basescan-check.sh
#
# Requires the proxy when api.etherscan.io is not directly reachable.

set -uo pipefail

KEY="${BASESCAN_API_KEY:-}"
if [ -z "$KEY" ]; then
  echo "ERROR: set BASESCAN_API_KEY"
  exit 1
fi

PROXY="${PROXY:-http://127.0.0.1:7897}"

declare -A C=(
  [ChainlinkOracle]="0x1964A89320110B8f171CD737448C754c5aF768d7"
  [InterestRateModel]="0xDFA18803701508c4e597EbF3e7095Cb6B1F75184"
  [RiskManager]="0x9A07c7C7C1769217E68238c2FCc56d4Cd03cd4FA"
  [LiquidationManager]="0x84eA9699ebC335E323A0448DCC730b6D7dA7C09D"
  [ReserveManager]="0xc957294CF1444B916FD0DF966Dc2cb0dA050973a"
  [LendingPool]="0xFeB11Be6e2F26ac19dBB4526Cbd1D540E07653e1"
  [RiskEngine]="0x2a70dd793E50FC95392ABBf0FAA436c533f8E883"
  [TimelockController]="0xe517c46e3Cc12E16E5C55E7e2508059EdB33Ae0a"
)

printf "%-22s %-44s %-10s %s\n" "CONTRACT" "ADDRESS" "VERIFIED" "NAME"
printf "%-22s %-44s %-10s %s\n" "--------" "-------" "--------" "----"

ok=0
total=0
for name in ChainlinkOracle InterestRateModel RiskManager LiquidationManager ReserveManager LendingPool RiskEngine TimelockController; do
  addr="${C[$name]}"
  total=$((total + 1))
  resp=$(curl -s --max-time 30 -x "$PROXY" \
    "https://api.etherscan.io/v2/api?chainid=8453&module=contract&action=getsourcecode&address=$addr&apikey=$KEY")
  line=$(echo "$resp" | python -c "
import json,sys
try:
    d=json.load(sys.stdin)
    r=d.get('result')
    if isinstance(r,list) and r:
        src=(r[0].get('SourceCode') or '')
        print(('YES' if src else 'NO') + '|' + (r[0].get('ContractName') or ''))
    else:
        print('ERR|' + str(r)[:60])
except Exception as e:
    print('ERR|' + str(e)[:60])
")
  verified="${line%%|*}"
  cname="${line#*|}"
  [ "$verified" = "YES" ] && ok=$((ok + 1))
  printf "%-22s %-44s %-10s %s\n" "$name" "$addr" "$verified" "$cname"
done

echo ""
echo "verified: $ok / $total"
[ "$ok" -eq "$total" ] && echo "ALL VERIFIED ✅" || echo "NOT COMPLETE — re-run scripts/verify-basescan.sh for the missing ones"
