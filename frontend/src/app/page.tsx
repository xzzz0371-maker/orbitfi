"use client";

import { usePoolStats, useBorrowAprs, useMarketStats, useMarketBorrowAprs, useDepositorShare } from "@/lib/hooks";
import { RiskCard } from "@/components/RiskCard";
import { UtilizationRing } from "@/components/UtilizationRing";
import { RateCurve } from "@/components/RateCurve";
import { TIERS, BORROW_MARKETS, type MarketInfo } from "@/lib/config";
import { formatApy, formatToken } from "@/lib/format";
import { DEFAULT_DEPOSITOR_SHARE, projectedSupplyApyPct } from "@/lib/rates";

function MarketCard({ market, depositorShare }: { market: MarketInfo; depositorShare: number }) {
  const { stats } = useMarketStats(market.id);
  const borrowAprs = useMarketBorrowAprs(market.id);
  const supplyAprPct = stats ? (Number(stats.supplyApr) / 1e18) * 100 : 0;
  const utilPct = stats ? (Number(stats.utilization) / 1e18) * 100 : 0;
  const borrowAprTop = borrowAprs[5];
  const isEmpty = utilPct <= 0.0001;
  const displayedApy = isEmpty ? projectedSupplyApyPct(depositorShare) : supplyAprPct;

  return (
    <div className="card card-hover p-5">
      <div className="flex items-center justify-between">
        <div className="stat-title">{market.name}</div>
        <span className="pill bg-blue-50 text-blue-600 ring-1 ring-blue-200">{market.symbol}</span>
      </div>
      <div className="mt-1 text-2xl font-bold text-slate-900">
        {stats ? `$${formatToken(stats.supply, market.decimals, 0)}` : "--"}
      </div>
      <div className="text-xs text-slate-500">
        {market.stable ? "TVL (stable ≈ $)" : "TVL"}
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-slate-500">
        <div>
          <div>Total Supply</div>
          <div className="font-semibold text-slate-800">
            {stats ? formatToken(stats.supply, market.decimals) : "--"} {market.symbol}
          </div>
        </div>
        <div>
          <div>Total Borrow</div>
          <div className="font-semibold text-slate-800">
            {stats ? formatToken(stats.borrows, market.decimals) : "--"} {market.symbol}
          </div>
        </div>
      </div>
      <div className="mt-3 flex justify-between text-sm">
        <span className="text-slate-500">Utilization</span>
        <span className="font-semibold text-slate-800">{utilPct.toFixed(2)}%</span>
      </div>
      <div className="mt-2 flex items-center justify-between gap-2 border-t border-slate-200/60 pt-2">
        <span className="text-xs text-slate-500">Supply APY</span>
        <span className="font-semibold text-slate-800">{formatApy(displayedApy)}</span>
      </div>
      <div className="text-right text-[10px] text-slate-400">
        {isEmpty ? "Projected (assumes 80% utilization)" : `Current · projected ~${projectedSupplyApyPct(depositorShare).toFixed(2)}%`}
      </div>
      <div className="mt-1 flex justify-between text-xs text-slate-500">
        <span>Borrow APR · T5</span>
        <span className="font-semibold text-slate-800">
          {borrowAprTop !== undefined ? `~${borrowAprTop.toFixed(2)}%` : "--"}
        </span>
      </div>
      {utilPct < 20 && (
        <div className="mt-2 rounded-lg bg-amber-50 px-2 py-1 text-[11px] text-amber-700 ring-1 ring-amber-200">
          Idle funds — APY may stay low until utilization rises.
        </div>
      )}
    </div>
  );
}

