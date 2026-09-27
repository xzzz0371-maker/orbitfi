#!/usr/bin/env node
/**
 * 把主网部署记录同步到前端地址文件。
 *
 * 背景：部署脚本写出 `contracts/deployments/mainnet.json`（含 admin/treasury/timelock 等运维字段），
 * 而前端读的是 `frontend/src/lib/deployments/base.json`（含代币与 feed 地址、以及前端需要的
 * 合约地址）。两者结构不同，手工拷贝 7 个地址容易漏项或错行——尤其 `oracle` 漏填会让前端
 * 的读价源为空，表现为整站"价格不可用"。
 *
 * 本脚本只覆盖「合约地址」字段，**保留** target 里既有的代币/feed 配置与注释；
 * 任一必需地址缺失或为零地址时拒绝写入（除非 --allow-missing）。
 *
 * 用法：
 *   node scripts/sync-deployments.mjs                  # 写入 frontend/src/lib/deployments/base.json
 *   node scripts/sync-deployments.mjs --dry-run        # 只打印将要发生的变化
 *   node scripts/sync-deployments.mjs --from <p> --to <p>
 *
 * 可选参数：
 *   --from <path>   源（部署记录），默认 contracts/deployments/mainnet.json
 *   --to <path>     目标（前端地址文件），默认 frontend/src/lib/deployments/base.json
 *   --dry-run       不写盘
 *   --allow-missing 允许缺失地址（仅调试用；默认拒绝，避免把半成品推到线上）
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "..");

/** 需要从部署记录复制到前端地址文件的合约字段。 */
const CONTRACT_FIELDS = [
  "lendingPool",
  "oracle",
  "interestRateModel",
  "riskManager",
  "liquidationManager",
  "reserveManager",
  "riskEngine",
  "timelock", // 前端目前不消费，但记录在案便于运维对照
];

/**
 * 前端读价源取自 target.oracle；它为空是"整站价格不可用"的直接原因，
 * 因此额外单独强调。
 */
const CRITICAL_FIELDS = ["lendingPool", "oracle", "interestRateModel", "riskManager"];

function parseArgs(argv) {
  const out = { dryRun: false, allowMissing: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dry-run") out.dryRun = true;
    else if (a === "--allow-missing") out.allowMissing = true;
    else if (a === "--from") out.from = argv[++i];
    else if (a === "--to") out.to = argv[++i];
    else if (a === "--help" || a === "-h") out.help = true;
    else {
      console.error(`未知参数: ${a}`);
      process.exit(2);
    }
  }
  return out;
}

function readJson(p) {
  if (!fs.existsSync(p)) {
    console.error(`找不到文件: ${p}`);
    process.exit(1);
  }
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch (e) {
    console.error(`解析 JSON 失败: ${p}\n${e.message}`);
    process.exit(1);
  }
}

const isZero = (v) =>
  typeof v !== "string" || v.length === 0 || /^0x0{40}$/i.test(v) || v === "0";

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log("用法: node scripts/sync-deployments.mjs [--dry-run] [--from <p>] [--to <p>] [--allow-missing]");
    return;
  }

  const from = path.resolve(args.from ?? path.join(REPO_ROOT, "contracts/deployments/mainnet.json"));
  const to = path.resolve(args.to ?? path.join(REPO_ROOT, "frontend/src/lib/deployments/base.json"));

  console.log(`source: ${from}`);
  console.log(`target: ${to}`);
  console.log("");

  const src = readJson(from);
  const dst = readJson(to);

  // 源是主网部署记录时校验 chainId，避免把测试网记录同步过去
  if (typeof src.chainId === "number" && typeof dst.chainId === "number" && src.chainId !== dst.chainId) {
    console.error(`chainId 不匹配: source=${src.chainId} target=${dst.chainId}。请确认源是主网记录。`);
    process.exit(1);
  }
  if (args.allowMissing === false && isZero(src.timelock) === false && typeof src.timelock !== "string") {
    console.error("timelock 字段类型异常");
    process.exit(1);
  }

  const missing = [];
  const changes = [];
  const next = { ...dst };

  for (const f of CONTRACT_FIELDS) {
    const v = src[f];
    if (isZero(v)) {
      if (f === "timelock") continue; // 未启用 Timelock 属正常
      missing.push(f);
      continue;
    }
    if (dst[f] !== v) changes.push(`${f}: "${dst[f] ?? "(absent)"}" -> "${v}"`);
    next[f] = v;
  }

  // 主网明确不部署 SwitchableOracle；确保不会被误填成读价源
  if (!("switchableOracle" in next)) next.switchableOracle = "";

  if (missing.length > 0) {
    const critical = missing.filter((f) => CRITICAL_FIELDS.includes(f));
    console.error(`源文件缺少地址字段: ${missing.join(", ")}`);
    if (critical.length > 0) {
      console.error(`其中关键字段: ${critical.join(", ")} —— 前端会无法工作。`);
    }
    if (!args.allowMissing) {
      console.error("拒绝写入（加 --allow-missing 可强制，仅用于调试）。");
      process.exit(1);
    }
    console.warn("已按 --allow-missing 继续写入。");
  }

  if (changes.length === 0) {
    console.log("无变化：target 已与 source 一致。");
    return;
  }

  console.log("将写入以下变更:");
  for (const c of changes) console.log(`  ${c}`);
  console.log("");

  if (args.dryRun) {
    console.log("--dry-run：未写盘。");
    return;
  }

  // 保留原有键顺序，仅在末尾追加新键
  fs.writeFileSync(to, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  console.log(`已写入 ${to}`);
  console.log("");
  console.log("下一步：");
  console.log("  cd frontend && npm run build && npm run deploy:cf");
  console.log("  （构建后确认站点读价正常；oracle 为空会显示 “Price feed unavailable”）");
}

main();
