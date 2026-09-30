"use client";

import { type Address } from "viem";
import { useAccount, useReadContract, useWriteContract } from "wagmi";
import { LendingPoolAbi } from "@/lib/abis";
import { ADDRESSES, type MarketInfo } from "@/lib/config";
import { useMarketStats } from "@/lib/hooks";
import { formatToken, truncateAddress } from "@/lib/format";
import { TxStatus } from "./TxStatus";

/// 协议方收益提取面板。
///
/// 只有 treasury 那 2% 是协议方的钱，进 `treasuryAddress`（= Safe 多签）。
/// reserve 那 4% 是坏账缓冲金，不是收益，不在这里提取。
/// collectTreasury(marketId) 是 permissionless 的——任何人都能触发，但钱只会打到
/// treasuryAddress，所以这里任何人都能点「提取」，只是通常只有协议方会去做。
export function TreasuryPanel({ market }: { market: MarketInfo }) {
  const { address } = useAccount();
  const { stats } = useMarketStats(market.id);

  const { data: treasuryAddress } = useReadContract({
    address: ADDRESSES.lendingPool as Address,
    abi: LendingPoolAbi,
    functionName: "treasuryAddress",
    query: { refetchInterval: 60_000 },
  });

  const { data: hash, isPending, isSuccess, writeContract } = useWriteContract();

  const accrued = stats?.treasury ?? 0n;
  const accruedNum = formatToken(accrued, market.decimals, 2);
  const isYou =
    typeof address === "string" &&
    typeof treasuryAddress === "string" &&
    address.toLowerCase() === (treasuryAddress as string).toLowerCase();

  return (
    <div className="space-y-3">
      <div className="rounded-lg bg-sky-50 px-3 py-2 text-xs text-sky-700 ring-1 ring-sky-200">
        The protocol&apos;s share of borrower interest (2% treasury fee). It accrues in{" "}
        {market.symbol} and is collected to the protocol treasury — the Safe multisig.
        The 4% reserve fee is a separate bad-debt buffer and is not withdrawable here.
      </div>

      <div className="flex items-center justify-between">
        <span className="text-slate-500">Accrued treasury ({market.symbol})</span>
        <span className="font-display text-2xl font-bold text-slate-900">{accruedNum}</span>
      </div>

      <div className="flex justify-between text-xs text-slate-500">
        <span>Recipient (treasury)</span>
        <span className="font-mono text-slate-700">
          {treasuryAddress ? truncateAddress(treasuryAddress as string) : "--"}
        </span>
      </div>

      {!isYou && (
        <p className="text-[11px] text-slate-400">
          You are not the treasury address — this action is normally taken by the protocol
          operator, but the function is permissionless and always sends to the treasury.
        </p>
      )}

      <button
        className="btn-primary w-full"
        disabled={accrued === 0n || isPending}
        onClick={() =>
          writeContract({
            address: ADDRESSES.lendingPool as Address,
            abi: LendingPoolAbi,
            functionName: "collectTreasury",
            args: [BigInt(market.id)],
          })
        }
      >
        {isPending
          ? "Collecting…"
          : accrued === 0n
            ? "Nothing to collect"
            : `Collect ${accruedNum} ${market.symbol}`}
      </button>
      <TxStatus hash={hash} />
      {isSuccess && <p className="text-xs text-emerald-600">✓ Treasury collected to the multisig.</p>}
    </div>
  );
}
