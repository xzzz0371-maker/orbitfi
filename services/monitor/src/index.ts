import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import type { Address } from "viem";

import { init, loadDeployments, resolveDeploymentsPath, abiFor, tryRead } from "./rpc.js";
import { checkPosition, snapshotMarket, utilization, reserveBalanceOf, assetPrice, describeHf, describeMarket } from "./checkers.js";
import { AlertStore, notifyWebhook, notifyTelegram } from "./alerts.js";
import { appendLine, touchFile, nowIso, WAD } from "./util.js";

interface PositionsCfg {
  markets: { id: number; symbol: string; token: Address; decimals: number }[];
  collaterals: { id: number; symbol: string; token: Address; decimals: number }[];
  users: Address[];
}

function envOr(name: string, dflt: string): string {
  return process.env[name] ?? dflt;
}

function loadCfg(): PositionsCfg {
  const p = path.resolve(process.cwd(), "config", "positions.json");
  return JSON.parse(fs.readFileSync(p, "utf8")) as PositionsCfg;
}

async function main() {
  const rpcUrl = envOr("RPC_URL", "");
  if (!rpcUrl) {
    console.error("RPC_URL missing");
    process.exit(1);
  }
  // 未设 DEPLOYMENTS 时用包内默认路径（不依赖 CWD）；设了则按 CWD 解析
  const deploymentsPath = resolveDeploymentsPath(process.env.DEPLOYMENTS);
  const outDir = path.resolve(envOr("OUT_DIR", "./out"));
  touchFile(path.join(outDir, ".keep"));

  init({ rpcUrl, deploymentsJson: deploymentsPath });
  const d = loadDeployments(deploymentsPath);
  const pool = d.lendingPool;
  const rm = d.reserveManager;
  const oracle = d.oracle;
  const cfg = loadCfg();
  // 空名单守卫：协议已移除事件（EIP-170），监控完全依赖 positions.json 的 users 列表。
  // 名单为空时监控"盯 0 个仓位"但仍输出全绿，会制造虚假安全感 → 必须显式确认才允许空跑。
  if (cfg.users.length === 0) {
    const msg =
      "positions.json 的 users 为空 —— 监控不会发现任何可清算仓位，输出全绿不代表协议健康。";
    if (envOr("ALLOW_EMPTY_WATCHLIST", "") !== "1") {
      console.error(`${msg}\n如确需空跑（例如仅验证 RPC 连通性），请设 ALLOW_EMPTY_WATCHLIST=1。`);
      process.exit(1);
    }
    console.warn(`${msg} 已按 ALLOW_EMPTY_WATCHLIST=1 继续空跑。`);
  }
  const pollSec = parseInt(envOr("POLL_SECONDS", "60"), 10);
  const loop = process.argv.includes("--loop");

  const alertsFile = path.join(outDir, "alerts.log");
  const metricsFile = path.join(outDir, "metrics.jsonl");
  const webhookUrl = process.env.ALERT_WEBHOOK_URL;
  const tgToken = process.env.TELEGRAM_BOT_TOKEN;
  const tgChat = process.env.TELEGRAM_CHAT_ID;
  const alerts = new AlertStore((a) => {
    const line = `[${a.at}] [${a.level}] ${a.message}`;
    console.log(line);
    appendLine(alertsFile, a);
    notifyWebhook(webhookUrl, a);
    notifyTelegram(tgToken, tgChat, a);
  }, parseInt(envOr("ALERT_RENOTIFY_MINUTES", "15"), 10) * 60_000);

  console.log(`monitor: pool=${pool} rm=${rm} oracle=${oracle} loop=${loop} interval=${pollSec}s`);

  async function tick() {
    const ts = nowIso();
    const row: Record<string, unknown> = { ts };

    // ---- markets ----
    for (const m of cfg.markets) {
      const snap = await snapshotMarket(pool, m.id);
      if (!snap) {
        alerts.set(`mkt-${m.id}-read`, "WARN", true, `market ${m.id} read failed (maybe no such market)`);
        continue;
      }
      alerts.set(`mkt-${m.id}-read`, "WARN", false, "");
      row[`m${m.id}.market`] = describeMarket(snap);
      const u = utilization(snap);
      row[`m${m.id}.utilization`] = u.toString();
      if (u > 95n * WAD / 100n) {
        alerts.set(`mkt-${m.id}-util`, "WARN", true, `m${m.id} utilization high ${describeMarket(snap)}`);
      } else {
        alerts.set(`mkt-${m.id}-util`, "WARN", false, "");
      }
      // 储备覆盖率 = reserveManager.balanceOf / totalBorrows
      const rsv = await reserveBalanceOf(rm, m.token);
      if (rsv !== null) {
        row[`m${m.id}.reserveBal`] = rsv.toString();
        if (snap.borrows > 0n) {
          const cov = (rsv * WAD) / snap.borrows;
          row[`m${m.id}.reserveCovPct`] = cov.toString();
          if (cov < (3n * WAD) / 100n) {
            alerts.set(`mkt-${m.id}-reserve`, "WARN", true, `m${m.id} reserve coverage low: ${describeMarket(snap)}`);
          } else {
            alerts.set(`mkt-${m.id}-reserve`, "WARN", false, "");
          }
        }
      }
    }

    // ---- positions / liquidatable watch ----
    for (const user of cfg.users) {
      const p = await checkPosition(pool, user);
      if (!p) continue;
      row[`user.${user}.hf`] = describeHf(p.hf);
      row[`user.${user}.liquidatable`] = p.liquidatable;
      if (p.liquidatable) {
        alerts.set(`liq-${user}`, "CRITICAL", true, `user ${user} liquidatable (hf=${describeHf(p.hf)})`);
      } else {
        alerts.set(`liq-${user}`, "CRITICAL", false, "");
      }
      if (!p.liquidatable && p.hf < 11n * WAD / 10n && p.hf > 0n) {
        alerts.set(`hf-${user}`, "WARN", true, `user ${user} HF low ${describeHf(p.hf)}`);
      } else {
        alerts.set(`hf-${user}`, "WARN", false, "");
      }
    }

    // ---- oracle sanity ----
    // 抵押品 + 市场借贷币都检查喂价（市场币通常各有独立 feed）。
    for (const c of cfg.collaterals) {
      const px = await assetPrice(oracle, c.token);
      row[`oracle.${c.symbol}`] = px === null ? "stale/unavailable" : px.toString();
      if (px === null || px === 0n) {
        alerts.set(`oracle-${c.symbol}`, "CRITICAL", true, `oracle price for ${c.symbol} unavailable/stale`);
      } else {
        alerts.set(`oracle-${c.symbol}`, "CRITICAL", false, "");
      }
    }
    for (const m of cfg.markets) {
      const px = await assetPrice(oracle, m.token);
      row[`oracle.${m.symbol}`] = px === null ? "stale/unavailable" : px.toString();
      if (px === null || px === 0n) {
        alerts.set(`oracle-${m.symbol}`, "CRITICAL", true, `oracle price for ${m.symbol} unavailable/stale`);
      } else {
        alerts.set(`oracle-${m.symbol}`, "CRITICAL", false, "");
      }
    }

    // ---- oracle 偏差基准 ----
    // lastValidPrice 仅在 updatePrice() 且判定为非异常时写入。若为 0，ChainlinkOracle 的
    // maxDeviation 保护永不触发（等于没有偏差熔断）。部署脚本会初始化一次，之后需要 keeper
    // 周期性调用 oracle.updatePrice(asset) 刷新；这里在归零时告警。
    for (const a of [...cfg.collaterals, ...cfg.markets]) {
      const base = await tryRead(oracle, abiFor("ChainlinkOracle"), "lastValidPrice", [a.token]);
      if (base === null || (base as bigint) === 0n) {
        alerts.set(
          `oracle-base-${a.symbol}`,
          "CRITICAL",
          true,
          `${a.symbol} deviation baseline unprimed (lastValidPrice=0) -> maxDeviation protection is inert; call oracle.updatePrice()`,
        );
      } else {
        alerts.set(`oracle-base-${a.symbol}`, "CRITICAL", false, "");
      }
    }

    appendLine(metricsFile, row);
  }

  await tick();
  if (loop) {
    setInterval(tick, pollSec * 1000);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
