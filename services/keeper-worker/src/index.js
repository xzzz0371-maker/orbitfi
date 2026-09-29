/**
 * OrbitFi — 偏差基准 keeper（Cloudflare Worker + Cron Trigger）
 *
 * 为什么需要它
 * ------------
 * ChainlinkOracle 的偏差保护比较的是「最新价 vs lastValidPrice」，而 lastValidPrice
 * **只在 updatePrice() 且判定为非异常时才写入**。部署脚本只初始化一次。没有周期调用的话：
 *
 *     基准停在部署那一刻 → 价格漂移 → 超过 maxDeviation（当前 20%）
 *     → 之后每次 updatePrice 都被判为 anomalous
 *     → 而 anomalous 时又不会更新 lastValidPrice      ← 自锁，无法自愈
 *     → priceAnomalous[asset] 永久为 true
 *
 * 而 priceAnomalous 为 true 时 LendingPool 会 require(!_oracleAnomalous())，
 * 结果是**新增抵押品与借新债全部被拒**（存入/提取/还款不受影响，资金不会被困死）。
 * 最麻烦的是前端读 getAssetPrice 照样拿得到价格，UI 上看不出任何异常 ——
 * 用户只会看到借款交易莫名 revert。
 *
 * 权限
 * ----
 * updatePrice(address) 是 **permissionless** 的：任何地址都能调用。
 * 所以这里用的私钥**只需要一点 Base gas，不需要任何协议角色**。
 * 请用专用一次性热钱包，**绝不要复用 PARAM_ADMIN / PAUSER 的密钥**。
 *
 * 成本（2026-09-29 实测）
 * -----------------------
 * 单轮 5 个资产 = 329,734 gas；Base base fee 稳定在 0.005 gwei
 * → 约 0.0000020 ETH/轮 ≈ $0.0055；每小时一次 ≈ $0.13/天 ≈ $3.95/月。
 * 0.01 ETH 大约够跑 200 天。
 */

import {
  createPublicClient,
  createWalletClient,
  http,
  defineChain,
  parseAbi,
  formatEther,
  formatGwei,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

const base = defineChain({
  id: 8453,
  name: "Base",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: ["https://base-rpc.publicnode.com"] } },
  testnet: false,
});

const RPC_DEFAULT = "https://base-rpc.publicnode.com";
/// 主网 ChainlinkOracle（来源 frontend/src/lib/deployments/base.json 的 oracle）
const ORACLE_DEFAULT = "0x1964A89320110B8f171CD737448C754c5aF768d7";

