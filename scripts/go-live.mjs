#!/usr/bin/env node
/**
 * ZZZ Lend - mainnet go-live orchestrator.
 *
 * Collapses the runbook in docs/主网部署执行手册_2026-09-19.md into one command:
 *
 *   node scripts/go-live.mjs check       pre-flight: env sanity, credential split, caps priced in USD
 *   node scripts/go-live.mjs dry-run     full rehearsal on a local Base fork (deploy + verify)
 *   node scripts/go-live.mjs broadcast   real deploy + verify (asks for confirmation)
 *   node scripts/go-live.mjs post        sync addresses into the frontend + build
 *
 * Reads contracts/.env.mainnet - copy it from contracts/.env.mainnet.example and fill it in.
 * Private keys are never printed.
 *
 * Add --yes to skip interactive confirmation (broadcast only).
 */

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CONTRACTS = path.join(ROOT, "contracts");
const ENV_FILE = path.join(CONTRACTS, ".env.mainnet");
const FORK_PORT = 8545;
const FORK_RPC = `http://127.0.0.1:${FORK_PORT}`;
const DRY_RUN_OUT = "./deployments/dryrun_fork.json";
const REAL_OUT = "./deployments/mainnet.json";

// Base mainnet Chainlink feeds / tokens. Must match the defaults inside DeployMainnet.s.sol.
const ASSETS = [
  { sym: "ETH", dec: 18, feed: "0x50015f8b17fb2C290Dde41fDc246ed0dcEE93a8b", capKey: "MAINNET_ETH_COLLATERAL_CAP", kind: "collateral" },
  { sym: "cbBTC", dec: 8, feed: "0x07DA0E54543a844a80ABE69c8A12F22B3aA59f9D", capKey: "MAINNET_CBBTC_COLLATERAL_CAP", kind: "collateral" },
  { sym: "USDC", dec: 6, feed: "0x7e860098F58bBFC8648a4311b374B1D669a2bc6B", capKey: "MAINNET_USDC_SUPPLY_CAP", kind: "market" },
  { sym: "USDT", dec: 6, feed: "0xf19d560eB8d2ADf07BD6D13ed03e1D11215721F9", capKey: "MAINNET_USDT_SUPPLY_CAP", kind: "market" },
  { sym: "DAI", dec: 18, feed: "0x591e79239a7d679378eC8c847e5038150364C78F", capKey: "MAINNET_DAI_SUPPLY_CAP", kind: "market" },
];

// Anvil deterministic accounts (mnemonic "test test ... junk"). Used for dry runs because the
// real deployer has no Base ETH on a fork. Governance *parameters* are still taken from your env.
const ANVIL = {
  key: "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
  deployer: "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
  admin: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
  treasury: "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC",
};

const ZERO_ADDR = "0x0000000000000000000000000000000000000000";

const C = {
  reset: "\x1b[0m", bold: "\x1b[1m", dim: "\x1b[2m",
  red: "\x1b[31m", green: "\x1b[32m", yellow: "\x1b[33m", blue: "\x1b[36m",
};

let failures = 0;
const ok = (m) => console.log(`  ${C.green}[ok]${C.reset} ${m}`);
const warn = (m) => console.log(`  ${C.yellow}[warn]${C.reset} ${m}`);
const bad = (m) => { failures++; console.log(`  ${C.red}[FAIL]${C.reset} ${m}`); };
const step = (m) => console.log(`\n${C.bold}==> ${m}${C.reset}`);
const info = (m) => console.log(`  ${C.dim}${m}${C.reset}`);

// ---------- env ----------

function parseEnvFile(file) {
  const out = {};
  for (const raw of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    const hash = val.indexOf(" #");
    if (hash >= 0) val = val.slice(0, hash).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    // An empty value means "not set" - a bare `KEY=` must not shadow a derived default
    // (e.g. an empty MAINNET_TREASURY falling through to MAINNET_ADMIN, or to the fork account).
    if (val !== "") out[key] = val;
  }
  return out;
}

function loadEnv() {
  if (!fs.existsSync(ENV_FILE)) {
    console.error(`${C.red}Missing ${path.relative(ROOT, ENV_FILE)}${C.reset}`);
    console.error(`Copy the template first:\n  cp contracts/.env.mainnet.example contracts/.env.mainnet`);
    process.exit(1);
  }
  return parseEnvFile(ENV_FILE);
}

