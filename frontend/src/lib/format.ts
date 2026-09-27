// Number / address formatting helpers (USDC 6-dec, ETH 18-dec, WAD 1e18).

import { parseUnits } from "viem";

const POW10 = (dec: number): bigint => 10n ** BigInt(dec);

export function rawToNum(raw: bigint | undefined | null, decimals = 6): number {
  if (raw === undefined || raw === null) return 0;
  return Number(raw) / Number(POW10(decimals));
}

/// 把用户输入的十进制字符串解析为原始单位 bigint；非法输入或 ≤0 返回 null。
/// 新增：替代 numToRaw 的浮点路径（`Math.floor(n * 10**decimals)` 在 18 位精度下
/// 会有 1 wei 级误差，且无法表达超过 2^53 的精确值）。
export function parseAmount(input: string, decimals = 6): bigint | null {
  const s = input.trim();
  if (!s) return null;
  try {
    const v = parseUnits(s, decimals);
    return v > 0n ? v : null;
  } catch {
    return null; // 非法字符 / 小数位超出精度
  }
}

/// @deprecated 仅用于纯展示常量。金额解析请用 parseAmount(input, decimals)。
export function numToRaw(n: number, decimals = 6): bigint {
  if (!isFinite(n) || n <= 0) return 0n;
  return BigInt(Math.floor(n * Number(POW10(decimals))));
}

// Convert a raw token amount to an exact decimal string (no float loss) for inputs like "Max".
export function rawToDisplayString(raw: bigint, decimals = 6): string {
  const d = POW10(decimals);
  const int = raw / d;
  const frac = (raw % d).toString().padStart(decimals, "0");
  return frac === "0".repeat(decimals) ? int.toString() : `${int}.${frac}`;
}

export function formatToken(raw: bigint | number | undefined | null, decimals = 6, dec = 2): string {
  if (raw === undefined || raw === null) return "--";
  return formatAmount(Number(raw) / Number(POW10(decimals)), dec);
}

export function formatUsd(n: number, dec = 2): string {
  if (!isFinite(n)) return "--";
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: dec, maximumFractionDigits: dec })}`;
}

export function formatUsdc(raw: bigint | number | undefined | null, decimals = 2): string {
  if (raw === undefined || raw === null) return "--";
  const n = Number(raw) / 1e6;
  return formatAmount(n, decimals);
}

export function formatEth(raw: bigint | number | undefined | null, decimals = 4): string {
  if (raw === undefined || raw === null) return "--";
  const n = Number(raw) / 1e18;
  return formatAmount(n, decimals);
}

export function formatWadPct(raw: bigint | number | undefined | null, decimals = 2): string {
  if (raw === undefined || raw === null) return "--";
  const n = (Number(raw) / 1e18) * 100;
  return `${formatAmount(n, decimals)}%`;
}

export function formatWad(raw: bigint | number | undefined | null, decimals = 2): string {
  if (raw === undefined || raw === null) return "--";
  return formatAmount(Number(raw) / 1e18, decimals);
}

export function formatAmount(n: number, decimals = 2): string {
  if (!isFinite(n)) return "--";
  return n.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

// Format an APY value (already in % per year) with a leading "~".
export function formatApy(pct: number | undefined | null, decimals = 2): string {
  if (pct === undefined || pct === null || !isFinite(pct)) return "~--%";
  return `~${formatAmount(pct, decimals)}%`;
}

export function truncateAddress(addr: string | undefined): string {
  if (!addr) return "";
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

// HF > 1e30 WAD（≈无债务）视为 "∞"，避免 uint256::max 转 number 后显示天文数字。
const HF_INFINITY_BIG = 10n ** 30n;

export function formatHealthFactor(hf: bigint | number | undefined | null): string {
  if (hf === undefined || hf === null) return "--";
  const n = Number(hf) / 1e18;
  if (n === Number.MAX_SAFE_INTEGER || (typeof hf === "bigint" && hf >= HF_INFINITY_BIG)) return "∞";
  return formatAmount(n, 2);
}

// Color-coded HF helper.
export function hfTone(hf: bigint | number | undefined | null): "success" | "warning" | "danger" {
  if (hf === undefined || hf === null) return "danger";
  const n = Number(hf) / 1e18;
  if (!isFinite(n) || n >= 1.5) return "success";
  if (n >= 1) return "warning";
  return "danger";
}
