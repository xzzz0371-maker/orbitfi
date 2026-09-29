// NORMAL preset interest-rate model (estimated; matches contracts InterestRateModel NORMAL, three-segment).
const BASE = 2.0;
const SLOPE1 = 3; // 0..KINK1
export const KINK1 = 90.5; // 对标 Aave v3 Base 的 90.5% 最优利用率
const SLOPE2A = 40; // KINK1..KINK2
export const KINK2 = 95;
const SLOPE2 = 150; // > KINK2
const PREMIUM: Record<number, number> = { 1: 0, 2: 0.5, 3: 1, 4: 1.5, 5: 2.5 };

/// 合约 InterestRateModel.MarketPreset 枚举。
/// ⚠️ 上面这组常量只对应 NORMAL。治理 applyPreset() 切到另外两套后，
/// 本文件推出的任何数字都与链上曲线不符 —— 页面必须先读链上 activePreset 再决定要不要展示
/// （见 useIrmPreset）。已实测链上当前 = 0/NORMAL，kink 与斜率和这里逐条一致。
export const PRESET_NORMAL = 0;
export const PRESET_HIGH_VOLATILITY = 1;
export const PRESET_EXTREME = 2;

/// 存款人分成 = 1 − reserveFactor − treasuryFactor（链上当前 1 − 4% − 2% = 94%）。
/// 这只是默认值：费率是 PARAM_ADMIN 可改的，所以页面应当优先传链上读到的真实值
/// （useDepositorShare），否则治理一改费率，所有展示的存款 APY 就全错了。
export const DEFAULT_DEPOSITOR_SHARE = 0.94;

export function borrowAprAt(utilPct: number, tier: number): number {
  let r = BASE;
  if (utilPct <= KINK1) r += (SLOPE1 * utilPct) / 100;
  else if (utilPct <= KINK2)
    r += (SLOPE1 * KINK1) / 100 + (SLOPE2A * (utilPct - KINK1)) / 100;
  else
    r +=
      (SLOPE1 * KINK1) / 100 +
      (SLOPE2A * (KINK2 - KINK1)) / 100 +
      (SLOPE2 * (utilPct - KINK2)) / 100;
  return r + (PREMIUM[tier] ?? 0);
}

export function supplyAprAt(
  utilPct: number,
  avgBorrowRatePct: number,
  depositorShare = DEFAULT_DEPOSITOR_SHARE,
): number {
  return avgBorrowRatePct * (utilPct / 100) * depositorShare;
}

/// 存款侧 APY 随利用率变化：用 tier-1 借款利率当作该市场"平均借款利率"的代理。
/// 链上 _getSupplyAPR 是按各档**实际借款额**加权，且完全没有借款时严格等于 0，
/// 所以这里是**模型值不是报价** —— 展示时必须标明假设。
export function supplyAprAtUtil(utilPct: number, depositorShare = DEFAULT_DEPOSITOR_SHARE): number {
  return supplyAprAt(utilPct, borrowAprAt(utilPct, 1), depositorShare);
}

// Projected supply APY: assumes a fixed utilization (80%) and the depositor share.
export const PROJECTED_UTIL_PCT = 80;
export function projectedSupplyApyPct(depositorShare = DEFAULT_DEPOSITOR_SHARE): number {
  return supplyAprAtUtil(PROJECTED_UTIL_PCT, depositorShare);
}

/// 存款预览表用的利用率采样点：低 / 中 / 假设点 / 两个拐点 / 满。
/// note 只用于给表格加标注，不参与计算。
export const UTIL_PREVIEW_POINTS: { util: number; note?: "assumption" | "kink1" | "kink2" | "max" }[] = [
  { util: 25 },
  { util: 50 },
  { util: PROJECTED_UTIL_PCT, note: "assumption" },
  { util: KINK1, note: "kink1" },
  { util: KINK2, note: "kink2" },
  { util: 100, note: "max" },
];

// Upper bound for borrow APR display at a defined high utilization.
export function borrowAprUpperPct(tier: number, highUtilPct = 90): number {
  return borrowAprAt(highUtilPct, tier);
}
