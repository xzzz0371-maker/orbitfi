"use client";

import { useState } from "react";
import { type Address } from "viem";
import { useAccount, useWriteContract } from "wagmi";
import { LendingPoolAbi, MockTokenAbi } from "@/lib/abis";
import { ADDRESSES, MIN_SUPPLY, type MarketInfo } from "@/lib/config";
import { useMarketStats, useUserSharesOf, useTokenBalance, useTokenAllowance, useInvalidateAllOnTxSuccess } from "@/lib/hooks";
import { formatToken, numToRaw, parseAmount } from "@/lib/format";
import { SupplyRatePreview } from "./SupplyRatePreview";
import { TxStatus } from "./TxStatus";

export function SupplyTab({ market }: { market: MarketInfo }) {
  const { address } = useAccount();
  const [amount, setAmount] = useState("");
  const { stats } = useMarketStats(market.id);
  const shares = useUserSharesOf(address as Address, market.id);
  const balance = useTokenBalance(market.address as Address, address as Address);
  const { allowance } = useTokenAllowance(
    market.address as Address,
    address as Address,
    ADDRESSES.lendingPool as Address,
  );

  // 以字符串解析（parseUnits），避免浮点在 18 位精度下的误差
  const raw = parseAmount(amount, market.decimals) ?? 0n;
  const needApproval = raw > 0n && allowance < raw;

  const { data: hash, isPending, isSuccess, writeContract } = useWriteContract();
  useInvalidateAllOnTxSuccess(isSuccess);

  const supplyAprPct = stats ? (Number(stats.supplyApr) / 1e18) * 100 : undefined;
  const utilPct = stats ? (Number(stats.utilization) / 1e18) * 100 : 0;
  const minRaw = numToRaw(MIN_SUPPLY, market.decimals);
  const valid = raw >= minRaw && raw <= balance;
  const shareValue = stats && stats.supplyIndex > 0n ? (shares * stats.supplyIndex) / BigInt(1e18) : 0n;

  const utilAfter =
    stats && Number(stats.cash) + Number(raw) + Number(stats.borrows) > 0
      ? (Number(stats.borrows) / (Number(stats.cash) + Number(raw) + Number(stats.borrows))) * 100
      : 0;

  return (
    <div className="space-y-4">
      <div className="rounded-lg bg-danger/10 px-3 py-2 text-xs text-danger">
        OrbitFi is a transparent, non-custodial lending protocol. Depositors earn a share of
        borrower interest, with 94% of interest passed back to depositors. Rates are variable and
        deposits are not principal-guaranteed. Please read the full Risk Disclosure before
        depositing.
      </div>
      <div>
        <label className="label">Amount ({market.symbol})</label>
        <input
          type="number"
          min={MIN_SUPPLY}
          className="input"
          placeholder="0.00"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />
        <p className="mt-1 text-xs text-slate-500">
          Minimum {MIN_SUPPLY} {market.symbol} · Available: {formatToken(balance, market.decimals)}{" "}
          {market.symbol}
        </p>
      </div>
      <SupplyRatePreview
        market={market}
        stats={stats}
        currentAprPct={supplyAprPct}
        utilPct={utilPct}
        amountRaw={raw}
      />
      <div className="flex justify-between text-sm">
        <span className="text-slate-500">Utilization (now → after)</span>
        <span className="text-slate-800">
          {utilPct.toFixed(2)}% → {utilAfter.toFixed(2)}%
        </span>
      </div>
      {needApproval ? (
        <button
          className="btn-primary w-full"
          disabled={!address || !valid || isPending}
          onClick={() =>
            writeContract({
              address: market.address as Address,
              abi: MockTokenAbi,
              functionName: "approve",
              // 精确授权：只授权本次金额，避免无限授权扩大攻击面
              args: [ADDRESSES.lendingPool as Address, raw],
            })
          }
        >
          {isPending ? "Approving…" : `Approve ${market.symbol}`}
        </button>
      ) : (
        <button
          className="btn-primary w-full"
          disabled={!address || !valid || isPending}
          onClick={() =>
            writeContract({
              address: ADDRESSES.lendingPool as Address,
              abi: LendingPoolAbi,
              functionName: "supply",
              args: [BigInt(market.id), raw],
            })
          }
        >
          {isPending ? "Supplying…" : "Supply"}
        </button>
      )}
      <TxStatus hash={hash} />
      <div className="border-t border-slate-200/70 pt-3 text-sm">
        <div className="flex justify-between">
          <span className="text-slate-500">Your supply shares</span>
          <span className="text-slate-800">{formatToken(shares, market.decimals)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-slate-500">Current share value</span>
          <span className="text-slate-800">
            {stats ? formatToken(shareValue, market.decimals) : "--"}
          </span>
        </div>
      </div>
    </div>
  );
}
