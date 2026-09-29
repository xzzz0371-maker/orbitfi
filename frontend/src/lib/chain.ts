import { defineChain } from "viem";

// Multicall3 is deployed at the same address on every major chain. viem only knows this
// automatically for the chains it ships itself; because Base is defined by hand here, the
// address has to be declared explicitly - without it any multicall() / wagmi
// useReadContracts() call fails with:
//   Chain "Base" does not support contract "multicall3".
// That single omission is what made every price read fail on the dashboard.
const MULTICALL3 = "0xcA11bde05977b3631167028862bE2a173976CA11" as const;

export const base = defineChain({
  id: 8453,
  name: "Base",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: {
    // Kept in sync with RPC_URL's default. Nothing in the app reads through this (the wagmi
    // transport in src/config.ts always takes precedence), but leaving mainnet.base.org here
    // would advertise the one endpoint measured to reject most burst reads.
    default: {
      http: ["https://base-rpc.publicnode.com"],
    },
  },
  blockExplorers: {
    default: { name: "Basescan", url: "https://basescan.org" },
  },
  contracts: {
    multicall3: { address: MULTICALL3 },
  },
  testnet: false,
});

// Historical testnet chain (kept for reference; the app targets Base mainnet).
export const sepolia = defineChain({
  id: 11155111,
  name: "Sepolia",
  nativeCurrency: { name: "Sepolia Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: {
    default: {
      http: ["https://ethereum-sepolia-rpc.publicnode.com"],
    },
  },
  blockExplorers: {
    default: { name: "Etherscan", url: "https://sepolia.etherscan.io" },
  },
  testnet: true,
});
