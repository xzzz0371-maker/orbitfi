# OrbitFi

Risk-tiered DeFi lending protocol on **Base mainnet** / **Sepolia testnet**.

**Live frontend**: <https://zzz-lend.pages.dev/>

## Overview

OrbitFi is a modular lending protocol: users deposit **USDC / USDT / DAI** to earn interest and borrow against **ETH / cbBTC** (Base V1) as collateral. Risk is controlled through **5-tier risk tiers (LTV/LT)**, with built-in liquidation, bad-debt handling, reserve, and Treasury split.

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

Everything is wrapped in one orchestrator. Fill `contracts/.env.mainnet` — only three values are
needed (`PRIVATE_KEY` / `MAINNET_ADMIN` / `MAINNET_TREASURY`); the rest is pre-configured.

```bash
node scripts/go-live.mjs check        # pre-flight, read-only: creds, tooling, caps priced in USD
node scripts/go-live.mjs dry-run      # full rehearsal on a local Base fork (deploy + 31 assertions)
node scripts/go-live.mjs broadcast    # real deploy + verify
node scripts/go-live.mjs post         # sync addresses into the frontend + build
```

Full runbook, including the manual step-by-step path: `docs/主网部署执行手册_2026-09-19.md`.

> ⚠️ **`DeployMainnet.s.sol` performs the full handover itself** — it grants `PARAM_ADMIN` /
> `PAUSER` / `DEFAULT_ADMIN` to the multisig (or Timelock), transfers `Ownable` ownership of
> IRM / RiskManager / ReserveManager, then `renounceRole`s the deployer. **Do not run
> `MainnetDeployAndTransfer.s.sol` afterwards**: the deployer no longer holds any role, so it
> would revert with `AccessControlUnauthorizedAccount` (the handover has *already succeeded*).
> That script is only for deployments that did **not** hand over (e.g. the testnet `Deploy.s.sol`).

> `check` refuses to proceed when `MAINNET_ADMIN` equals the deployer EOA: the handover would
> renounce every role with nobody left holding them, and that is irreversible.

## Docs

**Full index: [`docs/README.md`](docs/README.md)** — what to read for what, and what is historical.

Start here:

- `docs/接手指南.md` — developer handoff / quick start
- `docs/ZZZ_Lend_完整文档.md` — full protocol spec
- `docs/主网部署执行手册_2026-09-19.md` — mainnet deployment runbook (commands verified on a Base fork)
- `docs/上链差距清单_2026-09-15.md` — what is done, what is deliberately untouched, what remains
- `docs/主网上线决策建议_2026-09-15.md` — go/no-go gates and soft-launch caps
- `docs/代码审查报告_2026-09-15.md` — full code review (2 High / 7 Medium / 14 Low)
- `docs/修改方案_2026-09-15.md` — remediation plan (batches A–D)
- `docs/安全审计报告_V2多资产_2026-09-02.md` — internal security audit (V2 multi-asset)
- `docs/Fork主网dress rehearsal报告.md` — Base fork rehearsal (8/8 passed; source of the H2 evidence)
- `docs/主网Oracle配置表.md` — Base official Chainlink feed config
- `docs/主网多签与权限收口手册.md` — Safe multisig + Timelock permission handover guide
- `docs/冷启动与运营方案.md` — cold-start liquidity / caps / growth / monitoring plan

Historical documents (superseded, kept for traceability) live in `docs/archive/`.

## License

[MIT](LICENSE) © 2026 xzzz0371-maker

Free to use, modify and commercialize. **Please retain the project source and this copyright notice.**
