"use client";

import { type PositionV2 } from "@/lib/hooks";
import { COLLATERALS, TIERS } from "@/lib/config";
import { HFBar } from "@/components/HFBar";
import { rawToNum, formatToken, formatUsd } from "@/lib/format";

export function PositionPanel({
  position,
  prices,
  pricesReady,
}: {
  position?: PositionV2;
  prices: Record<string, number>;
  /// false = 价格不可用：不得用 0 冒充，改为显示 "--"
  pricesReady: boolean;
}) {
  if (!position) {
    return (
      <div className="card p-6">
        <h2 className="mb-3 font-display text-lg font-bold text-slate-800">Your Position</h2>
        <p className="text-sm text-slate-500">
          Connect your wallet and supply collateral or borrow to see your position here.
        </p>
      </div>
    );
  }

  const debtUsd = Number(position.debtWad) / 1e18;
  const collUsd = Number(position.collateralValueWad) / 1e18;
  const tier = Number(position.tier);
  const cfg = TIERS.find((t) => t.tier === tier);
  const ltvPct = collUsd > 0 ? (debtUsd / collUsd) * 100 : 0;
  const hfNum = Number(position.healthFactor) / 1e18;
  const hfDisplay = position.healthFactor > BigInt(1e30) ? Number.MAX_SAFE_INTEGER : hfNum;

  const collRows = COLLATERALS.map((c) => {
    const bal = rawToNum(position.collateral[c.id] ?? 0n, c.decimals);
    const px = pricesReady ? prices[c.address] : undefined;
    const val = px === undefined ? undefined : bal * px;
    return { ...c, bal, val };
  });

  return (
    <div className="card p-6">
      <h2 className="mb-5 font-display text-lg font-bold text-slate-800">Your Position</h2>

      <div className="grid grid-cols-2 gap-4">
        <div className="rounded-xl bg-white/60 p-4 ring-1 ring-slate-200/60">
          <div className="stat-title">Collateral</div>
          <div className="mt-1 text-xl font-bold text-slate-900">{formatUsd(collUsd)}</div>
          <div className="text-xs text-slate-500">across {COLLATERALS.length} assets</div>
        </div>
        <div className="rounded-xl bg-white/60 p-4 ring-1 ring-slate-200/60">
          <div className="stat-title">Debt</div>
          <div className="mt-1 text-xl font-bold text-slate-900">{formatUsd(debtUsd)}</div>
          <div className="text-xs text-slate-500">Current LTV {ltvPct.toFixed(2)}%</div>
        </div>
      </div>

      <div className="mt-4 rounded-xl bg-white/60 p-3 ring-1 ring-slate-200/60">
        <div className="mb-2 stat-title">Collateral breakdown</div>
        {collRows.map((c) => (
          <div key={c.id} className="flex items-center justify-between py-1 text-sm">
            <span className="text-slate-500">
              {c.symbol}
              <span className="ml-2 text-xs text-slate-400">{c.bal > 0 ? formatToken(position.collateral[c.id] ?? 0n, c.decimals, 4) : "--"}</span>
            </span>
            <span className="font-semibold text-slate-800">
              {c.val === undefined ? "--" : formatUsd(c.val)}
            </span>
          </div>
        ))}
      </div>

      <div className="mt-4 grid grid-cols-3 gap-3 text-center">
        <div className="rounded-xl bg-white/60 p-3 ring-1 ring-slate-200/60">
          <div className="stat-title">Max LTV</div>
          <div className="mt-1 text-lg font-bold text-slate-900">{cfg ? `${cfg.ltv}%` : "--"}</div>
        </div>
        <div className="rounded-xl bg-white/60 p-3 ring-1 ring-slate-200/60">
          <div className="stat-title">Liq. Threshold</div>
          <div className="mt-1 text-lg font-bold text-slate-900">{cfg ? `${cfg.lt}%` : "--"}</div>
        </div>
        <div className="rounded-xl bg-white/60 p-3 ring-1 ring-slate-200/60">
          <div className="stat-title">Tier</div>
          <div className="mt-1 text-lg font-bold text-slate-900">
            {tier > 0 ? `T${tier} · ${cfg?.ltv}%` : "None"}
          </div>
        </div>
      </div>

      <div className="mt-5">
        <HFBar hf={hfDisplay} />
      </div>

      {position.liquidatable && (
        <div className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700 ring-1 ring-red-200">
          Your position is liquidatable. Add collateral or repay immediately.
        </div>
      )}
    </div>
  );
}
