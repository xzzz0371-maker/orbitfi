"use client";

import { useMemo, useState } from "react";
import { type Address } from "viem";
import { useAccount } from "wagmi";
import { TIERS, BORROW_MARKETS } from "@/lib/config";
import { useUserPosition, useMarketStats, usePrices } from "@/lib/hooks";
import { CountUp } from "@/components/CountUp";

const DROPS = [10, 20, 30, 40, 50];

function statusOf(hf: number): "safe" | "warning" | "liquidatable" {
  if (hf >= 1.5) return "safe";
  if (hf >= 1) return "warning";
  return "liquidatable";
}

const HEAT: Record<string, { bg: string; text: string; label: string }> = {
  safe: { bg: "rgba(16,185,129,0.16)", text: "#059669", label: "Safe" },
  warning: { bg: "rgba(245,158,11,0.16)", text: "#b45309", label: "At Risk" },
  liquidatable: { bg: "rgba(239,68,68,0.18)", text: "#dc2626", label: "Liquidatable" },
};

export default function StressTestPage() {
  const { address, isConnected } = useAccount();
  const { position } = useUserPosition(address as Address);
  const { ethUsd, unavailable } = usePrices();
  const s0 = useMarketStats(0);
  const s1 = useMarketStats(1);
  const s2 = useMarketStats(2);
  const [drop, setDrop] = useState(30);

  // 价格不可用时用 0 占位仅为满足 hook/计算顺序；渲染前会提前返回，绝不会把这些数展示出去。
  const price = ethUsd ?? 0;

  const collateralEth = position ? Number(position.collateral) / 1e18 : 10;
  const debtUsdc = position ? Number(position.debt) / 1e18 : 24000;
  const tier = position && position.tier > 0n ? Number(position.tier) : 5;
  const cfg = TIERS.find((t) => t.tier === tier)!;

  const priceAfter = price * (1 - drop / 100);
  const collateralUsd = collateralEth * price;
  const collateralUsdAfter = collateralEth * priceAfter;
  const ltvAfter = (debtUsdc / collateralUsdAfter) * 100;
  const hfAfter = (collateralUsdAfter * (cfg.lt / 100)) / debtUsdc;
  const status = statusOf(hfAfter);
  const estLoss = status === "liquidatable" ? Math.max(0, debtUsdc - collateralUsdAfter) : 0;

  const markets = [s0, s1, s2];
  const reserveUsd = markets.reduce(
    (sum, s, i) => sum + Number(s.stats?.reserve ?? 0n) / Math.pow(10, BORROW_MARKETS[i].decimals),
    0,
  );
  const borrowUsd = markets.reduce(
    (sum, s, i) => sum + Number(s.stats?.borrows ?? 0n) / Math.pow(10, BORROW_MARKETS[i].decimals),
    0,
  );
  const reserveCoverage = borrowUsd > 0 ? (reserveUsd / borrowUsd) * 100 : 0;
  const poolCollateralAfter = borrowUsd * 2 * (1 - drop / 100);
  const poolShortfall = Math.max(0, borrowUsd - poolCollateralAfter * 0.78);
  const depositorLossPct = borrowUsd > 0 ? Math.min(100, (poolShortfall / borrowUsd) * 100) : 0;

  const table = useMemo(
    () =>
      TIERS.map((r) => ({
        ...r,
        cells: DROPS.map((d) => {
          const cv = collateralEth * price * (1 - d / 100);
          const debtForTier = collateralUsd * (r.ltv / 100);
          const hf = (cv * (r.lt / 100)) / (debtForTier || 1);
          return statusOf(hf);
        }),
      })),
    [collateralEth, collateralUsd, price],
  );

  // 价格不可用：直接停用，而不是拿硬编码价/0 去算出一组假的安全结论
  if (unavailable || ethUsd === undefined) {
    return (
      <div className="space-y-8">
        <div>
          <h1 className="font-display text-3xl font-bold text-slate-900">Stress Test</h1>
          <p className="mt-1 text-sm text-slate-500">
            Simulate an ETH price drop and see how your position and the pool react. Off-chain
            simulation — nothing is broadcast.
          </p>
        </div>
        <div className="card p-6 text-sm text-red-700 ring-1 ring-red-200">
          <span className="font-semibold">Price feed unavailable.</span> The stress test needs a live
          ETH price (oracle paused, feed stale, or the contract address is not configured). It is
          disabled rather than computed from a stale hard-coded value.
        </div>
      </div>
    );
  }

  const statusColor =
    status === "safe" ? "#059669" : status === "warning" ? "#b45309" : "#dc2626";

  return (
    <div className="space-y-8">
      <div>
        <h1 className="font-display text-3xl font-bold text-slate-900">Stress Test</h1>
        <p className="mt-1 text-sm text-slate-500">
          Simulate an ETH price drop and see how your position and the pool react. Off-chain
          simulation — nothing is broadcast.
        </p>
      </div>

      {/* Controls */}
      <div className="card card-hover p-6">
        <div className="flex flex-wrap items-end justify-between gap-6">
          <div className="w-full max-w-sm">
            <label className="label">ETH price drop</label>
            <input
              type="range"
              min={5}
              max={60}
              step={5}
              value={drop}
              onChange={(e) => setDrop(Number(e.target.value))}
              className="w-full accent-blue-600"
            />
            <div className="mt-1 flex justify-between text-[11px] text-slate-500">
              <span>-5%</span>
              <span>-{drop}%</span>
              <span>-60%</span>
            </div>
          </div>
          <div className="flex gap-2">
            {DROPS.map((d) => (
              <button
                key={d}
                onClick={() => setDrop(d)}
                className={`rounded-xl border px-3 py-2 text-sm font-semibold transition-colors ${
                  drop === d
                    ? "border-transparent bg-gradient-to-br from-accent to-blue-600 text-white shadow-lg shadow-accent/30"
                    : "border-slate-200 bg-white/60 text-slate-600 hover:border-accent/50"
                }`}
              >
                -{d}%
              </button>
            ))}
          </div>
        </div>
        <div className="mt-4 text-sm text-slate-500">
          Current ETH: <span className="font-semibold text-slate-800">${price.toLocaleString("en-US")}</span> →{" "}
          <span className="font-semibold text-red-600">${priceAfter.toLocaleString("en-US")}</span>
        </div>
        {!isConnected && (
          <p className="mt-2 text-xs text-slate-400">
            Not connected — showing a demo position (10 ETH collateral, ~80% LTV at tier 5).
          </p>
        )}
      </div>

      {/* Results */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <ResultCard label="Collateral value" value={collateralUsdAfter} prefix="$" decimals={0} sub={`from $${collateralUsd.toLocaleString("en-US", { maximumFractionDigits: 0 })}`} />
        <ResultCard label="LTV after" value={ltvAfter} suffix="%" decimals={2} tone={ltvAfter > cfg.ltv ? "red" : "default"} />
        <ResultCard label="Health Factor" value={hfAfter} decimals={2} tone={status === "safe" ? "green" : status === "warning" ? "amber" : "red"} />
        <ResultCard
          label="Liquidation status"
          valueText={status === "safe" ? "Safe" : status === "warning" ? "At Risk" : "Liquidatable"}
          tone={status === "safe" ? "green" : status === "warning" ? "amber" : "red"}
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <ResultCard label="Estimated loss if liquidated" value={estLoss} prefix="$" decimals={0} tone={estLoss > 0 ? "red" : "green"} big />
        <ResultCard label="Reserve coverage" value={reserveCoverage} suffix="%" decimals={2} sub="USDC+USDT+DAI reserves vs borrows (approx $1 each)" />
        <ResultCard label="Depositor loss estimate (pool)" value={depositorLossPct} prefix="~" suffix="%" decimals={1} tone={depositorLossPct > 0 ? "red" : "green"} big sub="demo assumption: pool collateral ~= 2x borrows - fund NAV can decline" />
      </div>

      {/* Heatmap */}
      <div>
        <h2 className="mb-3 font-display text-xl font-bold text-slate-800">
          Tier comparison — {collateralEth.toLocaleString("en-US", { maximumFractionDigits: 2 })} ETH collateral
        </h2>
        <div className="card card-hover overflow-x-auto p-4">
          <table className="w-full text-center text-sm">
            <thead>
              <tr className="text-slate-500">
                <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide">Tier</th>
                {DROPS.map((d) => (
                  <th key={d} className="px-3 py-2 text-xs font-semibold">
                    -{d}%
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {table.map((r) => (
                <tr key={r.tier} className="border-t border-slate-200/70">
                  <td className="px-3 py-2 text-left text-slate-700">
                    T{r.tier} · LTV {r.ltv}%
                  </td>
                  {r.cells.map((s, i) => {
                    const h = HEAT[s];
                    return (
                      <td key={i} className="px-2 py-2">
                        <span
                          className="inline-block w-full rounded-lg px-2 py-1.5 text-xs font-semibold"
                          style={{ backgroundColor: h.bg, color: h.text }}
                        >
                          {h.label}
                        </span>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-xs text-slate-500">
          Simulation results are for illustrative purposes only. They are based on current on-chain
          data and assumptions, and do not predict or guarantee actual outcomes. A Health Factor
          below 1.0 means your position may be liquidated.
        </p>
      </div>

      {/* status banner */}
      <div
        className="card flex items-center justify-between p-5"
        style={{ borderColor: statusColor, boxShadow: `0 8px 24px ${statusColor}22` }}
      >
        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Health factor after -{drop}%</div>
          <div className="font-display text-3xl font-bold" style={{ color: statusColor }}>
            <CountUp value={hfAfter} decimals={2} />
          </div>
        </div>
        <span className="rounded-xl px-4 py-2 text-sm font-bold" style={{ backgroundColor: statusColor, color: "#fff" }}>
          {status === "safe" ? "Safe" : status === "warning" ? "At Risk" : "Liquidatable"}
        </span>
      </div>
    </div>
  );
}

function ResultCard({
  label,
  value,
  valueText,
  prefix = "",
  suffix = "",
  decimals = 2,
  sub,
  tone = "default",
  big,
}: {
  label: string;
  value?: number;
  valueText?: string;
  prefix?: string;
  suffix?: string;
  decimals?: number;
  sub?: string;
  tone?: "default" | "green" | "amber" | "red";
  big?: boolean;
}) {
  const color =
    tone === "green"
      ? "text-emerald-600"
      : tone === "amber"
        ? "text-amber-600"
        : tone === "red"
          ? "text-red-600"
          : "text-slate-900";
  return (
    <div className="card card-hover p-5">
      <div className="stat-title">{label}</div>
      <div className={`mt-1 font-bold ${big ? "text-3xl" : "text-2xl"} ${color}`}>
        {valueText ? (
          valueText
        ) : (
          <CountUp value={value ?? 0} decimals={decimals} prefix={prefix} suffix={suffix} />
        )}
      </div>
      {sub && <div className="mt-1 text-xs text-slate-500">{sub}</div>}
    </div>
  );
}