/// 与 services/monitor/config/positions.json 的 markets + collaterals 保持一致。
/// 新增市场/抵押品时**两处都要改**（Worker 里不好读文件，所以这里内嵌一份）。
const ASSETS_DEFAULT = [
  { symbol: "USDC", token: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" },
  { symbol: "USDT", token: "0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2" },
  { symbol: "DAI", token: "0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb" },
  { symbol: "ETH", token: "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE" },
  { symbol: "cbBTC", token: "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf" },
];

const ORACLE_ABI = parseAbi([
  "function updatePrice(address asset) returns (uint256)",
  "function paused() view returns (bool)",
  "function maxDeviation() view returns (uint256)",
  "function lastValidPrice(address asset) view returns (uint256)",
  "function priceAnomalous(address asset) view returns (bool)",
]);

/// 低于这个余额就在日志里喊一声 —— 热钱包跑干了 keeper 会静默停掉，自锁风险就回来了。
const LOW_BALANCE_WEI = 300_000_000_000_000n; // 0.0003 ETH ≈ 7 天

const GAS_FALLBACK = 120_000n; // 实测 64k–70k，留足余量
const PRIORITY_FEE_WEI = 1_000_000n; // 0.001 gwei，够被 Base 排序器收录

function assetsFromEnv(env) {
  if (!env.ASSETS_JSON) return ASSETS_DEFAULT;
  try {
    const parsed = JSON.parse(env.ASSETS_JSON);
    if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    throw new Error("ASSETS_JSON must be a non-empty array");
  } catch (e) {
    throw new Error(`ASSETS_JSON is not usable (${e.message}); falling back is unsafe, refusing to run`);
  }
}

async function runKeeper(env) {
  const startedAt = new Date().toISOString();

  const privateKey = env.KEEPER_PRIVATE_KEY;
  if (!privateKey) {
    // 不是抛错而是明确返回 —— 否则每次 cron 都刷一条红错误，掩盖真正的问题
    return {
      ok: false,
      skipped: "KEEPER_PRIVATE_KEY is not set. Run: wrangler secret bulk <file> -c services/keeper-worker/wrangler.toml",
      startedAt,
    };
  }
  if (!/^0x[0-9a-fA-F]{64}$/.test(privateKey)) {
    return { ok: false, skipped: "KEEPER_PRIVATE_KEY is not a 32-byte hex private key", startedAt };
  }

  const rpcUrl = env.RPC_URL || RPC_DEFAULT;
  const oracle = (env.ORACLE_ADDRESS || ORACLE_DEFAULT);
  const account = privateKeyToAccount(privateKey);
  const transport = http(rpcUrl, { retryCount: 2, retryDelay: 150 });
  const pub = createPublicClient({ chain: base, transport });
  const wallet = createWalletClient({ account, chain: base, transport });

  const balance = await pub.getBalance({ address: account.address });
  const lowBalance = balance < LOW_BALANCE_WEI;

  const [paused, maxDeviation, gasPrice] = await Promise.all([
    pub.readContract({ address: oracle, abi: ORACLE_ABI, functionName: "paused" }),
    pub.readContract({ address: oracle, abi: ORACLE_ABI, functionName: "maxDeviation" }),
    pub.getGasPrice(),
  ]);

  if (paused) {
    return { ok: false, skipped: "oracle is paused; nothing to refresh", startedAt, address: account.address };
  }

  const assets = assetsFromEnv(env);
  const maxFeePerGas = gasPrice * 2n + PRIORITY_FEE_WEI;
  // 顺序发、手工递增 nonce —— 并行发会在同一 nonce 上打架
  let nonce = await pub.getTransactionCount({ address: account.address, blockTag: "pending" });

  const results = [];
  for (const a of assets) {
    const entry = { symbol: a.symbol, token: a.token };
    try {
      const data = { address: oracle, abi: ORACLE_ABI, functionName: "updatePrice", args: [a.token] };
      let gas;
      try {
        gas = await pub.estimateContractGas({ ...data, account });
      } catch {
        gas = GAS_FALLBACK;
      }
      const hash = await wallet.writeContract({
        ...data,
        gas: (gas * 130n) / 100n,
        maxFeePerGas,
        maxPriorityFeePerGas: PRIORITY_FEE_WEI,
        nonce,
      });
      nonce += 1;
      entry.tx = hash;
      entry.ok = true;
      entry.anomalous = await pub.readContract({
        address: oracle, abi: ORACLE_ABI, functionName: "priceAnomalous", args: [a.token],
      });
    } catch (e) {
      entry.ok = false;
      entry.error = e.shortMessage || e.message || String(e);
    }
    results.push(entry);
  }

  const sent = results.filter((r) => r.ok).length;
  const anomalous = results.filter((r) => r.anomalous === true).map((r) => r.symbol);

  const summary = {
    ok: sent === results.length,
    startedAt,
    address: account.address,
    balanceEth: formatEther(balance),
    lowBalance,
    gasPriceGwei: formatGwei(gasPrice),
    maxDeviationPct: (Number(maxDeviation) / 1e18) * 100,
    sent,
    total: results.length,
    /// 非空表示有资产的实时价偏离基准超过 maxDeviation —— 需要人看一眼，不是自动能解决的
    anomalous,
    results,
  };

  if (lowBalance) {
    console.warn(`keeper: LOW BALANCE ${summary.balanceEth} ETH on ${account.address} — top it up or the keeper will stop`);
  }
  if (anomalous.length > 0) {
    console.warn(`keeper: PRICE ANOMALY on ${anomalous.join(",")} — deviation exceeds ${summary.maxDeviationPct}% vs the stored baseline. Needs a human (PAUSER enableFallback, or PARAM_ADMIN widening maxDeviation).`);
  }
  console.log(JSON.stringify(summary));
  return summary;
}

export default {
  /// 定时触发（见 wrangler.toml 的 crons）
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runKeeper(env));
  },

  /// 手动触发 + 健康检查。
  /// GET  —— 只读：报余额、gas、偏差阈值，不写链。
  /// POST —— 真跑一轮（需 ?token=<TRIGGER_TOKEN>，未配置 TRIGGER_TOKEN 则禁止）。
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "GET") {
      if (!env.KEEPER_PRIVATE_KEY) {
        return Response.json({ ok: false, note: "KEEPER_PRIVATE_KEY not set yet; cron runs are no-ops" }, { status: 200 });
      }
      const account = privateKeyToAccount(env.KEEPER_PRIVATE_KEY);
      const pub = createPublicClient({ chain: base, transport: http(env.RPC_URL || RPC_DEFAULT) });
      const oracle = env.ORACLE_ADDRESS || ORACLE_DEFAULT;
      const [balance, gasPrice, maxDeviation, paused] = await Promise.all([
        pub.getBalance({ address: account.address }),
        pub.getGasPrice(),
        pub.readContract({ address: oracle, abi: ORACLE_ABI, functionName: "maxDeviation" }),
        pub.readContract({ address: oracle, abi: ORACLE_ABI, functionName: "paused" }),
      ]);
      return Response.json({
        ok: true,
        address: account.address,
        balanceEth: formatEther(balance),
        lowBalance: balance < LOW_BALANCE_WEI,
        gasPriceGwei: formatGwei(gasPrice),
        maxDeviationPct: (Number(maxDeviation) / 1e18) * 100,
        paused,
        assets: (env.ASSETS_JSON ? JSON.parse(env.ASSETS_JSON) : ASSETS_DEFAULT).map((a) => a.symbol),
      });
    }

    if (request.method === "POST") {
      if (!env.TRIGGER_TOKEN || url.searchParams.get("token") !== env.TRIGGER_TOKEN) {
        return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
      }
      const result = await runKeeper(env);
      return Response.json(result, { status: result.ok ? 200 : 500 });
    }

    return new Response("GET to inspect, POST ?token=… to run", { status: 405 });
  },
};
