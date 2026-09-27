"use client";

import { useState } from "react";
import { type Address } from "viem";
import { useAccount, useWriteContract } from "wagmi";
import { LendingPoolAbi } from "@/lib/abis";
import { ADDRESSES, MIN_BORROW, TIERS, COLLATERALS, COLLATERAL_TIER_LTV, COLLATERAL_TIER_LT, type MarketInfo } from "@/lib/config";
import { useUserPositionV2, useMarketStats, useMarketBorrowAprs, useAssetPrices, useInvalidateAllOnTxSuccess } from "@/lib/hooks";
import { formatToken, formatHealthFactor, numToRaw, parseAmount, rawToNum } from "@/lib/format";
import { borrowAprAt, borrowAprUpperPct } from "@/lib/rates";
import { TxStatus } from "./TxStatus";

export function BorrowTab({ market, initialTier }: { market: MarketInfo; initialTier: number }) {
  const { address } = useAccount();
  const [tier, setTier] = useState(initialTier);
  const [amount, setAmount] = useState("");
  const { position } = useUserPositionV2(address as Address);
  const { stats } = useMarketStats(market.id);
  const borrowAprs = useMarketBorrowAprs(market.id);
  const collTokens = COLLATERALS.map((c) => c.address);
  const { prices, ready: pricesReady } = useAssetPrices([...collTokens, market.address]);

  const { data: hash, isPending, isSuccess, writeContract } = useWriteContract();
  useInvalidateAllOnTxSuccess(isSuccess);

  const cfg = TIERS.find((t) => t.tier === tier)!;
  const collBalances = COLLATERALS.map((c) =>
    position ? rawToNum(position.collateral[c.id] ?? 0n, c.decimals) : 0,
  );
  const collValues = collBalances.map((bal, i) => bal * (prices[COLLATERALS[i].address] ?? 0));
  const collValueUsd = collValues.reduce((a, b) => a + b, 0);
  // Contract: capacity = Σ value_i × maxLTV(coll_i, tier)
  const capacityUsd = collValues.reduce(
    (sum, val, i) => sum + val * (COLLATERAL_TIER_LTV[COLLATERALS[i].symbol][tier - 1] / 100),
    0,
  );
  // Contract HF numerator = Σ value_i × LT(coll_i, tier)
  const weightedLtUsd = collValues.reduce(
    (sum, val, i) => sum + val * (COLLATERAL_TIER_LT[COLLATERALS[i].symbol][tier - 1] / 100),
    0,
  );

  // 以字符串解析（parseUnits）得到提交给合约的金额
  const raw = parseAmount(amount, market.decimals) ?? 0n;
  // 以下浮点仅用于展示估算；合约会按链上真实价重新校验
  const amountNum = raw === 0n ? 0 : Number(raw) / 10 ** market.decimals;
  const marketPrice = prices[market.address] ?? 0;
  const debtUsd = position ? Number(position.debtWad) / 1e18 : 0;
  const amountUsd = amountNum * marketPrice;
  const newDebtUsd = debtUsd + amountUsd;
  // 价格不可用时不给可借上限，避免用猜的价给出错误额度
  const maxRaw =
    pricesReady && marketPrice > 0 && capacityUsd > debtUsd
      ? numToRaw((capacityUsd - debtUsd) / marketPrice, market.decimals)
      : 0n;
  const minBorrowRaw = numToRaw(MIN_BORROW, market.decimals);

  const projLtv = collValueUsd > 0 ? (newDebtUsd / collValueUsd) * 100 : 0;
  const projHf = weightedLtUsd > 0 && newDebtUsd > 0 ? weightedLtUsd / newDebtUsd : 0;
  const projHfBig = projHf > 0 ? BigInt(Math.floor(projHf * 1e18)) : 0n;

  const tierLocked = position && position.tier > 0n && Number(position.tier) !== tier;
  const valid =
    pricesReady && raw >= minBorrowRaw && raw <= maxRaw && !tierLocked && collValueUsd > 0;

  const borrowApr = borrowAprs[tier];
  const utilPct = stats ? (Number(stats.utilization) / 1e18) * 100 : 0;
  // 模型区间：当前利用率 ±10% 下的利率范围（不是历史 7 日区间）
  const utilLowPct = Math.max(0, utilPct - 10);
  const utilHighPct = Math.min(100, utilPct + 10);
  const rangeLow = borrowAprAt(utilLowPct, tier);
  const rangeHigh = borrowAprAt(utilHighPct, tier);
  const pricesUnavailable = !pricesReady;

  return (
    <div className="space-y-4">
      <div className="rounded-lg bg-warning/10 px-3 py-2 text-xs text-warning">
        Positions with Health Factor below 1.0 may be liquidated by third parties. Liquidation is a
        core mechanism that protects the protocol and all depositors. Monitor your position health
        regularly.
      </div>

      {/* Tier selector */}
      <div>
        <label className="label">Choose your risk tier</label>
        <div className="grid grid-cols-5 gap-1">
          {TIERS.map((t) => (
            <button
              key={t.tier}
              onClick={() => setTier(t.tier)}
              className={`rounded-lg border px-1 py-2 text-center text-xs ${
                tier === t.tier
                  ? "border-accent bg-accent/10 text-white"
                  : "border-slate-200/70 text-slate-500 hover:border-accent"
              }`}
            >
              {t.ltv}%
            </button>
          ))}
        </div>
        <p className="mt-1 text-xs text-slate-500">
          {cfg.label} · Higher LTV = greater capital efficiency, but higher liquidation risk and
          higher interest rates. Select a tier aligned with your risk tolerance. LTV/LT limits are
          applied per collateral asset (cbBTC uses a conservative table).
        </p>
        <p className="mt-1 text-xs font-semibold text-slate-700">
          Selected {cfg.ltv}% LTV → max borrowable: {formatToken(maxRaw, market.decimals)}{" "}
          {market.symbol}
        </p>
      </div>

      {tierLocked && (
        <p className="text-xs text-danger">
          You already borrowed at tier {Number(position?.tier)}. Repay in full to switch tiers.
        </p>
      )}

      <div>
        <label className="label">Borrow amount ({market.symbol})</label>
        <input
          type="number"
          className="input"
          placeholder="0.00"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />
        <p className="mt-1 text-xs text-slate-500">
          Min {MIN_BORROW} {market.symbol} · Max borrowable: {formatToken(maxRaw, market.decimals)}{" "}
          {market.symbol}
        </p>
        {collValueUsd > 0 && maxRaw > 0n && maxRaw < numToRaw(MIN_BORROW, market.decimals) && (
          <p className="mt-1 text-xs text-danger">
            Collateral too low — max borrowable is below the {MIN_BORROW} {market.symbol} minimum.
            Add more collateral, or pick a higher LTV tier (50/60/70/75/80) if that still isn't
            enough.
          </p>
        )}
      </div>

      <div className="rounded-lg bg-sky-50 px-3 py-2 text-xs text-sky-700 ring-1 ring-sky-200">
        Interest rates are variable and adjust in real time with pool utilization. Your actual
        borrowing cost may differ from the rate shown at the time of borrowing. Choose your risk
        tier carefully.
      </div>

      <div className="space-y-1 text-sm">
        <div className="flex justify-between">
          <span className="text-slate-500">Borrow APR · Tier {tier}</span>
          <span className="font-semibold text-slate-800">
            {borrowApr !== undefined ? `~${borrowApr.toFixed(2)}%` : "--"} now · up to ~
            {borrowAprUpperPct(tier).toFixed(1)}% at high utilization
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-slate-500">
            Rate range · utilization {utilLowPct.toFixed(0)}–{utilHighPct.toFixed(0)}%
          </span>
          <span className="text-slate-800">
            {rangeLow.toFixed(2)}% – {rangeHigh.toFixed(2)}%
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-slate-500">Utilization ({market.symbol})</span>
          <span className="text-slate-800">{utilPct.toFixed(2)}%</span>
        </div>
        <p className="pt-1 text-[11px] text-slate-400">
          Rates are variable and adjust with pool utilization. "Up to" assumes ~90% utilization;
          the rate range is the current model evaluated at util ±10% — not historical data.
        </p>
        <div className="flex justify-between">
          <span className="text-slate-500">Collateral value (all)</span>
          <span className="text-slate-800">${collValueUsd.toLocaleString("en-US", { maximumFractionDigits: 2 })}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-slate-500">Max borrowable (weighted LTV)</span>
          <span className="text-slate-800">
            {formatToken(maxRaw, market.decimals)} {market.symbol}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-slate-500">LTV after borrow</span>
          <span className={projLtv > cfg.ltv ? "text-danger" : "text-slate-800"}>
            {projLtv.toFixed(2)}%
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-slate-500">Health Factor after</span>
          <span className="text-slate-800">{formatHealthFactor(projHfBig)}</span>
        </div>
      </div>

      {address && !valid && !isPending && (
        <p className="text-xs text-danger">
          {pricesUnavailable
            ? "Price unavailable (oracle paused / feed stale / address not configured) — borrowing is disabled rather than guessing a price."
            : tierLocked
              ? `You are already borrowing at tier ${Number(position?.tier)} — repay in full to switch tiers.`
              : collValueUsd <= 0
                ? "No collateral — deposit ETH/cbBTC in the Collateral tab first."
                : raw < minBorrowRaw
                  ? `Enter an amount of at least ${MIN_BORROW} ${market.symbol}.`
                  : raw > maxRaw
                    ? `Amount exceeds max borrowable (${formatToken(maxRaw, market.decimals)} ${market.symbol}).`
                    : maxRaw > 0n && maxRaw < minBorrowRaw
                      ? `Max borrowable (${formatToken(maxRaw, market.decimals)} ${market.symbol}) is below the ${MIN_BORROW} ${market.symbol} minimum — add collateral or choose a higher LTV tier.`
                      : "Check your inputs."}
        </p>
      )}

      <button
        className="btn-primary w-full"
        disabled={!address || !valid || isPending}
        onClick={() =>
          writeContract({
            address: ADDRESSES.lendingPool as Address,
            abi: LendingPoolAbi,
            functionName: "borrow",
            args: [BigInt(market.id), raw, BigInt(tier)],
          })
        }
      >
        {isPending ? "Borrowing…" : `Borrow ${market.symbol}`}
      </button>
      <TxStatus hash={hash} />
    </div>
  );
}
