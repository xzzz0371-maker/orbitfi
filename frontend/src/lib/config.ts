import deploymentsRaw from "./deployments/base.json";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const deployments = deploymentsRaw as any;

// Base mainnet (chainId 8453). Contract addresses are filled into
// deployments/base.json after real deployment; empty = not yet deployed.
export const CHAIN_ID = 8453;
export const ETH_ADDRESS = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";
// ⚠️ 以下两个常量已停用，保留仅为兼容历史引用：
// - MAX_UINT：原用于 approve(MAX_UINT) 无限授权，现全部改为按本次金额精确授权。
// - TX_GAS：原给所有写交易硬编码 gas 上限，会绕过钱包估算并在市场数增长后有 OOG 风险；
//           现已移除 writeContract 的 gas 字段，交由钱包估算（EIP-1559 只按实际用量收费）。
export const MAX_UINT =
  115792089237316195423570985008687907853269984665640564039457584007913129639935n;
export const TX_GAS = 1_000_000n;

// 唯一价格源。主网由 DeployMainnet 部署的是 ChainlinkOracle（脚本明确「不部署 SwitchableOracle」）；
// 测试网历史部署可能只有 switchableOracle，故按此优先级回落。
// ⚠️ 任何组件都不得再直接引用 ADDRESSES.switchableOracle 作为价格源。
const rawPriceOracle: string = deployments.oracle || deployments.switchableOracle || "";
export const PRICE_ORACLE = rawPriceOracle;
export const PRICE_ORACLE_READY = /^0x[0-9a-fA-F]{40}$/.test(rawPriceOracle);

export const ADDRESSES = {
  lendingPool: deployments.lendingPool,
  // ↓ 价格源唯一入口
  priceOracle: rawPriceOracle,
  usdc: deployments.usdc,
  usdt: deployments.usdt,
  dai: deployments.dai,
  cbbtc: deployments.cbbtc,
  wsteth: deployments.wsteth,
  wbtc: deployments.wbtc,
  switchableOracle: deployments.switchableOracle,
  chainlinkOracle: deployments.oracle,
  interestRateModel: deployments.interestRateModel,
  riskManager: deployments.riskManager,
  liquidationManager: deployments.liquidationManager,
  reserveManager: deployments.reserveManager,
  riskEngine: deployments.riskEngine,
};

export const RPC_URL =
  process.env.NEXT_PUBLIC_RPC_URL ?? "https://mainnet.base.org";

export const ETHERSCAN_URL = "https://basescan.org";

// WalletConnect project id (optional). Set NEXT_PUBLIC_WC_PROJECT_ID to enable WalletConnect.
export const WC_PROJECT_ID = process.env.NEXT_PUBLIC_WC_PROJECT_ID;

// 已移除 FALLBACK_ETH_PRICE。
// 原实现在预言机读价失败时静默回落到硬编码的 $2506，会让 UI 展示的 LTV / Health Factor
// 与链上真实值不一致，误导用户在错误的时点加仓或减仓。价格读不到时必须显式报错并禁用
// 依赖价格的操作（fail-closed），不允许猜价。
export const USDC_DECIMALS = 6;
export const ETH_DECIMALS = 18;
export const WAD = 1_000_000_000_000_000_000n;

// Minimum amounts enforced by the protocol (also enforced in the UI).
export const MIN_SUPPLY = 10;
export const MIN_BORROW = 100;
export const MIN_COLLATERAL = 0.01;

// Choose Your Risk tiers: max LTV % and liquidation threshold %.
export const TIERS = [
  { tier: 1, ltv: 50, lt: 60, label: "Tier 1 · LTV 50%", risk: "Low" },
  { tier: 2, ltv: 60, lt: 70, label: "Tier 2 · LTV 60%", risk: "Medium" },
  { tier: 3, ltv: 70, lt: 78, label: "Tier 3 · LTV 70%", risk: "High" },
  { tier: 4, ltv: 75, lt: 85, label: "Tier 4 · LTV 75%", risk: "Very High" },
  { tier: 5, ltv: 80, lt: 90, label: "Tier 5 · LTV 80%", risk: "Extreme" },
];

export const RISK_COLOR: Record<string, string> = {
  Low: "#22c55e",
  Medium: "#eab308",
  High: "#f97316",
  "Very High": "#ef4444",
  Extreme: "#b91c1c",
};

// ==================== V2 multi-asset ====================

export interface MarketInfo {
  id: number;
  symbol: string;
  name: string;
  address: string;
  decimals: number;
  stable: boolean;
}

export interface CollateralInfo {
  id: number;
  symbol: string;
  name: string;
  address: string;
  decimals: number;
  native: boolean; // native ETH
}

// Borrow markets (order = pool marketId; 0 = USDC default).
export const BORROW_MARKETS: MarketInfo[] = [
  { id: 0, symbol: "USDC", name: "USD Coin", address: deployments.usdc, decimals: 6, stable: true },
  { id: 1, symbol: "USDT", name: "Tether USD", address: deployments.usdt, decimals: 6, stable: true },
  { id: 2, symbol: "DAI", name: "Dai Stablecoin", address: deployments.dai, decimals: 18, stable: true },
];

// Collateral assets (order = pool collateral id; 0 = native ETH). Base V1: ETH + cbBTC
// (wstETH disabled on Base — no official wstETH/USD feed; WBTC replaced by cbBTC).
export const COLLATERALS: CollateralInfo[] = [
  { id: 0, symbol: "ETH", name: "Ether", address: ETH_ADDRESS, decimals: 18, native: true },
  { id: 1, symbol: "cbBTC", name: "Coinbase Wrapped BTC", address: deployments.cbbtc, decimals: 8, native: false },
];

export const ETH = ETH_ADDRESS;
export const SCALE = 1_000_000_000_000_000_000n; // 1e18 (WAD)

// Per-collateral LTV / liquidation thresholds (mirrors RiskManager V2).
// tiers 1..5 → maxLTV % and liquidation threshold %.
// ⚠️ 以下两表为「展示用快照」，当前值与链上 RiskManager 构造/部署时设的档位一致。
// 它们不是权威来源：治理一旦通过 RiskManager.setTier 改档，这里就会失真。
// 待办（未做，优先级低于上线门禁）：改为从 RiskManager.getMaxLTV /
// getLiquidationThreshold 链上读取，并在读不到时禁用借款。
export const COLLATERAL_TIER_LTV: Record<string, number[]> = {
  ETH: [50, 60, 70, 75, 80],
  cbBTC: [45, 55, 65, 70, 75],
};
export const COLLATERAL_TIER_LT: Record<string, number[]> = {
  ETH: [60, 70, 78, 85, 90],
  cbBTC: [55, 65, 75, 80, 85],
};

export const MIN_COLLATERAL_TOKENS = 0.01; // whole tokens
