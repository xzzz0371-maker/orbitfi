import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { createWalletClient, http, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base } from "viem/chains";

import { init, loadDeployments, resolveDeploymentsPath, abiFor, tryRead } from "./rpc.js";

/**
 * 偏差基准 keeper（与 monitor 分开运行，因为这里是写操作）。
 *
 * 为什么需要它：
 *   ChainlinkOracle 的偏差保护比较的是「最新价 vs lastValidPrice」，而 lastValidPrice
 *   **只由 updatePrice() 且判定为非异常时写入**。如果没人周期调用，lastValidPrice 会一直
 *   停在部署时初始化的那一刻，之后价格缓慢漂移也不会被判定为"异常"，保护逐渐钝化。
 *   部署脚本只做一次初始化；持续保鲜靠本 keeper。
 *
 * 权限：**零权限**。ChainlinkOracle.updatePrice(address) 是 permissionless 的，
 *   任何地址都能调用。因此这里的私钥只需要一点 Base gas，**不需要任何协议角色**，
 *   也不要拿 PARAM_ADMIN / PAUSER 的密钥来跑。建议用一个专门的一次性热钱包。
 *
 * 用法：
 *   npm run keeper            # 常驻，按 KEEPER_INTERVAL_SECONDS 循环
 *   npm run keeper -- --once  # 跑一轮就退出（适合交给 cron / Cloudflare Cron / GitHub Actions）
 *
 * 环境变量（见 .env.example）：
 *   RPC_URL                  必填
 *   KEEPER_PRIVATE_KEY       必填（仅需 gas；不要用管理密钥）
 *   DEPLOYMENTS              部署记录，默认 ../frontend/src/lib/deployments/base.json
 *   KEEPER_INTERVAL_SECONDS  轮询间隔，默认 3600（1h）。应显著小于 oracle.maxStaleness
 *   ASSETS_JSON              资产清单，默认 config/positions.json
 */

interface AssetEntry {
  id: number;
  symbol: string;
  token: Address;
}

interface AssetsCfg {
  markets: AssetEntry[];
  collaterals: AssetEntry[];
}

function envOr(name: string, dflt: string): string {
  return process.env[name] ?? dflt;
}

function loadAssets(p: string): AssetEntry[] {
  const cfg = JSON.parse(fs.readFileSync(path.resolve(p), "utf8")) as AssetsCfg;
  const seen = new Set<string>();
  const all = [...(cfg.markets ?? []), ...(cfg.collaterals ?? [])];
  return all.filter((a) => {
    const k = a.token.toLowerCase();
    if (seen.has(k)) return false; // 同一 token 既做市场又做抵押时去重
    seen.add(k);
    return true;
  });
}

async function main() {
  const rpcUrl = envOr("RPC_URL", "");
  if (!rpcUrl) {
    console.error("RPC_URL missing");
    process.exit(1);
  }
  const pkRaw = process.env.KEEPER_PRIVATE_KEY;
  if (!pkRaw) {
    console.error(
      "KEEPER_PRIVATE_KEY missing。注意：updatePrice 是 permissionless 的，此密钥只需 gas，" +
        "不需要协议角色，请勿复用 PARAM_ADMIN / PAUSER 的密钥。",
    );
    process.exit(1);
  }
  const pk = (pkRaw.startsWith("0x") ? pkRaw : `0x${pkRaw}`) as Hex;

  // 未设 DEPLOYMENTS 时用包内默认路径（不依赖 CWD）；设了则按 CWD 解析
  const deploymentsPath = resolveDeploymentsPath(process.env.DEPLOYMENTS);
  init({ rpcUrl, deploymentsJson: deploymentsPath });
  const d = loadDeployments(deploymentsPath);
  const oracle = d.oracle as Address;
  if (!oracle || /^0x0{40}$/.test(oracle)) {
    console.error(`oracle address missing/zero in ${deploymentsPath}（主网部署后需回填）`);
    process.exit(1);
  }

  const account = privateKeyToAccount(pk);
  const wallet = createWalletClient({ account, chain: base, transport: http(rpcUrl) });

  const assets = loadAssets(envOr("ASSETS_JSON", "config/positions.json"));
  if (assets.length === 0) {
    console.error("资产清单为空（config/positions.json 的 markets / collaterals）");
    process.exit(1);
  }
  const interval = parseInt(envOr("KEEPER_INTERVAL_SECONDS", "3600"), 10);
  const once = process.argv.includes("--once");

  const maxStaleness = await tryRead(oracle, abiFor("ChainlinkOracle"), "maxStaleness", []);
  console.log(
    `keeper: oracle=${oracle} signer=${account.address} assets=${assets.length} ` +
      `interval=${interval}s once=${once} oracle.maxStaleness=${maxStaleness}`,
  );
  // ⚠️ 单位必须一致：链上 maxStaleness 是「秒」，interval 也是「秒」。
  //    （早先版本误用 interval*1000 与秒比较，导致 3600 >= 93600 恒真的误报。）
  //    建议刷新间隔不超过 maxStaleness 的 1/4：间隔越接近 maxStaleness，
  //    偏差基准越旧，maxDeviation 的实际保护越钝。
  if (typeof maxStaleness === "bigint" && maxStaleness > 0n) {
    const recommended = maxStaleness / 4n;
    if (BigInt(interval) > recommended) {
      console.warn(
        `[warn] KEEPER_INTERVAL_SECONDS=${interval}s > maxStaleness/4 (${recommended}s)：` +
          "偏差基准刷新偏慢，maxDeviation 保护会钝化。",
      );
    }
  }

  async function tick(): Promise<void> {
    const ts = new Date().toISOString();
    for (const a of assets) {
      try {
        const hash = await wallet.writeContract({
          address: oracle,
          abi: abiFor("ChainlinkOracle"),
          functionName: "updatePrice",
          args: [a.token],
        });
        const base0 = await tryRead(oracle, abiFor("ChainlinkOracle"), "lastValidPrice", [
          a.token,
        ]);
        console.log(`[${ts}] updatePrice ${a.symbol} ok tx=${hash} lastValidPrice=${base0}`);
      } catch (e) {
        // 单向失败不终止整轮：某个 feed stale 时该资产会 revert，其它资产仍应刷新
        console.error(`[${ts}] updatePrice ${a.symbol} FAILED: ${(e as Error).message}`);
      }
    }
  }

  await tick();
  if (!once) {
    setInterval(() => {
      void tick();
    }, interval * 1000);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
