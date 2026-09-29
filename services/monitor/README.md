# OrbitFi — 监控 / 索引脚手架（services/monitor）

> 目标：协议**没有用户事件（为过 EIP-170 已移除）**，清算/仓位监控只能靠链上视图轮询。
> 本目录提供“轮询看护 + 指标落库”的最小脚手架，作为主网 Subgraph 之前的过渡方案。
> ⚠️ 不是完整 Subgraph：只覆盖单池（USDC/USDT/DAI 市场 × ETH/wstETH/WBTC 抵押），
> 若新增市场/抵押品需同步 `config/positions.json` 与 `src/*.ts` 的市场清单。

## 快速开始

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

## 检查项（对 Sepolia 当前池 `contracts/deployments/sepolia.json` / `frontend/src/lib/deployments/sepolia.json`）

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
  config/positions.json     # 需要盯梢的用户/市场（按链、按池配置）
  src/
    index.ts                # 入口：周期轮询 + 告警去抖
    rpc.ts                  # viem publicClient + 合约封装
    metrics.ts              # 行式 JSON 记录
    alerts.ts               # 简单状态翻转告警（去抖）
    checkers.ts             # isLiquidatable / HF / 坏账窗口 / 市场健康 判定
  out/                      # 运行产物（gitignore）
```
