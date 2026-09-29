"use client";

import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useReadContract, useReadContracts } from "wagmi";
import { type Address } from "viem";
import { LendingPoolAbi, PriceOracleAbi } from "./abis";
import { ADDRESSES, ETH_ADDRESS, PRICE_ORACLE, PRICE_ORACLE_READY } from "./config";
import { TIERS } from "./config";

const pool = { address: ADDRESSES.lendingPool as Address, abi: LendingPoolAbi } as const;

/// 交易成功后立即失效并重拉全部链上查询（余额/份额/市场），无需等轮询。
export function useInvalidateAllOnTxSuccess(isSuccess: boolean | undefined) {
  const qc = useQueryClient();
  useEffect(() => {
    if (isSuccess) qc.invalidateQueries();
  }, [isSuccess, qc]);
}

export interface PoolStats {
  totalSupply: bigint;
  totalBorrows: bigint;
  utilization: bigint;
  supplyApr: bigint;
  cash: bigint;
  totalReserve: bigint;
  treasuryAccrued: bigint;
  totalShares: bigint;
  supplyIndex: bigint;
}

export function usePoolStats() {
  const { data, isPending, isError } = useReadContracts({
    contracts: [
      { ...pool, functionName: "getTotalSupply" },
      { ...pool, functionName: "getTotalBorrows" },
      { ...pool, functionName: "getUtilization" },
      { ...pool, functionName: "getSupplyAPR" },
      { ...pool, functionName: "cash" },
      { ...pool, functionName: "totalReserve" },
      { ...pool, functionName: "treasuryAccrued" },
      { ...pool, functionName: "totalShares" },
      { ...pool, functionName: "supplyIndex" },
    ],
    query: { refetchInterval: 6_000, refetchIntervalInBackground: true },
  });

  const d = data as unknown as Array<{ result?: bigint }> | undefined;
  const stats: PoolStats | undefined = d
    ? {
        totalSupply: d[0]?.result ?? 0n,
        totalBorrows: d[1]?.result ?? 0n,
        utilization: d[2]?.result ?? 0n,
        supplyApr: d[3]?.result ?? 0n,
        cash: d[4]?.result ?? 0n,
        totalReserve: d[5]?.result ?? 0n,
        treasuryAccrued: d[6]?.result ?? 0n,
        totalShares: d[7]?.result ?? 0n,
        supplyIndex: d[8]?.result ?? 0n,
      }
    : undefined;

  return { stats, isPending, isError };
}

export function useBorrowAprs() {
  const { data } = useReadContracts({
    contracts: TIERS.map((t) => ({
      ...pool,
      functionName: "getBorrowAPR",
      args: [BigInt(t.tier)],
    })),
    query: { refetchInterval: 6_000, refetchIntervalInBackground: true },
  });
  const d = data as unknown as Array<{ result?: bigint }> | undefined;
  // getBorrowAPR returns WAD per year → convert to %.
  const aprs: Record<number, number> = {};
  if (d) {
    TIERS.forEach((t, i) => {
      aprs[t.tier] = (Number(d[i]?.result ?? 0n) / 1e18) * 100;
    });
  }
  return aprs;
}

export interface UserPosition {
  shares: bigint;
  collateral: bigint;
  debt: bigint; // WAD USD
  collateralValue: bigint; // WAD USD
  healthFactor: bigint;
  tier: bigint;
  liquidatable: boolean;
}

export function useUserPosition(user: Address | undefined) {
  const { data, refetch } = useReadContract({
    ...pool,
    functionName: "getUserPosition",
    args: user ? [user] : undefined,
    query: { enabled: !!user, refetchInterval: 6_000, refetchIntervalInBackground: true },
  });
  const d = data as unknown as
    | [bigint, bigint, bigint, bigint, bigint, bigint, boolean]
    | undefined;
  const position: UserPosition | undefined = d
    ? {
        shares: d[0],
        collateral: d[1],
        debt: d[2],
        collateralValue: d[3],
        healthFactor: d[4],
        tier: d[5],
        liquidatable: d[6],
      }
    : undefined;
  return { position, refetch };
}

export function useMaxBorrowable(user: Address | undefined, tier: number) {
  const { data } = useReadContract({
    ...pool,
    functionName: "maxBorrowable",
    args: user && tier ? [user, BigInt(tier)] : undefined,
    query: { enabled: !!user && !!tier, refetchInterval: 6_000, refetchIntervalInBackground: true },
  });
  return (data as bigint | undefined) ?? 0n;
}

export interface Prices {
  /// undefined = 价格不可用（地址未配置 / feed 陈旧 / oracle 暂停）。此时禁止参与任何计算。
  ethUsd: number | undefined;
  usdcUsd: number | undefined;
  /// 已确定读不到价：地址没配、oracle 暂停、feed 陈旧、或请求真的失败了。
  unavailable: boolean;
  /// 首次读取仍在途中：还没有结果，但也还没有失败。
  /// 必须与 unavailable 区分开——否则每次打开页面都会先闪一条红色的"价格不可用"，
  /// 把"请求还没回来"当成"读不到"来报警。
  loading: boolean;
}