export default function HomePage() {
  const { stats, isPending } = usePoolStats();
  const borrowAprs = useBorrowAprs();
  // 存款人分成读链上；没读到才退回默认值（治理可改 reserveFactor / treasuryFactor）。
  const depositorShare = useDepositorShare() ?? DEFAULT_DEPOSITOR_SHARE;

  const supplyAprPct = stats ? (Number(stats.supplyApr) / 1e18) * 100 : 0;
  const utilPct = stats ? (Number(stats.utilization) / 1e18) * 100 : 0;

  return (
    <div className="space-y-12">
      {/* Hero */}
      <section className="grid items-center gap-8 lg:grid-cols-[1.4fr_1fr]">
        <div className="space-y-4">
          <span className="pill bg-blue-50 text-blue-600 ring-1 ring-blue-200">
            Base Mainnet · Live
          </span>
          <h1 className="font-display text-4xl font-bold text-slate-900 sm:text-5xl">
            Lending where <span className="text-gradient">you choose your risk</span>
          </h1>
          <p className="max-w-xl text-slate-500">
            Deposit USDC, USDT or DAI to earn, or borrow against ETH and cbBTC across five
            risk tiers. Real-time risk pricing, transparent reserves, and losses shared by
            depositors on bad debt — like a fund whose NAV can decline.
          </p>
          <div className="flex flex-wrap gap-3">
            <a href="/dashboard" className="btn-primary">
              Launch App
            </a>
            <a href="/stress-test" className="btn-outline">
              Run Stress Test
            </a>
          </div>
        </div>

        {/* Hero visual: utilization ring + risk ladder */}
        <div className="card card-hover flex flex-col items-center gap-5 p-6">
          {stats ? (
            <UtilizationRing value={utilPct} />
          ) : (
            <div className="skeleton h-44 w-44 rounded-full" />
          )}
          <div className="w-full">
            <div className="mb-1 text-center text-xs font-semibold uppercase tracking-wide text-slate-500">
              Risk ladder
            </div>
            <div className="flex h-3 w-full overflow-hidden rounded-full">
              {TIERS.map((t) => (
                <div
                  key={t.tier}
                  className="h-full"
                  style={{
                    width: `${100 / TIERS.length}%`,
                    background: `linear-gradient(180deg, rgba(255,255,255,0.35), transparent), ${
                      { Low: "#34d399", Medium: "#fbbf24", High: "#fb923c", "Very High": "#f87171", Extreme: "#ef4444" }[t.risk]
                    }`,
                  }}
                />
              ))}
            </div>
            <div className="mt-1 flex justify-between text-[10px] text-slate-500">
              <span>T1 · 50%</span>
              <span>T3 · 70%</span>
              <span>T5 · 80%</span>
            </div>
          </div>
        </div>
      </section>

      {/* Multi-market overview */}
      <section>
        <h2 className="mb-4 font-display text-xl font-bold text-slate-800">Markets</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {BORROW_MARKETS.map((m) => (
            <MarketCard key={m.id} market={m} depositorShare={depositorShare} />
          ))}
        </div>
        <p className="mt-3 text-xs text-slate-500">
          Each borrow asset is an independent market with its own utilization, rates, reserve and
          bad-debt accounting. Collateral: ETH and cbBTC are shared across markets.
        </p>
      </section>

      {/* Rate curve + reserve/treasury */}
      <section className="grid gap-6 lg:grid-cols-[1.6fr_1fr]">
        <div className="card card-hover p-6">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="font-display text-lg font-bold text-slate-800">Interest Rate Model</h2>
            <span className="text-xs text-slate-500">Projected · NORMAL preset</span>
          </div>
          <RateCurve />
        </div>
        <div className="grid gap-4">
          <div className="card card-hover p-5">
            <div className="stat-title">Risk Reserve (USDC)</div>
            <div className="mt-1 text-2xl font-bold text-slate-900">
              {stats ? `${(Number(stats.totalReserve) / 1e6).toLocaleString("en-US", { maximumFractionDigits: 2 })} USDC` : "--"}
            </div>
            <div className="mt-1 text-xs text-slate-500">First-loss buffer · target 3% of borrows</div>
          </div>
          <div className="card card-hover p-5">
            <div className="stat-title">Treasury (USDC)</div>
            <div className="mt-1 text-2xl font-bold text-slate-900">
              {stats ? `${(Number(stats.treasuryAccrued) / 1e6).toLocaleString("en-US", { maximumFractionDigits: 2 })} USDC` : "--"}
            </div>
            <div className="mt-1 text-xs text-slate-500">Pending protocol fees</div>
          </div>
          <div className="card card-hover p-5">
            <div className="stat-title">USDC Utilization</div>
            <div className="mt-1 text-2xl font-bold text-slate-900">{utilPct.toFixed(2)}%</div>
            <div className="mt-1 text-xs text-slate-500">Current borrow demand in the USDC market</div>
          </div>
        </div>
      </section>

      {/* Choose Your Risk */}
      <section>
        <h2 className="mb-1 font-display text-xl font-bold text-slate-800">Choose Your Risk</h2>
        <p className="mb-4 text-sm text-slate-500">
          Pick a tier. Higher LTV tiers offer greater capital efficiency but carry higher
          liquidation risk and higher interest rates. Select a tier aligned with your risk
          tolerance. LTV limits are calibrated per collateral asset (e.g. cbBTC uses a conservative
          table).
        </p>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
          {TIERS.map((t) => (
            <RiskCard
              key={t.tier}
              tier={t.tier}
              ltv={t.ltv}
              lt={t.lt}
              risk={t.risk}
              borrowApr={borrowAprs[t.tier]}
              supplyContribution={supplyAprPct}
            />
          ))}
        </div>
      </section>

      {/* Risk notice */}
      <section className="card border-red-200/70 p-5" style={{ borderColor: "rgba(239,68,68,0.25)" }}>
        <p className="text-sm text-red-700">
          <strong>Risk notice:</strong> Deposits are not guaranteed — your principal may decrease
          due to bad debt, similar to a fund whose NAV can decline. OrbitFi is transparent and
          non-custodial: 94% of borrower interest is passed directly to depositors, and all
          displayed APY/APR figures are projections based on current market conditions, not
          guarantees. Borrowing involves liquidation risk — monitor your Health Factor and keep it
          above 1.0.
        </p>
      </section>
    </div>
  );
}
