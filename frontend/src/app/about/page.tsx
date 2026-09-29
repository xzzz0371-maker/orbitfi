"use client";

import { usePoolStats } from "@/lib/hooks";
import { ADDRESSES, ETHERSCAN_URL } from "@/lib/config";

// 仅列出当前部署实际存在的合约：未部署的地址在 deployments/*.json 里是空串，直接过滤掉，
// 避免渲染出「0x…」空白行（原列表里的 SwitchableOracle 与主网无关，已移除）。
const CONTRACTS = [
  { name: "LendingPool", addr: ADDRESSES.lendingPool },
  { name: "USDC", addr: ADDRESSES.usdc },
  { name: "ChainlinkOracle (price source)", addr: ADDRESSES.chainlinkOracle },
  { name: "InterestRateModel", addr: ADDRESSES.interestRateModel },
  { name: "RiskManager", addr: ADDRESSES.riskManager },
  { name: "LiquidationManager", addr: ADDRESSES.liquidationManager },
  { name: "ReserveManager", addr: ADDRESSES.reserveManager },
  { name: "RiskEngine", addr: ADDRESSES.riskEngine },
].filter((c) => /^0x[0-9a-fA-F]{40}$/.test(c.addr));

export default function AboutPage() {
  const { stats } = usePoolStats();
  const reserveUsdc = stats ? Number(stats.totalReserve) / 1e6 : 0;
  const borrowsUsdc = stats ? Number(stats.totalBorrows) / 1e6 : 0;
  const reservePct = borrowsUsdc > 0 ? (reserveUsdc / borrowsUsdc) * 100 : 0;
  const treasuryUsdc = stats ? Number(stats.treasuryAccrued) / 1e6 : 0;

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <section>
        <h1 className="font-display text-3xl font-bold text-slate-900">About OrbitFi</h1>
        <p className="mt-3 text-sm leading-relaxed text-slate-600">
          OrbitFi is a risk-layered DeFi lending protocol. Depositors supply USDC and earn dynamic
          estimated yield; borrowers collateralize ETH and choose one of five LTV risk tiers
          (50–80%). The system prices risk in real time: higher tiers mean higher borrowing power,
          higher estimated yields — and higher risk.
        </p>
        <p className="mt-3 text-sm leading-relaxed text-slate-600">
          The protocol maintains a Risk Reserve at a prudent safety level (approximately 3% of
          total borrows) to safeguard depositors against bad debt. If bad debt ever exceeds the
          reserve, losses are shared proportionally by all depositors, similar to a fund whose NAV
          can decline.
        </p>
      </section>

      {/* Protocol reserves (live) */}
      <section className="card p-5">
        <h2 className="mb-4 font-display text-lg font-bold text-slate-800">
          Protocol Reserves <span className="text-xs font-normal text-slate-400">(live)</span>
        </h2>
        <div className="grid grid-cols-2 gap-4">
          <div className="rounded-xl bg-white/60 p-4 ring-1 ring-slate-200/60">
            <div className="stat-title">Risk Reserve</div>
            <div className="mt-1 text-2xl font-bold text-slate-900">
              {reserveUsdc.toLocaleString("en-US", { maximumFractionDigits: 2 })} USDC
            </div>
            <div className="text-xs text-slate-500">
              {borrowsUsdc > 0
                ? `${reservePct.toFixed(2)}% of total borrows (target ~3%)`
                : "No active borrows yet"}
            </div>
          </div>
          <div className="rounded-xl bg-white/60 p-4 ring-1 ring-slate-200/60">
            <div className="stat-title">Treasury</div>
            <div className="mt-1 text-2xl font-bold text-slate-900">
              {treasuryUsdc.toLocaleString("en-US", { maximumFractionDigits: 2 })} USDC
            </div>
            <div className="text-xs text-slate-500">Pending protocol fees</div>
          </div>
        </div>
      </section>

      {/* Revenue distribution */}
      <section className="card p-5">
        <h2 className="mb-4 font-display text-lg font-bold text-slate-800">Revenue Distribution</h2>
        <p className="mb-3 text-sm text-slate-600">
          94% of borrower interest is passed directly to depositors — among the most competitive
          rates in DeFi. The remaining fees fund the Risk Reserve and the Treasury (used for
          security audits, development, and bug bounties).
        </p>
        <div className="space-y-2">
          <DistributionRow label="Depositors" pct={94} color="#10b981" />
          <DistributionRow label="Risk Reserve" pct={4} color="#3b82f6" />
          <DistributionRow label="Treasury" pct={2} color="#8b5cf6" />
        </div>
        <p className="mt-3 text-xs text-slate-500">
          The protocol maintains a Risk Reserve at a prudent safety level (approximately 3% of
          total borrows) to safeguard depositors against bad debt. Once the reserve reaches its
          safety target, ongoing protocol fees are directed to the Treasury to fund security audits,
          protocol development, and long-term operational resilience — not to any individual.
        </p>
      </section>

      {/* Risk disclosure */}
      <section className="card p-5">
        <h2 className="mb-3 font-display text-lg font-bold text-slate-800">Risk Disclosure</h2>
        <p className="text-sm leading-relaxed text-slate-600">
          OrbitFi is a decentralized lending protocol. Depositors earn a variable share of borrower
          interest; rates are not fixed and may change with market conditions. The protocol
          maintains a Risk Reserve (~3% of borrows) to absorb bad debt; in the event bad debt
          exceeds the reserve, losses are proportionally shared by all depositors. Deposits are not
          principal-guaranteed. Neither OrbitFi nor any party guarantees returns. Always assess
          your own risk tolerance before participating.
        </p>
        <ul className="mt-3 list-disc space-y-2 pl-5 text-sm text-slate-600">
          <li>
            <strong className="text-slate-800">Oracle risk:</strong> prices come from Chainlink with
            staleness and deviation checks, but feeds can lag or be paused.
          </li>
          <li>
            <strong className="text-slate-800">Liquidation risk:</strong> if your Health Factor
            drops below 1, your collateral may be liquidated at a bonus to liquidators.
          </li>
          <li>
            <strong className="text-slate-800">Liquidity risk:</strong> withdrawals may fail if pool
            liquidity is insufficient.
          </li>
          <li>
            <strong className="text-slate-800">Smart contract risk:</strong> this is unaudited by an
            independent third party; use at your own risk.
          </li>
        </ul>
      </section>

      <section>
        <h2 className="mb-3 font-display text-lg font-bold text-slate-800">
          Deployed Contracts (Base)
        </h2>
        <div className="card overflow-x-auto p-4">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="text-slate-500">
                <th className="px-2 py-2">Contract</th>
                <th className="px-2 py-2">Address</th>
              </tr>
            </thead>
            <tbody>
              {CONTRACTS.map((c) => (
                <tr key={c.name} className="border-t border-slate-200/70">
                  <td className="px-2 py-2 text-slate-700">{c.name}</td>
                  <td className="px-2 py-2">
                    <a
                      className="text-accent hover:underline"
                      href={`${ETHERSCAN_URL}/address/${c.addr}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {c.addr.slice(0, 8)}…{c.addr.slice(-6)}
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card p-5">
        <h2 className="mb-2 font-display text-lg font-bold text-slate-800">Audit Status</h2>
        <p className="text-sm text-slate-600">
          Security review completed, pending third-party audit.
        </p>
      </section>

      <section className="card p-5" style={{ borderColor: "rgba(239,68,68,0.3)" }}>
        <h2 className="mb-2 font-display text-lg font-bold text-red-600">Disclaimer</h2>
        <p className="text-sm text-slate-600">
          This app runs on Base mainnet. Nothing on this page is an offer of financial products,
          and no returns are guaranteed. Cryptographic assets involve risk; only participate with
          funds you can afford to lose.
        </p>
      </section>
    </div>
  );
}

function DistributionRow({ label, pct, color }: { label: string; pct: number; color: string }) {
  return (
    <div>
      <div className="flex justify-between text-sm">
        <span className="text-slate-600">{label}</span>
        <span className="font-semibold text-slate-800">{pct}%</span>
      </div>
      <div className="mt-0.5 h-2 overflow-hidden rounded-full bg-slate-200/70">
        <div className="h-full rounded-full" style={{ width: `${pct}%`, background: color }} />
      </div>
    </div>
  );
}