// 从唯一价格源（主网 = ChainlinkOracle）读价。读不到就返回 undefined，绝不回落硬编码价。
export function usePrices(): Prices {
  const enabled = PRICE_ORACLE_READY;
  const { data: ethRaw, isPending: ethPending } = useReadContract({
    address: PRICE_ORACLE as Address,
    abi: PriceOracleAbi,
    functionName: "getAssetPrice",
    args: [ETH_ADDRESS as Address],
    query: { enabled, refetchInterval: 30_000, refetchIntervalInBackground: true, retry: false },
  });
  const { data: usdcRaw, isPending: usdcPending } = useReadContract({
    address: PRICE_ORACLE as Address,
    abi: PriceOracleAbi,
    functionName: "getAssetPrice",
    args: [ADDRESSES.usdc as Address],
    query: { enabled, refetchInterval: 30_000, refetchIntervalInBackground: true, retry: false },
  });
  const ethUsd = ethRaw != null && ethRaw > 0n ? Number(ethRaw) / 1e8 : undefined;
  const usdcUsd = usdcRaw != null && usdcRaw > 0n ? Number(usdcRaw) / 1e8 : undefined;
  const missing = ethUsd === undefined || usdcUsd === undefined;
  // enabled=false 时 wagmi 的 isPending 会一直为 true，那不是"加载中"而是"没配地址"，
  // 所以必须用 enabled 兜住，否则地址缺失会被永久当成加载中、错误提示永远不出现。
  const loading = enabled && missing && (ethPending || usdcPending);
  return { ethUsd, usdcUsd, loading, unavailable: missing && !loading };
}

export function useUsdcBalance(user: Address | undefined) {
  const { data } = useReadContract({
    address: ADDRESSES.usdc as Address,
    abi: [
      {
        type: "function",
        name: "balanceOf",
        stateMutability: "view",
        inputs: [{ type: "address", name: "owner" }],
        outputs: [{ type: "uint256", name: "balance" }],
      },
    ],
    functionName: "balanceOf",
    args: user ? [user] : undefined,
    query: { enabled: !!user, refetchInterval: 6_000, refetchIntervalInBackground: true },
  });
  return data as bigint | undefined;
}

export function useUsdcAllowance(owner: Address | undefined, spender: Address | undefined) {
  const { data, refetch } = useReadContract({
    address: ADDRESSES.usdc as Address,
    abi: [
      {
        type: "function",
        name: "allowance",
        stateMutability: "view",
        inputs: [{ type: "address", name: "owner" }, { type: "address", name: "spender" }],
        outputs: [{ type: "uint256", name: "" }],
      },
    ],
    functionName: "allowance",
    args: owner && spender ? [owner, spender] : undefined,
    query: { enabled: !!owner && !!spender, refetchInterval: 6_000, refetchIntervalInBackground: true },
  });
  return { allowance: (data as bigint | undefined) ?? 0n, refetch };
}

// ==================== V2 multi-asset hooks ====================

export interface MarketStats {
  supply: bigint;
  borrows: bigint;
  utilization: bigint;
  supplyApr: bigint;
  cash: bigint;
  reserve: bigint;
  treasury: bigint;
  supplyIndex: bigint;
}

export function useMarketStats(marketId: number) {
  const { data, isPending, isError } = useReadContracts({
    contracts: [
      { ...pool, functionName: "marketAccounts", args: [BigInt(marketId)] },
      { ...pool, functionName: "marketUtilization", args: [BigInt(marketId)] },
      { ...pool, functionName: "marketSupplyAPR", args: [BigInt(marketId)] },
    ],
    query: { refetchInterval: 6_000, refetchIntervalInBackground: true },
  });
  const d = data as unknown as Array<{ result?: unknown }> | undefined;
  const acc = d?.[0]?.result as [bigint, bigint, bigint, bigint, bigint, bigint] | undefined;
  const stats: MarketStats | undefined = acc
    ? {
        cash: acc[0],
        borrows: acc[1],
        supply: acc[2],
        reserve: acc[3],
        treasury: acc[4],
        supplyIndex: acc[5],
        utilization: (d?.[1]?.result as bigint) ?? 0n,
        supplyApr: (d?.[2]?.result as bigint) ?? 0n,
      }
    : undefined;
  return { stats, isPending, isError };
}

export function useMarketBorrowAprs(marketId: number) {
  const { data } = useReadContracts({
    contracts: TIERS.map((t) => ({
      ...pool,
      functionName: "marketBorrowAPR",
      args: [BigInt(marketId), BigInt(t.tier)],
    })),
    query: { refetchInterval: 6_000, refetchIntervalInBackground: true },
  });
  const d = data as unknown as Array<{ result?: bigint }> | undefined;
  const aprs: Record<number, number> = {};
  if (d) {
    TIERS.forEach((t, i) => {
      aprs[t.tier] = (Number(d[i]?.result ?? 0n) / 1e18) * 100;
    });
  }
  return aprs;
}

