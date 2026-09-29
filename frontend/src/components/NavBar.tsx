"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ConnectButton } from "./ConnectButton";

const links = [
  { href: "/", label: "Home" },
  { href: "/dashboard", label: "Dashboard" },
  { href: "/stress-test", label: "Stress Test" },
  { href: "/history", label: "History" },
  { href: "/about", label: "About" },
];

export function NavBar() {
  const pathname = usePathname();
  return (
    <header className="sticky top-0 z-30 border-b border-slate-200/60 bg-white/60 backdrop-blur-xl">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3">
        <Link href="/" className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-br from-accent to-blue-600 text-sm font-bold text-white shadow-lg shadow-accent/30">
            Z
          </span>
          <span className="font-display text-lg font-bold text-slate-900">OrbitFi</span>
        </Link>
        <nav className="hidden items-center gap-1 md:flex">
          {links.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className={`rounded-xl px-3 py-1.5 text-sm font-medium transition-colors ${
                pathname === l.href
                  ? "bg-white text-accent shadow-sm"
                  : "text-slate-500 hover:text-slate-800"
              }`}
            >
              {l.label}
            </Link>
          ))}
        </nav>
        <div className="flex items-center gap-3">
          <span className="pill bg-emerald-50 text-emerald-600 ring-1 ring-emerald-200 hidden sm:inline-flex">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
            Base Mainnet
          </span>
          <ConnectButton />
        </div>
      </div>
      <nav className="flex items-center gap-1 overflow-x-auto px-4 pb-2 md:hidden">
        {links.map((l) => (
          <Link
            key={l.href}
            href={l.href}
            className={`whitespace-nowrap rounded-xl px-3 py-1.5 text-sm font-medium ${
              pathname === l.href ? "bg-white text-accent shadow-sm" : "text-slate-500"
            }`}
          >
            {l.label}
          </Link>
        ))}
      </nav>
    </header>
  );
}
