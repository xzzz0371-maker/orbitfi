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
    // Multiple endpoints behind a fallback: a single public RPC intermittently returns
    // "RPC Request failed." under the burst of reads a dashboard mount produces, which
    // surfaces as the whole price panel going unavailable. `batch` also coalesces the
    // calls viem would otherwise issue one by one.
    [base.id]: fallback(
      [
        http(RPC_URL, { batch: true, retryCount: 2, retryDelay: 150 }),
        http("https://base-rpc.publicnode.com", { batch: true, retryCount: 2, retryDelay: 150 }),
        http("https://base.drpc.org", { batch: true, retryCount: 2, retryDelay: 150 }),
      ],
      { rank: false },
    ),
  },
});

export type AppConnector = (typeof connectors)[number];
