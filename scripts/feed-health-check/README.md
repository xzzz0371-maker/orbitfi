# OrbitFi — Base feed 健康检查脚本

批量读取 Base 主网（chainId 8453）Chainlink feed 的 `latestRoundData`，核验：

- `description()` 与预期一致（防地址错配）
- `decimals()` 与预期一致（8）
- `answer > 0`
- 新鲜度：`now - updatedAt <= heartbeat × STALE_MULT`（默认 3×，可调；stable 偏差型 feed 常低于 heartbeat 更新，勿用固定小窗误报）

## 用法

```bash
cd scripts/feed-health-check
npm install
npm run check
# 自定义 RPC / stale 容忍倍数
BASE_RPC_URL=https://mainnet.base.org STALE_MULT=3 npm run check
```

## 输出

控制台打印 markdown 表：symbol / proxy / description / decimals / price / age / heartbeat / status / error。
任一 feed 未通过 → 进程退出码 1。

## feed 清单

维护于 `feeds.ts`（地址来源 docs.chain.link Base + 2026-09-03 链上实测）。上线前请对照 data.chain.link 复核 heartbeat / 偏差，并按需新增资产。
