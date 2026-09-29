# OrbitFi — 监控 / 索引脚手架（services/monitor）

> 目标：协议**没有用户事件（为过 EIP-170 已移除）**，清算/仓位监控只能靠链上视图轮询。
> 本目录提供“轮询看护 + 指标落库”的最小脚手架，作为主网 Subgraph 之前的过渡方案。
> ⚠️ 不是完整 Subgraph：只覆盖单池（USDC/USDT/DAI 市场 × **ETH/cbBTC** 抵押 —— 与
> 主网实际部署一致；wstETH 在 Base 上无官方 USD feed、WBTC 已被 cbBTC 取代，两者都不在抵押清单里），
> 若新增市场/抵押品需同步 `config/positions.json` 与 `src/*.ts` 的市场清单。

## 两个入口：monitor（只读）与 keeper（写）

**别把这两个搞混 —— 它们的权限要求和要紧程度完全不同。**

| | `npm run watch` / `npm run once` | `npm run keeper` / `npm run keeper:loop` |
|---|---|---|
| 做什么 | 轮询仓位/市场，发告警、落指标 | 周期调用 `ChainlinkOracle.updatePrice(asset)` |
| 写链 | 否（纯只读） | **是**（每轮 5 笔交易） |
| 需要私钥 | **不需要** | 需要，且需一点 Base gas |
| 需要用户名单 | **是**（`users` 为空会拒绝启动） | 否（用 markets + collaterals） |
| 什么时候必须跑 | 池子里有真实仓位之后 | **从现在起就要跑**（见下） |

## ⚠️ Keeper：不跑会锁死借款（这是本目录最要紧的一件事）

`ChainlinkOracle` 的偏差保护比较的是「最新价 vs `lastValidPrice`」，而 `lastValidPrice`
**只在 `updatePrice()` 且判定为非异常时才写入**。部署脚本只初始化一次，之后没人调用的话：

```
基准停在部署那一刻
  → 价格缓慢漂移
  → 漂移超过 maxDeviation（当前 20%）
  → 此后每次 updatePrice 都被判为 anomalous
  → anomalous 时又不会写 lastValidPrice   ← 自锁
  → priceAnomalous[asset] 永久为 true
```

而 `priceAnomalous` 为 true 时，`LendingPool` 会 `require(!_oracleAnomalous(), "price anomalous")` ——
**新增抵押品与借新债全部被拒**（存入、提取、还款不受影响，退出通道不会锁死）。
更麻烦的是前端读 `getAssetPrice` 仍然拿得到价格，UI 上完全看不出异常，
用户只会看到借款交易莫名其妙 revert。

**恢复手段**（都要走多签/治理，不是点一下就好的）：
- PAUSER `enableFallback()` → 走 `lastPrice` 缓存，绕过偏差校验
- PARAM_ADMIN `setMaxDeviation()` 临时放宽阈值

**所以 keeper 必须从现在开始跑**，间隔建议 1h（默认 `KEEPER_INTERVAL_SECONDS=3600`），
显著小于 `oracle.maxStaleness`（当前 93600s = 26h）。

```bash
cp .env.example .env
# 只需填 RPC_URL 与 KEEPER_PRIVATE_KEY
npm install
npm run keeper -- --once     # 跑一轮就退出，适合交给 cron / Cloudflare Cron / GitHub Actions
npm run keeper               # 常驻循环
```

> 权限：`updatePrice(address)` 是 **permissionless** 的 —— 该私钥**只需 Base gas，
> 不需要任何协议角色**。请用专用一次性热钱包，**绝不要复用 PARAM_ADMIN / PAUSER 的密钥**。

## 快速开始（monitor）

```bash
cp .env.example .env        # 填 RPC_URL 等
npm install
npm run build               # tsc 检查（无产物要求）
# 一次性看护
npx tsx src/index.ts
# 周期看护（每 60s）
npm run watch
```

## 输出

- `./out/alerts.log`：新出现且未恢复的告警（去抖，只有状态翻转才追加一行）。
- `./out/metrics.jsonl`：每次轮询全部指标（供后续做图/阈值告警）。
- 可选 `ALERT_WEBHOOK_URL`：每产生一条告警即 POST JSON（兼容 Telegram bot `sendMessage`，`{text, alert}`）；不设置则仅写 `out/alerts.log`。
- 可选 `TELEGRAM_BOT_TOKEN` + `TELEGRAM_CHAT_ID`：**WARN/CRITICAL** 通过 Bot API `sendMessage` 推送到指定 chat（INFO 不推）。用法：BotFather 建 bot 拿 token；给 bot 发消息后用 `getUpdates` 拿 `chat.id`。
- 告警等级：`CRITICAL`（可清算/坏账/喂价失效）、`WARN`（HF 接近 1、储备不足）。

## 检查项（主网池，地址取自 `frontend/src/lib/deployments/base.json`；该文件由部署脚本回填）

| 信号 | 来源 | 触发 |
|---|---|---|
| 清算候选 | `pool.isLiquidatable(user)` | true |
| 低 HF | `pool.getUserPositionV2(user).healthFactor` | `<1.1`（WARN）、`<1`（CRIT） |
| 坏账窗口 | `pool.userDebtToken(user, m)` 且 `collateralOf≈0` | 债务>0 且各抵押≈0（需手工 handleBadDebt） |
| 市场健康 | `pool.marketAccounts(m)` | utilization>95%、cash<供给 5% |
| 储备覆盖 | `reserveManager.balanceOf(token)` / totalBorrows | 储备/借款 < 目标(默认3%)×50% → WARN |
| Treasury 累积 | `pool.treasuryAccrued()` | 长时间未 collect 且 > 阈值 → INFO |
| 喂价失效 | `chainlink.getAssetPrice(token)` 返回 0 / revert（stale） | WARN |
| 合约尺寸/事件空窗 | — | 文档说明：事件缺失 → 依赖轮询 + 时间窗 |

> 说明：喂价 stale 时 `getAssetPrice` 会 revert；轮询脚本捕获后记一次 WARN，便于第一时间介入。

## 与 Subgraph 的关系

- 事件已移除 → 没有现成事件流可索引，故先用**轮询视图快照**把“当前谁可清算/谁坏账”落库。
- 生产建议：在本脚手架数据之上接 Subgraph（需协议重新引入最小事件集，或对每个用户地址定期快照）。
  已就绪的数据结构（metrics.jsonl 一行一条快照）可直接作为索引器的输入。

## 目录结构

```
services/monitor/
  package.json
  tsconfig.json
  .env.example
  README.md
  config/positions.json     # 盯梢用户名册 + keeper 的资产清单（按链、按池配置）
  src/
    index.ts                # monitor 入口：周期轮询 + 告警去抖
    keeper.ts               # keeper 入口：周期性 updatePrice，刷新偏差基准
    rpc.ts                  # viem publicClient + 合约封装 + 部署记录解析
    alerts.ts               # 简单状态翻转告警（去抖）
    checkers.ts             # isLiquidatable / HF / 坏账窗口 / 市场健康 判定
    util.ts                 # WAD、时间戳、目录等小工具
  out/                      # 运行产物（gitignore）
```
