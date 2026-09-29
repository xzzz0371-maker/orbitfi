import { createConfig, http, fallback } from "wagmi";
import { type CreateConnectorFn } from "wagmi";
import { injected, walletConnect } from "wagmi/connectors";
import { base } from "./lib/chain";
import { RPC_URL, WC_PROJECT_ID } from "./lib/config";

// WalletConnect requires a project id. Without NEXT_PUBLIC_WC_PROJECT_ID only the
// injected connector (MetaMask / browser wallet) is enabled.
const connectors: CreateConnectorFn[] = [injected({ shimDisconnect: true })];
if (WC_PROJECT_ID) {
  connectors.push(walletConnect({ projectId: WC_PROJECT_ID, showQrModal: true }));
}

export const wagmiConfig = createConfig({
  chains: [base],
  connectors,
  transports: {
    // Ordered by measured reliability, not by brand. Under the burst of concurrent reads a
    // page mount produces, mainnet.base.org (Base's own public endpoint) rejected 38 of 48
    // requests while publicnode and drpc rejected none. Because a single rejected price read
    // trips the fail-closed banner, the flaky endpoint is kept only as a last resort - it is
    // still used if both healthy endpoints go down, but no request waits on it by default.
    // `batch` also coalesces the calls viem would otherwise issue one by one.
    [base.id]: fallback(
      [
        http(RPC_URL, { batch: true, retryCount: 2, retryDelay: 150 }),
        http("https://base.drpc.org", { batch: true, retryCount: 2, retryDelay: 150 }),
        http("https://mainnet.base.org", { batch: true, retryCount: 2, retryDelay: 150 }),
      ],
      { rank: false },
    ),
  },
});

export type AppConnector = (typeof connectors)[number];