export function useUserSharesOf(user: Address | undefined, marketId: number) {
  const { data } = useReadContract({
    ...pool,
    functionName: "userSharesOf",
    args: user ? [user, BigInt(marketId)] : undefined,
    query: { enabled: !!user, refetchInterval: 6_000, refetchIntervalInBackground: true },
  });
  return (data as bigint | undefined) ?? 0n;
}

// Reads USD price (8-decimals → float) for a list of asset addresses.
// ready=false 表示不能对外展示这些价（地址未配置，或任一资产取不到有效价）→ 调用方必须 fail-closed。
// loading=true 表示首次读取还在途中，调用方应显示中性占位而不是报错。
export function useAssetPrices(
  addresses: string[],
): { prices: Record<string, number>; ready: boolean; loading: boolean } {
  const { data, isPending } = useReadContracts({
    contracts: addresses.map((a) => ({
      address: PRICE_ORACLE as Address,
      abi: PriceOracleAbi,
      functionName: "getAssetPrice",
      args: [a as Address],
    })),
    query: { enabled: PRICE_ORACLE_READY, refetchInterval: 30_000, refetchIntervalInBackground: true, retry: false },
  });
  const d = data as unknown as Array<{ result?: bigint }> | undefined;
  const out: Record<string, number> = {};
  if (d) {
    addresses.forEach((a, i) => {
      const raw = d[i]?.result;
      if (raw != null && raw > 0n) out[a] = Number(raw) / 1e8;
    });
  }
  const ready = PRICE_ORACLE_READY && addresses.length > 0 && addresses.every((a) => out[a] !== undefined);
  const loading = !ready && PRICE_ORACLE_READY && addresses.length > 0 && isPending;
  return { prices: out, ready, loading };
}

export interface PositionV2 {
  debtWad: bigint;
  collateralValueWad: bigint;
  healthFactor: bigint;
  liquidatable: boolean;
  tier: bigint;
  collateral: Record<number, bigint>;
  marketDebt: Record<number, bigint>;
}

export function useUserPositionV2(user: Address | undefined) {
  const addresses = user ? [user] : undefined;
  const { data, refetch } = useReadContracts({
    contracts: [
      { ...pool, functionName: "getUserPositionV2", args: addresses },
      { ...pool, functionName: "userGlobalTier", args: addresses },
      { ...pool, functionName: "userCollateralOf", args: user ? [user, 0n] : undefined },
      { ...pool, functionName: "userCollateralOf", args: user ? [user, 1n] : undefined },
      { ...pool, functionName: "userCollateralOf", args: user ? [user, 2n] : undefined },
      { ...pool, functionName: "userDebtToken", args: user ? [user, 0n] : undefined },
      { ...pool, functionName: "userDebtToken", args: user ? [user, 1n] : undefined },
      { ...pool, functionName: "userDebtToken", args: user ? [user, 2n] : undefined },
    ],
    query: { enabled: !!user, refetchInterval: 6_000, refetchIntervalInBackground: true },
  });
  const d = data as unknown as Array<{ result?: unknown }> | undefined;
  const g = d?.[0]?.result as [bigint, bigint, bigint, boolean] | undefined;
  const pos: PositionV2 | undefined = user && d
    ? {
        debtWad: g?.[0] ?? 0n,
        collateralValueWad: g?.[1] ?? 0n,
        healthFactor: g?.[2] ?? 0n,
        liquidatable: g?.[3] ?? false,
        tier: (d[1]?.result as bigint) ?? 0n,
        collateral: {
          0: (d[2]?.result as bigint) ?? 0n,
          1: (d[3]?.result as bigint) ?? 0n,
          2: (d[4]?.result as bigint) ?? 0n,
        },
        marketDebt: {
          0: (d[5]?.result as bigint) ?? 0n,
          1: (d[6]?.result as bigint) ?? 0n,
          2: (d[7]?.result as bigint) ?? 0n,
        },
      }
    : undefined;
  return { position: pos, refetch };
}

// Generic ERC20 balance / allowance (also used for ETH native below).
const erc20ViewAbi = [
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ type: "address", name: "owner" }],
    outputs: [{ type: "uint256", name: "balance" }],
  },
  {
    type: "function",
    name: "allowance",
    stateMutability: "view",
    inputs: [{ type: "address", name: "owner" }, { type: "address", name: "spender" }],
    outputs: [{ type: "uint256", name: "" }],
  },
] as const;

export function useTokenBalance(token: Address | undefined, user: Address | undefined) {
  const { data } = useReadContract({
    address: token,
    abi: erc20ViewAbi,
    functionName: "balanceOf",
    args: user ? [user] : undefined,
    query: { enabled: !!user && !!token, refetchInterval: 6_000, refetchIntervalInBackground: true },
  });
  return (data as bigint | undefined) ?? 0n;
}

export function useTokenAllowance(token: Address | undefined, user: Address | undefined, spender: Address | undefined) {
  const { data, refetch } = useReadContract({
    address: token,
    abi: erc20ViewAbi,
    functionName: "allowance",
    args: user && spender ? [user, spender] : undefined,
    query: { enabled: !!user && !!spender && !!token, refetchInterval: 6_000, refetchIntervalInBackground: true },
  });
  return { allowance: (data as bigint | undefined) ?? 0n, refetch };
}
