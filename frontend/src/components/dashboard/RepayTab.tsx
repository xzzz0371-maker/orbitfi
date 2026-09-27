"use client";

import { useState } from "react";
import { type Address } from "viem";
import { useAccount, useWriteContract } from "wagmi";
import { LendingPoolAbi, MockTokenAbi } from "@/lib/abis";
import { ADDRESSES, type MarketInfo } from "@/lib/config";
import { useUserPositionV2, useTokenAllowance, useInvalidateAllOnTxSuccess } from "@/lib/hooks";
import { formatToken, formatHealthFactor, parseAmount, rawToDisplayString } from "@/lib/format";
import { TxStatus } from "./TxStatus";

/// 全额清仓哨兵：`_repayCore` 在链上用「当时」的债务重算，传 uint256.max 可一次清零，
/// 不会因为 UI 读到的债务略旧而残留尾巴（残留会锁住换档）。
const MAX_REPAY = 2n ** 256n - 1n;

export function RepayTab({ market }: { market: MarketInfo }) {
  const { address } = useAccount();
  const [amount, setAmount] = useState("");
  const [useMax, setUseMax] = useState(false);
  const { position } = useUserPositionV2(address as Address);
  const { allowance, refetch: refetchAllowance } = useTokenAllowance(
    market.address as Address,
    address as Address,
    ADDRESSES.lendingPool as Address,
  );

  const { data: hash, isPending, isSuccess, writeContract } = useWriteContract();
  useInvalidateAllOnTxSuccess(isSuccess);

  const debtRaw = position ? position.marketDebt[market.id] ?? 0n : 0n;
  const parsed = parseAmount(amount, market.decimals);
  // 输入超过真实债务时钳制到债务本身
  const raw = parsed === null ? 0n : parsed > debtRaw ? debtRaw : parsed;
  // 授权带 0.1% + 1 token 缓冲：合约按「当时」利息重算债务，UI 读数可能已略低于链上债务，
  // 精确到 wei 的授权会让还款 revert。
  const approveRaw = debtRaw + debtRaw / 100n + 10n ** BigInt(market.decimals);
  const payRaw = useMax ? MAX_REPAY : raw;
  const needApproval = payRaw > 0n && allowance < (useMax ? approveRaw : raw);
  const valid = useMax || raw > 0n;
  const remaining = useMax ? 0n : debtRaw > raw ? debtRaw - raw : 0n;
  const tinyDec = debtRaw < 10n ** BigInt(Math.max(0, market.decimals - 4)) ? 8 : 2;

  return (
    <div className="space-y-4">
      <div>
        <label className="label">Repay amount ({market.symbol})</label>
        <div className="flex gap-2">
          <input
            type="number"
            className="input"
            placeholder="0.00"
            value={amount}
            onChange={(e) => {
              setUseMax(false);
              setAmount(e.target.value);
            }}
          />
          <button
            className="btn-outline whitespace-nowrap"
            onClick={() => {
              setUseMax(true);
              setAmount(rawToDisplayString(debtRaw, market.decimals));
            }}
          >
            Max
          </button>
        </div>
        <p className="mt-1 text-xs text-slate-500">
          Current debt: {formatToken(debtRaw, market.decimals, tinyDec)} {market.symbol}
        </p>
        {useMax && (
          <p className="mt-1 text-xs text-slate-500">
            Repaying the full balance on-chain (the contract clears the whole debt including
            interest accrued up to the block that mines it).
          </p>
        )}
      </div>
      <div className="flex justify-between text-sm">
        <span className="text-slate-500">Remaining debt after</span>
        <span className="text-slate-800">
          {formatToken(remaining, market.decimals, tinyDec)} {market.symbol}
        </span>
      </div>
      <div className="flex justify-between text-sm">
        <span className="text-slate-500">Health Factor</span>
        <span className="text-slate-800">
          {position && position.healthFactor > 0n ? formatHealthFactor(position.healthFactor) : "--"}
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
              // 精确授权（含利息增长缓冲），不用 MAX_UINT
              args: [ADDRESSES.lendingPool as Address, approveRaw],
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
              functionName: "repay",
              args: [BigInt(market.id), payRaw],
            })
          }
        >
          {isPending ? "Repaying…" : "Repay"}
        </button>
      )}
      <TxStatus hash={hash} />
      <div className="border-t border-slate-200/70 pt-3 text-sm">
        <div className="flex justify-between">
          <span className="text-slate-500">Accrued interest included</span>
          <span className="text-slate-800">Yes (in debt)</span>
        </div>
        <button
          className="mt-1 text-xs text-accent hover:underline"
          onClick={() => refetchAllowance()}
        >
          Refresh allowance
        </button>
      </div>
    </div>
  );
}
