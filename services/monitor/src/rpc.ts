import { createPublicClient, http, type PublicClient, type Address, type Abi } from "viem";
import fs from "node:fs";
import path from "node:path";

export interface ChainConfig {
  rpcUrl: string;
  deploymentsJson: string;
}

export interface Deployments {
  lendingPool: Address;
  reserveManager: Address;
  oracle: Address;
  [k: string]: unknown;
}

let _client: PublicClient | null = null;
let _abiCache = new Map<string, Abi>();

export function init(cfg: ChainConfig): void {
  _client = createPublicClient({ transport: http(cfg.rpcUrl) });
}

export function client(): PublicClient {
  if (!_client) throw new Error("monitor not initialized");
  return _client;
}

export function loadDeployments(jsonPath: string): Deployments {
  const abs = path.resolve(jsonPath);
  return JSON.parse(fs.readFileSync(abs, "utf8")) as Deployments;
}

/**
 * 本包内的默认部署记录路径。
 * 基于包自身位置解析（services/monitor/src → repo root），**不依赖 CWD**。
 * 原实现用 CWD 相对路径 `../frontend/...`，从 services/monitor 运行时会被解析成
 * `services/frontend/...` 而报 ENOENT —— 这是原来 monitor 的默认配置 bug。
 */
export function defaultDeploymentsPath(): string {
  return path.resolve(
    import.meta.dirname,
    "..",
    "..",
    "..",
    "frontend",
    "src",
    "lib",
    "deployments",
    "base.json",
  );
}

/** 解析部署记录路径：显式传入的相对路径按 CWD 解析；未传入时用包内默认（不依赖 CWD）。 */
export function resolveDeploymentsPath(p: string | undefined): string {
  return p ? path.resolve(p) : defaultDeploymentsPath();
}

/** Load a contract ABI from the repo frontend abis snapshot. */
export function abiFor(name: "LendingPool" | "ChainlinkOracle" | "ReserveManager"): Abi {
  const cached = _abiCache.get(name);
  if (cached) return cached;
  const file = path.resolve(import.meta.dirname, "../../../frontend/src/lib/abis", `${name}.json`);
  const abi = JSON.parse(fs.readFileSync(file, "utf8")) as Abi;
  _abiCache.set(name, abi);
  return abi;
}

/** Safe view read returning null on revert (e.g. stale feed). */
export async function tryRead(
  address: Address,
  abi: Abi,
  fn: string,
  args: unknown[]
): Promise<unknown | null> {
  try {
    return await _client!.readContract({ address, abi, functionName: fn, args });
  } catch {
    return null;
  }
}