// ---------- process helpers ----------

// NOTE: every external command goes through async spawn(), never spawnSync().
// In sandboxed Windows environments spawnSync() fails with EBUSY before the child even
// starts (it reports an empty stdout with status null), which makes a command that works
// fine in a terminal look like it silently failed. Async spawn works in both.

const WIN = process.platform === "win32";

/** Windows: a bare `forge` / `cast` / `anvil` resolves through PATH via CreateProcess,
 *  but .cmd / .bat cannot - they need cmd.exe. Never use shell:true with an args array:
 *  Node 22+ flags that as DEP0190 (args are concatenated, not escaped). */
function spawnExe(cmd, args, opts) {
  if (WIN && /\.(cmd|bat)$/i.test(cmd)) {
    return spawn(process.env.ComSpec || "cmd.exe", ["/d", "/s", "/c", cmd, ...args], opts);
  }
  return spawn(cmd, args, opts);
}

function run(cmd, args, { cwd = CONTRACTS, env = {}, quiet = false } = {}) {
  return new Promise((resolve) => {
    const child = spawnExe(cmd, args, {
      cwd,
      env: { ...process.env, ...env },
      stdio: quiet ? ["ignore", "pipe", "pipe"] : "inherit",
    });
    let out = "";
    if (quiet) {
      child.stdout?.on("data", (d) => { out += d.toString(); });
      child.stderr?.on("data", (d) => { out += d.toString(); });
    }
    child.on("error", (e) => resolve({ code: 1, out: `${out}\n[spawn error] ${e.message}`.trim() }));
    child.on("close", (code) => resolve({ code: code ?? 1, out: out.trim() }));
  });
}

