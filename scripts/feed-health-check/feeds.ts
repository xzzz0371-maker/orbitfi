// OrbitFi — Base (chainId 8453) Chainlink feed registry for health checks.
// Addresses are from docs.chain.link/data-feeds/price-feeds/addresses (Base) and
// verified on-chain 2026-09-03. Confirm against data.chain.link before mainnet.
import type { Address } from "viem";

export interface FeedEntry {
  symbol: string;
  description: string; // expected description() return
  proxy: Address;
  decimals: number; // expected decimals()
  heartbeatSec: number; // documented heartbeat (deviation-based feeds may update slower)
}

export const FEEDS: FeedEntry[] = [
  { symbol: "ETH/USD", description: "ETH / USD", proxy: "0x50015f8b17fb2C290Dde41fDc246ed0dcEE93a8b", decimals: 8, heartbeatSec: 86400 },
  { symbol: "USDC/USD", description: "USDC / USD", proxy: "0x7e860098F58bBFC8648a4311b374B1D669a2bc6B", decimals: 8, heartbeatSec: 86400 },
  { symbol: "USDT/USD", description: "USDT / USD", proxy: "0xf19d560eB8d2ADf07BD6D13ed03e1D11215721F9", decimals: 8, heartbeatSec: 86400 },
  { symbol: "DAI/USD", description: "DAI / USD", proxy: "0x591e79239a7d679378eC8c847e5038150364C78F", decimals: 8, heartbeatSec: 86400 },
  { symbol: "cbBTC/USD", description: "cbBTC / USD", proxy: "0x07DA0E54543a844a80ABE69c8A12F22B3aA59f9D", decimals: 8, heartbeatSec: 86400 },
];
