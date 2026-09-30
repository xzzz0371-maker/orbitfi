import type { Metadata } from "next";
import "./globals.css";
import { Providers } from "@/providers";
import { NavBar } from "@/components/NavBar";
import { Footer } from "@/components/Footer";

export const metadata: Metadata = {
  // Open Graph / Twitter cards resolve og:image against this base. Without it they
  // fall back to http://localhost:3000, which no crawler can fetch.
  // ⚠️ 换自有域名后改这里 —— 这又是一个「域名硬编码点」（见 docs/钱包安全警告排查-MetaMask.md）。
  metadataBase: new URL("https://orbitfi.pages.dev"),
  title: "OrbitFi — Risk-Layered DeFi Lending",
  description:
    "Choose your risk tier, borrow against ETH, and earn on USDC. Estimated yields, no fixed income promises.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Space+Grotesk:wght@500;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        <Providers>
          <NavBar />
          <main className="fade-in mx-auto min-h-[72vh] max-w-6xl px-4 py-8">{children}</main>
          <Footer />
        </Providers>
      </body>
    </html>
  );
}
