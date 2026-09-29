# OrbitFi — Frontend Dashboard

Next.js 14 (App Router) + TypeScript + wagmi/viem + Tailwind CSS dashboard for the OrbitFi
risk-layered lending protocol, connected to **Sepolia testnet**.

## Getting started

```bash
# from frontend/
npm install
npm run dev        # http://localhost:3000
```

For a production build:

```bash
npm run build      # outputs to out/ (static HTML export)
npm start          # serve out/ locally (needs `serve`)
```

### Cloudflare Pages deployment

The app is configured for **static HTML export** (`output: "export"` in `next.config.mjs`), so it runs
on Cloudflare Pages without a Node.js runtime.

**Option A — GitHub integration (dashboard, recommended):**
1. Push this repo to GitHub.
2. Cloudflare Pages → Create project → **Connect to Git** → select the repo.
3. Framework preset: **Next.js (Static HTML Export)**.
4. Build command: `npm run build` ｜ Build output directory: `out`.
5. Deploy.

**Option B — Wrangler CLI:**
```bash
npx wrangler login          # once
npm run deploy:cf           # = wrangler pages deploy out --project-name=zzz-lend
```

> Note: `pages.dev` may also be blocked in some regions — for reliable access from China, connect
> a custom domain to the project. The app reads contract data over HTTPS RPC at runtime; if the
> default Sepolia RPC is unreachable from your region, set `NEXT_PUBLIC_RPC_URL` at build time.

### Environment variables (optional)

| Variable | Purpose |
|---|---|
| `NEXT_PUBLIC_RPC_URL` | Sepolia RPC (defaults to `https://ethereum-sepolia-rpc.publicnode.com`) |
| `NEXT_PUBLIC_WC_PROJECT_ID` | WalletConnect project id (enables WalletConnect; MetaMask works without it) |

Contract addresses are read from `src/lib/deployments/sepolia.json` (copy of
`contracts/deployments/sepolia.json`). ABI files live in `src/lib/abis/*.json` (extracted from
`contracts/out/` with `forge build`).

## Pages

- `/` — Home: pool stats (TVL, supply, borrow, utilization, liquidity, Supply APY, Reserve, Treasury),
  five **Choose Your Risk** LTV cards, and the full risk notice.
- `/dashboard` — Wallet-gated: position panel (collateral, debt, LTV, Health Factor) + four tabs
  **Supply / Withdraw / Borrow / Repay**, plus a "Get Test USDC" faucet button.
- `/stress-test` — Off-chain ETH-drop simulator: per-drop collateral value, LTV, Health Factor,
  liquidation status, estimated loss, and a 5-tier × 5-drop comparison table.
- `/history` — Demo metrics (Borrow APR / Supply APY / Utilization / Liquidations / Bad Debt /
  Reserve) with 24H / 7D / 30D switches. **Demo data** — labeled as such.
- `/about` — Project intro, risk disclosure, contract list (Etherscan links), audit status.

## Contract notes / function-name mismatches (important)

The task spec suggested several names that do **not** exist on-chain. The frontend uses the real
ABI (`contracts/out/LendingPool.sol/LendingPool.json`):

| Spec name | Actual contract function used |
|---|---|
| `getSupplyAPY()` | **`getSupplyAPR()`** |
| `getUserShares(address)` | `positions(address)[0]` / `getUserPosition(address)` |
| `getUserCollateral(address)` | `getUserPosition(address)` → collateral |
| `getUserDebt(address)` | **`getDebt(address)`** |
| `getUserLtv(address)` | computed: `debt / collateralValue` |
| `getCash()` | **`cash()`** |
| `totalBorrows()` | **`getTotalBorrows()`** |
| `maxLiquidatable(address)` | none — computed via `closeFactor` (50%) |
| `getEthPrice()/getUsdcPrice()` | `SwitchableOracle.getAssetPrice(address)` |
| `isSettable()` | `SwitchableOracle.useSettablePrice()` |
| `borrow(uint256,uint8)` | **`borrow(uint256,uint256)`** (tier is `uint256`) |
| `maxBorrowable(address,uint8)` | **`maxBorrowable(address,uint256)`** |

Write calls: `supply(amount)` / `withdraw(shares)` (shares, not USDC) /
`supplyCollateral()` (payable) / `borrow(amount, tier)` / `repay(amount)` /
`liquidate(user, amount, minSeize)`. USDC uses 6 decimals; `withdraw` takes **shares** = `usdc6 * 1e18 / supplyIndex`.

## Amounts & minimums (enforced by the protocol, also checked in the UI)

- Minimum supply: **10 USDC** (`MIN_SUPPLY`)
- Minimum borrow: **100 USDC** (`MIN_BORROW`)
- Minimum collateral: **0.01 ETH** (`MIN_COLLATERAL`)

## Known environment notes

- The USDC/USD Chainlink feed on Sepolia can be stale; the app reads ETH/USD from the switchable
  oracle and falls back to a configurable default (`FALLBACK_ETH_PRICE`) if the read reverts.
- WalletConnect requires `NEXT_PUBLIC_WC_PROJECT_ID`. MetaMask (injected) works out of the box.
- The MetaMask SDK pulls react-native-only packages; `next.config.mjs` stubs them for the web build.

## Safety

Testnet only. No real funds. All APY figures are **estimates** — nothing is guaranteed. Deposits
may lose principal on bad debt.
