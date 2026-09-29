"use client";

import { type MarketInfo } from "@/lib/config";
import { type MarketStats, useIrmPreset, useDepositorShare } from "@/lib/hooks";
import { formatAmount, rawToNum } from "@/lib/format";
import {
  DEFAULT_DEPOSITOR_SHARE,
  PRESET_EXTREME,
  PRESET_HIGH_VOLATILITY,
  PROJECTED_UTIL_PCT,
  UTIL_PREVIEW_POINTS,
  projectedSupplyApyPct,
  supplyAprAtUtil,
} from "@/lib/rates";
import { CountUp } from "@/components/CountUp";

const PRESET_NAME: Record<number, string> = {
  [PRESET_HIGH_VOLATILITY]: "HIGH_VOLATILITY",
  [PRESET_EXTREME]: "EXTREME",
};

/// 存款利率预览。
///
/// 两条铁律，否则这个面板会骗人：
/// 1. **模型值必须等链上确认预设是 NORMAL 才展示。** lib/rates.ts 只写了 NORMAL 那套曲线，
///    治理可以随时 applyPreset() 换成 HIGH_VOLATILITY / EXTREME。切了以后 NORMAL 曲线算出来的
///    APY 在链上根本不成立。
/// 2. **存款人分成读链上，不写死 94%。** reserveFactor / treasuryFactor 都是可改参数。
///
/// 另外必须区分数据来源：utilization、当前 APY、市场存量全部是链上真实值；
/// 只有"不同利用率下的 APY"是模型推演，所以那一块单独标注 assumption。
export function SupplyRatePreview({
  market,
  stats,
  currentAprPct,
  utilPct,
  amountRaw,
}: {
  market: MarketInfo;
  stats: MarketStats | undefined;
  currentAprPct: number | undefined;
  utilPct: number;
  amountRaw: bigint;
}) {
  const { preset, normal } = useIrmPreset();
  const depositorShare = useDepositorShare();
  // 读不到就用默认值只为把"假设"文案写全；下面所有模型数字仍然等 normal 确认后才出。
  const share = depositorShare ?? DEFAULT_DEPOSITOR_SHARE;

  const isEmpty = utilPct <= 0.0001;
  const projected = normal ? projectedSupplyApyPct(share) : undefined;
  // 有真实利用率时用链上值；池子空时链上就是 0，此时才回落到模型投影。
  const headline = isEmpty ? projected : currentAprPct;
  const headlineIsModel = headline !== undefined && isEmpty;

  const rows = normal
    ? UTIL_PREVIEW_POINTS.map((p) => ({ ...p, apy: supplyAprAtUtil(p.util, share) }))
    : [];
  const maxApy = rows.reduce((m, r) => Math.max(m, r.apy), 0);

  const amount = rawToNum(amountRaw, market.decimals);
  const yearly = headline !== undefined && amount > 0 ? (amount * headline) / 100 : undefined;
  const marketSupply = stats ? rawToNum(stats.supply, market.decimals) : undefined;
  const shareOfMarket =
    marketSupply !== undefined && amount > 0 ? (amount / (marketSupply + amount)) * 100 : undefined;

  return (
    <div className="space-y-3">
      {/* ---------- 头部：一个主数字 ---------- */}
      <div className="flex items-start justify-between gap-3">
        <span className="pt-1 text-slate-500">Supply APY</span>
        <div className="text-right">
          <div className="text-2xl font-bold text-emerald-600">
            {headline === undefined ? (
              <span className="text-slate-400">--</span>
            ) : (
              <>
                ~<CountUp value={headline} decimals={2} suffix="%" />
              </>
            )}
          </div>
          <div className="text-[11px] font-medium text-slate-400">
            {headline === undefined
              ? "checking on-chain rate preset…"
              : headlineIsModel
                ? `projected (assumes ${PROJECTED_UTIL_PCT}% utilization)`
                : "current — real on-chain APR"}
          </div>
        </div>
      </div>

      {/* ---------- 预设不匹配 / 未确认 ---------- */}
      {preset !== undefined && !normal && (
        <div className="rounded-lg bg-amber-50 px-3 py-2 text-[11px] leading-relaxed text-amber-800 ring-1 ring-amber-200">
          <span className="font-semibold">
            The interest-rate model is currently {PRESET_NAME[preset] ?? `preset ${preset}`}.
          </span>{" "}
          This preview only models the NORMAL curve, so the modelled figures below are hidden
          rather than shown wrong. The on-chain APR above is unaffected.
        </div>
      )}

      {/* ---------- 资金从哪来 ---------- */}
      <div className="rounded-lg bg-slate-100/70 px-3 py-2">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
          Where the yield comes from
        </div>
        <div className="mt-1 flex justify-between text-xs">
          <span className="text-slate-600">Borrower interest</span>
          <span className="text-slate-800">
            {(share * 100).toFixed(1)}% to depositors
          </span>
        </div>
        <div className="flex justify-between text-[11px] text-slate-500">
          <span>Protocol cut</span>
          <span>{((1 - share) * 100).toFixed(1)}% (reserve + treasury)</span>
        </div>
        <div className="mt-1 text-[10px] text-slate-400">
          Depositor share read on-chain (1 − reserveFactor − treasuryFactor).
        </div>
      </div>

      {/* ---------- 不同利用率下的 APY ---------- */}
      {rows.length > 0 && (
        <div>
          <div className="flex items-baseline justify-between">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              APY vs utilization
            </span>
            <span className="text-[10px] text-slate-400">now {utilPct.toFixed(2)}%</span>
          </div>
          <table className="mt-1 w-full text-xs">
            <tbody>
              {rows.map((r) => (
                <tr key={r.util} className="border-t border-slate-200/60 first:border-t-0">
                  <td className="w-12 py-1 text-slate-500">{r.util}%</td>
                  <td className="py-1 pr-2">
                    <span
                      className="block h-1.5 rounded-full bg-emerald-500/70"
                      style={{ width: `${maxApy > 0 ? Math.max(2, (r.apy / maxApy) * 100) : 0}%` }}
                    />
                  </td>
                  <td className="w-16 py-1 text-right font-medium text-slate-800">
                    {r.apy.toFixed(2)}%
                  </td>
                  <td className="w-16 py-1 text-right text-[10px] text-slate-400">
                    {r.note === "assumption"
                      ? "assumed"
                      : r.note === "kink1"
                        ? "kink 1"
                        : r.note === "kink2"
                          ? "kink 2"
                          : r.note === "max"
                            ? "max"
                            : ""}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-1 text-[10px] leading-relaxed text-slate-400">
            Modelled from the on-chain NORMAL curve using the tier-1 borrow rate as the market&apos;s
            average rate. The contract instead weights live tier rates by actual borrows, and
            returns exactly 0 while nothing is borrowed — so treat these as scenarios, not quotes.
          </p>
        </div>
      )}

      {/* ---------- 按输入金额的收益估算 ---------- */}
      <div className="border-t border-slate-200/70 pt-3">
        {amount > 0 && yearly !== undefined ? (
          <div className="space-y-0.5 text-sm">
            <div className="flex justify-between">
              <span className="text-slate-500">On {formatAmount(amount, 2)} {market.symbol}</span>
              <span className="font-semibold text-emerald-600">
                ~{formatAmount(yearly, 2)} {market.symbol}/yr
              </span>
            </div>
            <div className="flex justify-between text-xs text-slate-500">
              <span>≈ per month</span>
              <span>{formatAmount(yearly / 12, 2)} {market.symbol}</span>
            </div>
            {shareOfMarket !== undefined && (
              <div className="flex justify-between text-xs text-slate-500">
                <span>Your share of the {market.symbol} market</span>
                <span>{shareOfMarket.toFixed(2)}%</span>
              </div>
            )}
            <div className="text-[10px] text-slate-400">
              Earnings move with utilization — the rate is variable and not principal-guaranteed.
            </div>
          </div>
        ) : (
          <p className="text-xs text-slate-400">
            Enter an amount to see projected yearly earnings.
          </p>
        )}
      </div>
    </div>
  );
}
