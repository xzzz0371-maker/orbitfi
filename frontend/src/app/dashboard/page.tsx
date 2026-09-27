"use client";

import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { type Address } from "viem";
import { useAccount, useWriteContract } from "wagmi";
import { MockTokenAbi } from "@/lib/abis";
import { ADDRESSES, BORROW_MARKETS, COLLATERALS } from "@/lib/config";
import { useUserPositionV2, useAssetPrices, useInvalidateAllOnTxSuccess } from "@/lib/hooks";
import { numToRaw } from "@/lib/format";
import { PositionPanel } from "@/components/dashboard/PositionPanel";
import { SupplyTab } from "@/components/dashboard/SupplyTab";
import { WithdrawTab } from "@/components/dashboard/WithdrawTab";
import { BorrowTab } from "@/components/dashboard/BorrowTab";
import { RepayTab } from "@/components/dashboard/RepayTab";
import { CollateralTab } from "@/components/dashboard/CollateralTab";
import { TxStatus } from "@/components/dashboard/TxStatus";

const TABS = ["Supply", "Withdraw", "Borrow", "Repay", "Collateral"] as const;

export default function DashboardPage() {
  return (
    <Suspense fallback={<div className="card p-6 text-sm text-slate-500">Loading…</div>}>
      <DashboardInner />
    </Suspense>
  );
}

function DashboardInner() {
  const { address, isConnected } = useAccount();
  const params = useSearchParams();
  const initialTier = Math.min(Math.max(Number(params.get("tier") ?? 1), 1), 5);
  const [tab, setTab] = useState<number>(params.get("tab") === "borrow" ? 2 : 0);
  const [marketId, setMarketId] = useState<number>(0);
  const market = BORROW_MARKETS.find((m) => m.id === marketId) ?? BORROW_MARKETS[0];
  const { position } = useUserPositionV2(address as Address);
  const allTokens = [...COLLATERALS.map((c) => c.address), ...BORROW_MARKETS.map((m) => m.address)];
  const { prices, ready: pricesReady } = useAssetPrices(allTokens);
  const { data: faucetHash, isPending: faucetPending, isSuccess: faucetSuccess, writeContract: faucet } = useWriteContract();
  useInvalidateAllOnTxSuccess(faucetSuccess);

  if (!isConnected) {
    return (
      <div className="card mx-auto max-w-md p-10 text-center">
        <h1 className="font-display text-2xl font-bold text-slate-800">Connect your wallet</h1>
        <p className="mt-2 text-sm text-slate-500">
          Connect to Base mainnet to supply, borrow, withdraw and repay.
        </p>
      </div>
    );
  }

  const faucetRaw = numToRaw(10_000, market.decimals);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold text-slate-900">Dashboard</h1>
          <p className="text-sm text-slate-500">
            Choose a borrow market, then supply / borrow / repay. Manage collateral below.
          </p>
        </div>
        <button
          className="btn-outline text-xs"
          disabled={faucetPending}
          onClick={() =>
            faucet({
              address: market.address as Address,
              abi: MockTokenAbi,
              functionName: "faucet",
              args: [faucetRaw],
            })
          }
        >
          {faucetPending ? "Minting…" : `Get Test ${market.symbol} (10,000)`}
        </button>
      </div>
      <TxStatus hash={faucetHash} />

      {!pricesReady && (
        <div className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700 ring-1 ring-red-200">
          <span className="font-semibold">Price feed unavailable.</span> The on-chain oracle read
          failed (oracle paused, feed stale, or the contract address is not configured). Collateral
          values, LTV and Health Factor cannot be shown, and price-dependent actions are disabled.
          Do not act on the numbers below.
        </div>
      )}

      {/* Market selector */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold text-slate-600">Borrow market:</span>
        {BORROW_MARKETS.map((m) => (
          <button
            key={m.id}
            onClick={() => setMarketId(m.id)}
            className={`rounded-xl border px-3 py-1.5 text-sm font-semibold transition-colors ${
              marketId === m.id
                ? "border-accent bg-accent/10 text-accent"
                : "border-slate-200/70 text-slate-500 hover:border-accent"
            }`}
          >
            {m.symbol}
          </button>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-5">
        <div className="lg:col-span-2">
          <PositionPanel position={position} prices={prices} pricesReady={pricesReady} />
        </div>
        <div className="lg:col-span-3">
          <div className="card p-6">
            <div className="mb-5 flex rounded-xl bg-slate-200/50 p-1">
              {TABS.map((t, i) => (
                <button
                  key={t}
                  onClick={() => setTab(i)}
                  className={`flex-1 rounded-lg px-2 py-2 text-sm font-semibold transition-all ${
                    tab === i ? "bg-white text-accent shadow-sm" : "text-slate-500 hover:text-slate-800"
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>
            {tab === 0 && <SupplyTab key={market.id} market={market} />}
            {tab === 1 && <WithdrawTab key={market.id} market={market} />}
            {tab === 2 && <BorrowTab key={market.id} market={market} initialTier={initialTier} />}
            {tab === 3 && <RepayTab key={market.id} market={market} />}
            {tab === 4 && <CollateralTab prices={prices} pricesReady={pricesReady} />}
          </div>
        </div>
      </div>
    </div>
  );
}
