# ZZZ Lend

Risk-tiered DeFi lending protocol on **Base mainnet** / **Sepolia testnet**.

**Live frontend**: <https://zzz-lend.pages.dev/>

## Overview

ZZZ Lend is a modular lending protocol: users deposit **USDC / USDT / DAI** to earn interest and borrow against **ETH / cbBTC** (Base V1) as collateral. Risk is controlled through **5-tier risk tiers (LTV/LT)**, with built-in liquidation, bad-debt handling, reserve, and Treasury split.

> ⚠️ **Status**: The protocol has passed Sepolia testnet validation (230 tests green) and Base mainnet fork dress rehearsal, **but has NOT yet undergone an external security audit**. Please assess risks yourself before any mainnet deployment, or contact a professional auditor.

## Core Features

- **Multi-asset markets**: USDC (base), USDT, DAI lending markets × ETH, cbBTC collateral (wstETH contract support is kept but disabled on Base V1 due to no official feed)
- **Risk tiers**: 5 LTV/Liquidation Threshold tiers per collateral (cbBTC conservative 45/55/65/70/75, ETH 50/60/70/75/80), tiered borrowing rates
- **Supply / collateral caps**: `setMarketSupplyCap` / `setCollateralCap` per-market / per-collateral total caps (0 = unlimited)
- **Liquidation & bad debt**: collateral liquidation, `handleBadDebt` (reserve-first, then depositor dilution)
- **Revenue split**: borrower interest → depositors 94% / reserve 4% / Treasury 2% (governance adjustable)
- **Governance**: optional OZ TimelockController wrapper (delayed param changes); independent PAUSER instant circuit breaker; multisig (Safe) permission handover
- **Oracle**: Chainlink feeds with `_preflight` deployment checks (decimals / price / freshness)

## Architecture

```
contracts/
├── src/
│   ├── LendingPool.sol          # Core: supply/withdraw/borrow/repay, liquidation, caps, Treasury
│   ├── RiskManager.sol          # LTV / LT risk tiers
│   ├── LiquidationManager.sol   # Liquidation discount / bonus
│   ├── ReserveManager.sol       # Reserves
│   ├── InterestRateModel.sol    # Interest rate model (NORMAL preset)
│   ├── oracle/ChainlinkOracle.sol
│   └── risk/RiskEngine.sol      # Risk assessment & sampling
├── script/
│   ├── DeployMainnet.s.sol      # Base mainnet deploy template (Base official token/feed embedded)
│   └── MainnetDeployAndTransfer.s.sol # Multisig/Timelock permission handover (Step 4–11)
├── test/                        # forge test: 32 suites / 230 passed
└── deployments/                 # Deployment artifacts (gitignored)
frontend/       # Next.js frontend (zzz-lend.pages.dev)
services/monitor/ # Polling monitor (liquidatable / low HF / utilization / feed alerts, Telegram/webhook)
scripts/feed-health-check/ # Base feed health check (TS+viem)
docs/           # Full docs / audit reports / mainnet prep guides
```

## Quick Start (contracts)

```bash
cd contracts
cp .env.example .env   # fill RPC / private key
forge build
forge test             # full test suite (ForkMainnet runs only on Base fork)
# Base mainnet fork dress rehearsal:
forge test --match-contract ForkMainnet -vvv --fork-url https://mainnet.base.org
```

## Mainnet Deployment (Base · chainId 8453)

1. Create a Safe multisig (official addresses in `docs/主网多签与权限收口手册.md`)
2. `forge script script/DeployMainnet.s.sol:DeployMainnet --rpc-url ... --broadcast`
3. On-chain verification (see `docs/上链差距清单_2026-09-15.md` §3.1 for the exact `cast` checks)

> ⚠️ **`DeployMainnet.s.sol` performs the full handover itself** — it grants `PARAM_ADMIN` /
> `PAUSER` / `DEFAULT_ADMIN` to the multisig (or Timelock), transfers `Ownable` ownership of
> IRM / RiskManager / ReserveManager, then `renounceRole`s the deployer. **Do not run
> `MainnetDeployAndTransfer.s.sol` afterwards**: the deployer no longer holds any role, so it
> would revert with `AccessControlUnauthorizedAccount` (the handover has *already succeeded*).
> That script is only for deployments that did **not** hand over (e.g. the testnet `Deploy.s.sol`).

> Always dry-run on a fork before deploying. Note that a dry run still executes
> `_writeJson`, so point it at a scratch path:
> `MAINNET_DEPLOYMENTS_OUT=./deployments/dryrun_fork.json`.

## Docs

- `docs/ZZZ_Lend_完整文档.md` — full protocol spec
- `docs/安全审计报告_V2多资产_2026-09-02.md` — internal security audit (V2 multi-asset)
- `docs/E2E_Sepolia_测试报告.md` — Sepolia E2E test report
- `docs/Fork主网dress rehearsal报告.md` — Base mainnet fork rehearsal (8/8 passed)
- `docs/主网Oracle配置表.md` — Base official Chainlink feed config
- `docs/主网多签与权限收口手册.md` — Safe multisig + Timelock permission handover guide
- `docs/冷启动与运营方案.md` — cold-start liquidity / caps / growth / monitoring plan

## License

[MIT](LICENSE) © 2026 xzzz0371-maker

Free to use, modify and commercialize. **Please retain the project source and this copyright notice.**
