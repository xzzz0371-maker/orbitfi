import { ADDRESSES, ETHERSCAN_URL } from "@/lib/config";

export function Footer() {
  return (
    <footer className="mt-12 border-t border-slate-200/60 bg-white/40 backdrop-blur-xl">
      <div className="mx-auto grid max-w-6xl gap-8 px-4 py-10 md:grid-cols-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="flex h-6 w-6 items-center justify-center rounded-md bg-gradient-to-br from-accent to-blue-600 text-xs font-bold text-white">
              Z
            </span>
            <span className="font-display text-sm font-bold text-slate-800">ZZZ Lend</span>
          </div>
          <p className="mt-3 text-xs leading-relaxed text-slate-500">
            Risk-layered DeFi lending on Base. Transparent mechanics: 94% of borrower interest
            is passed directly to depositors. Deposits are not guaranteed — principal may decrease
            due to bad debt, like a fund whose NAV can decline.
          </p>
        </div>
        <div>
          <h4 className="text-xs font-bold uppercase tracking-wide text-slate-500">Protocol</h4>
          <ul className="mt-3 space-y-2 text-sm text-slate-600">
            <li>
              <a className="hover:text-accent" href={`${ETHERSCAN_URL}/address/${ADDRESSES.lendingPool}`} target="_blank" rel="noreferrer">
                LendingPool
              </a>
            </li>
            <li>
              <a className="hover:text-accent" href={`${ETHERSCAN_URL}/address/${ADDRESSES.usdc}`} target="_blank" rel="noreferrer">
                USDC
              </a>
            </li>
            <li>
              <a className="hover:text-accent" href={`${ETHERSCAN_URL}/address/${ADDRESSES.priceOracle}`} target="_blank" rel="noreferrer">
                Oracle
              </a>
            </li>
          </ul>
        </div>
        <div>
          <h4 className="text-xs font-bold uppercase tracking-wide text-slate-500">Status</h4>
          <ul className="mt-3 space-y-2 text-sm text-slate-600">
            <li>Chain: Base (mainnet)</li>
            <li>Version: 1.2.0</li>
            <li>Audit: Security review completed, pending third-party audit</li>
          </ul>
          <p className="mt-4 text-xs text-slate-500">
            All displayed APY/APR figures are projections based on current market data. Nothing on
            this site constitutes financial advice. Cryptographic assets involve risk; only
            participate with funds you can afford to lose.
          </p>
        </div>
      </div>
    </footer>
  );
}