function capture(cmd, args, { cwd = CONTRACTS } = {}) {
  return new Promise((resolve) => {
    const child = spawnExe(cmd, args, {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    child.stdout?.on("data", (d) => { out += d.toString(); });
    child.stderr?.on("data", (d) => { out += d.toString(); });
    child.on("error", (e) => resolve({ code: 1, out: `${out}\n[spawn error] ${e.message}`.trim() }));
    child.on("close", (code) => resolve({ code: code ?? 1, out: out.trim() }));
  });
}

async function have(bin) {
  return (await capture(bin, ["--version"])).code === 0;
}

/** Exact raw -> decimal conversion. `Number(raw) / 10**dec` is wrong: the raw value
 *  exceeds 2^53 for 18-decimal tokens, and BigInt division truncates to 0 for anything
 *  below 1.0 (which is every stablecoin price). */
function fromRaw(raw, dec) {
  const neg = raw < 0n;
  const s = (neg ? -raw : raw).toString().padStart(dec + 1, "0");
  const v = Number(`${s.slice(0, -dec)}.${s.slice(-dec)}`);
  return neg ? -v : v;
}

/** USD price from a Chainlink feed (8 decimals). Uses latestRoundData rather than the
 *  deprecated latestAnswer, which some Base feeds no longer expose. */
async function readPrice(feed, rpc) {
  const r = await capture("cast", [
    "call", feed, "latestRoundData()(uint80,int256,uint256,uint256,uint80)", "--rpc-url", rpc,
  ]);
  if (r.code !== 0) return null;
  const nums = r.out.replace(/[(),]/g, " ").split(/\s+/).filter((t) => /^-?\d+$/.test(t));
  if (nums.length < 2) return null;
  const px = fromRaw(BigInt(nums[1]), 8);
  return px > 0 ? px : null;
}

// ---------- checks ----------

function fmtUsd(n) {
  if (!Number.isFinite(n) || n <= 0) return "n/a";
  return `$${n.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}

async function checkEnvShape(env, forReal, { verifySafe = false } = {}) {
  step("1. Environment");

  const missing = [];
  if (!env.PRIVATE_KEY) missing.push("PRIVATE_KEY");
  if (!env.MAINNET_ADMIN) missing.push("MAINNET_ADMIN");
  if (!env.MAINNET_RPC_URL) missing.push("MAINNET_RPC_URL");
  if (missing.length) {
    bad(`not set: ${missing.join(", ")}`);
    return null;
  }

  if (!/^0x[0-9a-fA-F]{64}$/.test(env.PRIVATE_KEY)) {
    bad("PRIVATE_KEY is not a 32-byte hex string");
    return null;
  }
  ok("PRIVATE_KEY present (value not shown)");

  const admin = env.MAINNET_ADMIN;
  const adminIsAddress = /^0x[0-9a-fA-F]{40}$/.test(admin);
  if (admin.toLowerCase() === ZERO_ADDR) {
    bad("MAINNET_ADMIN is the zero address - deploy would revoke roles to nowhere");
  } else if (!adminIsAddress) {
    bad("MAINNET_ADMIN is not an address");
  } else {
    ok(`MAINNET_ADMIN   = ${admin}`);
  }

  // A Safe address shown in the UI is counterfactual (CREATE2): it exists before the
  // contract is deployed. Granting DEFAULT_ADMIN / PARAM_ADMIN / PAUSER to an address with
  // no code means the emergency pause and every parameter change become unreachable, and
  // the Timelock would have no proposer.
  if (verifySafe && adminIsAddress && admin.toLowerCase() !== ZERO_ADDR) {
    const c = await capture("cast", ["code", admin, "--rpc-url", env.MAINNET_RPC_URL]);
    if (c.code !== 0) {
      warn("could not reach the RPC to check whether MAINNET_ADMIN is a deployed contract");
    } else if ((c.out.split(/\s+/)[0] ?? "0x").length <= 2) {
      bad(`${admin} has NO CODE on chain - it is not a deployed contract`);
      info("If this came from app.safe.global it is still counterfactual - finish the activate");
      info("step first (fund it, then deploy). Roles granted to it, including the emergency");
      info("PAUSER, would be unreachable, and the Timelock would have no proposer.");
    } else {
      const thr = await capture("cast", ["call", admin, "getThreshold()(uint256)", "--rpc-url", env.MAINNET_RPC_URL]);
      const owns = await capture("cast", ["call", admin, "getOwners()(address[])", "--rpc-url", env.MAINNET_RPC_URL]);
      if (thr.code === 0 && owns.code === 0) {
        const threshold = Number(BigInt(thr.out.split(/\s+/)[0]));
        const owners = owns.out.match(/0x[0-9a-fA-F]{40}/g) ?? [];
        ok(`MAINNET_ADMIN is a deployed Safe: ${threshold}-of-${owners.length}`);
        for (const o of owners) info(`    owner ${o}`);
        if (threshold < 2) bad(`threshold is ${threshold} - a 1-of-N Safe gives no protection against a single key`);
        if (owners.length < 2) bad(`only ${owners.length} owner address(es) - the Safe contract requires unique owners`);
      } else {
        warn("MAINNET_ADMIN is a contract, but getThreshold()/getOwners() did not respond - is it really a Safe?");
      }
    }
  }

  const treasury = env.MAINNET_TREASURY && env.MAINNET_TREASURY.toLowerCase() !== ZERO_ADDR
    ? env.MAINNET_TREASURY : admin;
  const pauser = env.MAINNET_PAUSER && env.MAINNET_PAUSER.toLowerCase() !== ZERO_ADDR
    ? env.MAINNET_PAUSER : admin;
  ok(`MAINNET_TREASURY = ${treasury}${treasury === admin ? "  (defaults to admin)" : ""}`);
  ok(`MAINNET_PAUSER  = ${pauser}${pauser === admin ? "  (defaults to admin)" : ""}`);

  // The single most dangerous mis-fill: admin == deployer EOA makes the handover revoke
  // every role from the only holder -> protocol permanently unmanageable.
  const dep = await capture("cast", ["wallet", "address", "--private-key", env.PRIVATE_KEY]);
  const deployer = dep.code === 0 ? dep.out.split(/\s+/).pop() : null;
  if (deployer) {
    ok(`deployer        = ${deployer}`);
    if (deployer.toLowerCase() === admin.toLowerCase()) {
      bad("MAINNET_ADMIN == deployer EOA. Handover would renounce all roles with nobody left to hold them.");
      bad("Fix: create the Safe multisig first and put its address in MAINNET_ADMIN.");
    } else {
      ok("deployer != admin (roles end up with the multisig, not the deployer)");
    }
  } else {
    warn("could not derive the deployer address (cast unavailable?) - skipping the admin != deployer check");
  }

  const delay = Number(env.MAINNET_TIMELOCK_MIN_DELAY || 0);
  if (delay > 0) ok(`Timelock delay  = ${delay}s (${(delay / 3600).toFixed(1)}h)`);
  else warn("MAINNET_TIMELOCK_MIN_DELAY = 0 -> no Timelock; param changes execute immediately");

  const staleness = Number(env.MAINNET_FEED_MAX_STALENESS || 93600);
  if (staleness < 86400) {
    bad(`MAINNET_FEED_MAX_STALENESS = ${staleness}s < 86400s (stablecoin feed heartbeat).`);
    bad("The protocol would reject fresh-enough prices and lock borrow / withdraw / liquidation.");
  } else {
    ok(`maxStaleness    = ${staleness}s (${(staleness / 3600).toFixed(1)}h)  >= 86400s heartbeat`);
  }

  const dev = BigInt(env.MAINNET_MAX_DEVIATION || "200000000000000000");
  ok(`maxDeviation    = ${(Number(dev) / 1e16).toFixed(0)}%`);
  if (dev >= 300000000000000000n) warn(">= 30% is the unsafe contract default - deviation alerts are effectively off");

  if (env.MAINNET_IRM_GOVERNOR) {
    const zero = env.MAINNET_IRM_GOVERNOR.toLowerCase() === ZERO_ADDR;
    warn(zero
      ? "MAINNET_IRM_GOVERNOR = 0x0 -> interest-rate preset changes must go through the Timelock delay"
      : `MAINNET_IRM_GOVERNOR = ${env.MAINNET_IRM_GOVERNOR} -> can bypass the Timelock delay`);
  } else {
    ok("MAINNET_IRM_GOVERNOR not set (defaults to admin, the behaviour verified on 2026-09-04)");
  }

  const out = env.MAINNET_DEPLOYMENTS_OUT || REAL_OUT;
  if (forReal && out !== REAL_OUT) {
    bad(`MAINNET_DEPLOYMENTS_OUT = ${out} but this is a REAL broadcast - it must be ${REAL_OUT}`);
  }
  if (!forReal && out === REAL_OUT) {
    info(`MAINNET_DEPLOYMENTS_OUT = ${out}; a dry run is redirected to ${DRY_RUN_OUT} automatically`);
  }

  return { deployer, admin, treasury, pauser, staleness, deviation: dev };
}

async function checkTooling() {
  step("2. Tooling");
  for (const bin of ["forge", "cast", "anvil"]) {
    if (await have(bin)) ok(`${bin} available`);
    else bad(`${bin} not found in PATH`);
  }
  const envLocal = path.join(CONTRACTS, ".env");
  if (fs.existsSync(envLocal)) {
    warn("contracts/.env exists alongside .env.mainnet - foundry auto-loads it, but values already");
    warn("present in the process environment win out. .env.mainnet takes precedence here.");
  }
}

async function checkCaps(env) {
  step("3. Risk caps priced in USD (live Chainlink reads)");
  info("caps are token amounts, not USD; this shows what they are worth right now");
  let totalSupplyCap = 0;

  for (const a of ASSETS) {
    const rawCap = env[a.capKey];
    const enabled = a.sym === "USDC" || a.sym === "ETH" || env[`ENABLE_${a.sym.toUpperCase()}`] === "true";
    if (!enabled) {
      info(`${a.sym.padEnd(6)} disabled -> no cap needed`);
      continue;
    }
    if (!rawCap || rawCap === "0") {
      warn(`${a.sym.padEnd(6)} ${a.capKey} unset/0 -> ${C.red}UNLIMITED${C.reset} (the cap mechanism is built but not wired)`);
      continue;
    }
    const price = await readPrice(a.feed, env.MAINNET_RPC_URL);
    const amount = fromRaw(BigInt(rawCap), a.dec);
    const usd = price === null ? NaN : amount * price;
    const priceTag = price === null ? "?" : fmtUsd(price);
    const usdTag = Number.isNaN(usd) ? "(feed unavailable)" : fmtUsd(usd);
    const line = `${a.sym.padEnd(6)} ${amount.toLocaleString("en-US", { maximumFractionDigits: 6 })} @ ${priceTag} = ${usdTag}`;
    if (Number.isNaN(usd)) warn(`${line}  <- could not read the feed`);
    else if (usd > 100000) warn(`${line}  <- above the $100k soft-launch guideline`);
    else ok(line);
    if (a.kind === "market" && !Number.isNaN(usd)) totalSupplyCap += usd;
  }

  if (totalSupplyCap > 0) {
    const line = `total borrowable TVL ceiling = ${fmtUsd(totalSupplyCap)}`;
    if (totalSupplyCap > 200000) warn(`${line}  <- above the $200k soft-launch guideline`);
    else ok(line);
  }
}

// ---------- steps ----------

function forgeDeploy(env, { fork, realBroadcast }) {
  const args = ["script", "script/DeployMainnet.s.sol:DeployMainnet"];
  if (fork) args.push("--rpc-url", FORK_RPC, "--broadcast", "-vv");
  else {
    args.push("--rpc-url", env.MAINNET_RPC_URL, "--broadcast", "-vvv");
    if (env.BASESCAN_API_KEY) args.push("--verify");
    else warn("BASESCAN_API_KEY not set -> skipping --verify (add it and re-run verify manually)");
  }
  // Spread the config first, then the credentials/derived values, so they always win.
  const cfg = Object.fromEntries(
    Object.entries(env).filter(([k, v]) => v && (k.startsWith("ENABLE_") || k.startsWith("MAINNET_"))),
  );
  return run("forge", args, {
    env: {
      ...cfg,
      PRIVATE_KEY: fork ? ANVIL.key : env.PRIVATE_KEY,
      MAINNET_ADMIN: fork ? ANVIL.admin : env.MAINNET_ADMIN,
      MAINNET_TREASURY: fork ? ANVIL.treasury : (env.MAINNET_TREASURY || env.MAINNET_ADMIN),
      MAINNET_PAUSER: fork ? ANVIL.admin : (env.MAINNET_PAUSER || env.MAINNET_ADMIN),
      MAINNET_DEPLOYMENTS_OUT: fork ? DRY_RUN_OUT : (env.MAINNET_DEPLOYMENTS_OUT || REAL_OUT),
    },
  });
}

function forgeVerify(env, { fork }) {
  return run("forge", [
    "script", "script/VerifyMainnetState.s.sol:VerifyMainnetState",
    "--rpc-url", fork ? FORK_RPC : env.MAINNET_RPC_URL,
  ], {
    env: { MAINNET_DEPLOYMENTS: fork ? DRY_RUN_OUT : (env.MAINNET_DEPLOYMENTS_OUT || REAL_OUT) },
  });
}

async function waitForFork(timeoutMs = 180000, onTick) {
  const start = Date.now();
  const deadline = start + timeoutMs;
  while (Date.now() < deadline) {
    const r = await capture("cast", ["block-number", "--rpc-url", FORK_RPC]);
    if (r.code === 0 && /^\d+/.test(r.out)) return Number(r.out.match(/^\d+/)[0]);
    if (onTick) onTick(Math.round((Date.now() - start) / 1000));
    await new Promise((r) => setTimeout(r, 3000));
  }
  return null;
}

function killFork(child) {
  if (!child || child.killed) return;
  try {
    if (process.platform === "win32") {
      // spawnSync is unusable here (EBUSY) - fire and forget.
      spawnExe("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" }).unref();
    } else {
      process.kill(-child.pid, "SIGKILL");
    }
  } catch { /* already gone */ }
}

async function confirm(question) {
  if (process.argv.includes("--yes")) return true;
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const a = (await rl.question(`${question} [y/N] `)).trim().toLowerCase();
  rl.close();
  return a === "y" || a === "yes";
}

// ---------- commands ----------

async function cmdCheck(env) {
  await checkEnvShape(env, false, { verifySafe: true });
  await checkTooling();
  await checkCaps(env);
  step("Summary");
  if (failures) {
    console.log(`  ${C.red}${failures} problem(s) found - fix before deploying.${C.reset}`);
    process.exit(1);
  }
  console.log(`  ${C.green}pre-flight clean.${C.reset} Next: ${C.bold}node scripts/go-live.mjs dry-run${C.reset}`);
}

async function cmdDryRun(env) {
  // A rehearsal does not need real credentials - anvil accounts are substituted for the
  // deployer / admin / treasury anyway. Only the governance parameters need to be real,
  // so that the run validates the config actually filled into .env.mainnet.
  const missing = [];
  if (!env.PRIVATE_KEY) missing.push("PRIVATE_KEY");
  if (!env.MAINNET_ADMIN || env.MAINNET_ADMIN.toLowerCase() === ZERO_ADDR) missing.push("MAINNET_ADMIN");

  if (missing.length) {
    console.log(`\n${C.yellow}${C.bold}Credentials not set (${missing.join(", ")}) - this rehearsal uses anvil accounts${C.reset}`);
    console.log("  Governance parameters (caps / timelock delay / staleness / deviation / whitelist)");
    console.log("  are still taken from your .env.mainnet, so the config you filled in is what gets tested.");
    console.log(`  ${C.dim}All three must be filled in before a real broadcast.${C.reset}\n`);
  }

  const checkEnv = missing.length
    ? { ...env, PRIVATE_KEY: ANVIL.key, MAINNET_ADMIN: ANVIL.admin, MAINNET_TREASURY: ANVIL.treasury }
    : env;

  await checkEnvShape(checkEnv, false);
  if (failures) process.exit(1);

  step("Starting local Base fork (anvil)");
  info("the real deployer has no Base ETH on a fork, so anvil accounts are used for the dry run");
  info("your governance parameters (caps, timelock delay, staleness, deviation) are used as-is");
  info("first start can take a while on a public RPC (mainnet.base.org is slow and rate-limited)");

  // Capture anvil's output through pipes. Do NOT hand a file descriptor to a shell-wrapped
  // child on Windows: the process then silently fails to bind the port and the log file
  // stays empty, which is a miserable thing to debug.
  const child = spawnExe("anvil", ["--fork-url", env.MAINNET_RPC_URL, "--port", String(FORK_PORT)], {
    cwd: CONTRACTS,
    detached: process.platform !== "win32",
    stdio: ["ignore", "pipe", "pipe"],
  });
  let anvilOut = "";
  child.stdout?.on("data", (d) => { anvilOut += d.toString(); });
  child.stderr?.on("data", (d) => { anvilOut += d.toString(); });
  child.on("error", (e) => { anvilOut += `\n[spawn error] ${e.message}`; });

  try {
    let lastLog = 0;
    const block = await waitForFork(180000, (s) => {
      if (s - lastLog >= 15) {
        lastLog = s;
        info(`still initialising the fork... ${s}s elapsed`);
      }
    });
    if (block === null) {
      bad("anvil fork did not come up within 180s");
      const tail = anvilOut.trim().split(/\r?\n/).filter(Boolean).slice(-8);
      if (tail.length) {
        console.log(`  ${C.dim}--- anvil output ---${C.reset}`);
        for (const l of tail) console.log(`  ${C.dim}${l}${C.reset}`);
      } else {
        console.log(`  ${C.dim}(anvil produced no output at all - check that port ${FORK_PORT} is free)${C.reset}`);
      }
      console.log(`  ${C.dim}public RPCs are slow and rate-limited - set MAINNET_RPC_URL to a paid endpoint${C.reset}`);
      process.exit(1);
    }
    ok(`fork ready at block ${block}`);

    step("Deploying on the fork (--broadcast, local only)");
    const d = await forgeDeploy(env, { fork: true, realBroadcast: false });
    if (d.code !== 0) { bad("deployment failed - see the log above"); process.exit(1); }
    ok("deployment succeeded");

    step("Verifying on-chain state (VerifyMainnetState)");
    const v = await forgeVerify(env, { fork: true });
    if (v.code !== 0) { bad("state verification failed - see the log above"); process.exit(1); }
    ok("all assertions passed");

    step("Summary");
    console.log(`  ${C.green}rehearsal passed.${C.reset} The same parameters ran end to end on a real Base fork.`);
    console.log(`  Next: ${C.bold}node scripts/go-live.mjs broadcast${C.reset}  (needs Base ETH in the deployer wallet)`);
  } finally {
    killFork(child);
    const scratch = path.join(CONTRACTS, "deployments", "dryrun_fork.json");
    // On Windows the file may still be locked right after taskkill - harmless.
    try { if (fs.existsSync(scratch)) fs.rmSync(scratch, { force: true }); } catch { /* locked */ }
  }
}

async function cmdBroadcast(env) {
  const cfg = await checkEnvShape(env, true, { verifySafe: true });
  if (!cfg || failures) process.exit(1);

  step("Pre-broadcast balance");
  const bal = await capture("cast", ["balance", cfg.deployer, "--rpc-url", env.MAINNET_RPC_URL]);
  if (bal.code === 0) {
    const eth = Number(BigInt(bal.out.split(/\s+/)[0])) / 1e18;
    const line = `deployer balance = ${eth.toFixed(6)} ETH`;
    if (eth < 0.05) bad(`${line} - likely too low (~0.05-0.2 ETH needed)`);
    else ok(line);
  } else {
    warn("could not read the deployer balance");
  }
  if (failures) process.exit(1);

  console.log(`\n${C.yellow}${C.bold}This is a REAL mainnet deployment. It cannot be undone.${C.reset}`);
  console.log(`  admin    ${cfg.admin}`);
  console.log(`  treasury ${cfg.treasury}`);
  console.log(`  pauser   ${cfg.pauser}`);
  console.log(`  staleness ${cfg.staleness}s   deviation ${Number(cfg.deviation) / 1e16}%`);
  if (!(await confirm("Broadcast to Base mainnet?"))) {
    console.log("aborted.");
    return;
  }

  step("Deploying to Base mainnet");
  const d = await forgeDeploy(env, { fork: false, realBroadcast: true });
  if (d.code !== 0) { bad("deployment failed - see the log above"); process.exit(1); }
  ok("deployment succeeded");

  step("Verifying on-chain state");
  const v = await forgeVerify(env, { fork: false });
  if (v.code !== 0) { bad("state verification failed - DO NOT proceed before resolving this"); process.exit(1); }
  ok("all assertions passed");

  step("Next");
  console.log(`  node scripts/go-live.mjs post`);
  console.log(`  (then start the monitor + keeper - see the runbook section 6)`);
}

async function cmdPost(env) {
  step("Syncing deployment addresses into the frontend");
  const src = env.MAINNET_DEPLOYMENTS_OUT || REAL_OUT;
  const sync = await run("node", ["scripts/sync-deployments.mjs", "--from", `contracts/${src.replace(/^\.\//, "")}`], {
    cwd: ROOT,
    quiet: false,
  });
  if (sync.code !== 0) { bad("address sync failed"); process.exit(1); }
  ok("frontend/src/lib/deployments/base.json updated");

  step("Building the frontend");
  const build = await run(WIN ? "npm.cmd" : "npm", ["run", "build"], { cwd: path.join(ROOT, "frontend") });
  if (build.code !== 0) { bad("frontend build failed"); process.exit(1); }
  ok("build succeeded");

  step("Next");
  console.log(`  cd frontend && npm run deploy:cf`);
  console.log(`  then start the monitor + keeper - see the runbook section 6`);
}

// ---------- entry ----------

const cmd = (process.argv[2] ?? "").toLowerCase();
const USAGE = `
${C.bold}ZZZ Lend - mainnet go-live${C.reset}

  node scripts/go-live.mjs check        pre-flight only (safe, read-only)
  node scripts/go-live.mjs dry-run      full rehearsal on a local Base fork
  node scripts/go-live.mjs broadcast    real deploy + verify (asks to confirm; --yes to skip)
  node scripts/go-live.mjs post         sync addresses into the frontend + build

Reads contracts/.env.mainnet
`;

if (!cmd || cmd === "-h" || cmd === "--help" || cmd === "help") {
  console.log(USAGE);
  process.exit(0);
}
if (!["check", "dry-run", "broadcast", "post"].includes(cmd)) {
  console.error(`Unknown command: ${cmd}`);
  console.log(USAGE);
  process.exit(1);
}

const env = loadEnv();
if (cmd === "check") await cmdCheck(env);
else if (cmd === "dry-run") await cmdDryRun(env);
else if (cmd === "broadcast") await cmdBroadcast(env);
else await cmdPost(env);
