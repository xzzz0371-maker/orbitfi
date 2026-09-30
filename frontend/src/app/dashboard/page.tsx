"use client";

import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { type Address } from "viem";
import { useAccount } from "wagmi";
import { BORROW_MARKETS, COLLATERALS } from "@/lib/config";
import { useUserPositionV2, useAssetPrices } from "@/lib/hooks";
import { PositionPanel } from "@/components/dashboard/PositionPanel";
import { SupplyTab } from "@/components/dashboard/SupplyTab";
import { WithdrawTab } from "@/components/dashboard/WithdrawTab";
import { BorrowTab } from "@/components/dashboard/BorrowTab";
import { RepayTab } from "@/components/dashboard/RepayTab";
import { CollateralTab } from "@/components/dashboard/CollateralTab";
import { TreasuryPanel } from "@/components/dashboard/TreasuryPanel";

const TABS = ["Supply", "Withdraw", "Borrow", "Repay", "Collateral", "Treasury"] as const;

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
  const { prices, ready: pricesReady, loading: pricesLoading } = useAssetPrices(allTokens);

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

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold text-slate-900">Dashboard</h1>
          <p className="text-sm text-slate-500">
            Choose a borrow market, then supply / borrow / repay. Manage collateral below.
          </p>
        </div>
      </div>

      {!pricesReady && pricesLoading && (
        <div className="rounded-xl bg-slate-100 px-4 py-3 text-sm text-slate-600 ring-1 ring-slate-200">
          Reading live prices from the on-chain oracle…
        </div>
      )}

      {!pricesReady && !pricesLoading && (
        <div className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700 ring-1 ring-red-200">
          <span className="font-semibold">Price feed unavailable.</span> The on-chain oracle read
          failed (oracle paused, feed stale, the contract address is not configured, or the RPC
          request failed). Collateral values, LTV and Health Factor cannot be shown, and
          price-dependent actions are disabled. Do not act on the numbers below.
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
            {tab === 4 && (
              <CollateralTab prices={prices} pricesReady={pricesReady} pricesLoading={pricesLoading} />
            )}
            {tab === 5 && <TreasuryPanel market={market} />}
          </div>
        </div>
      </div>
    </div>
  );
}
