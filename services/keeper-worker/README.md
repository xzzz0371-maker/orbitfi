# OrbitFi — 偏差基准 keeper（Cloudflare Worker + Cron）

每小时调用一次 `ChainlinkOracle.updatePrice(asset)`，刷新偏差保护用的基准价。

## 为什么必须有它

`ChainlinkOracle` 的偏差保护比较的是「最新价 vs `lastValidPrice`」，而 `lastValidPrice`
**只在 `updatePrice()` 且判定为非异常时才写入**。部署脚本只初始化一次。没人周期调用的话：

```
基准停在部署那一刻 → 价格漂移 → 超过 maxDeviation（当前 20%）
→ 之后每次 updatePrice 都被判为 anomalous
→ 而 anomalous 时又不会更新 lastValidPrice      ← 自锁，无法自愈
→ priceAnomalous[asset] 永久为 true
```

而 `priceAnomalous` 为 true 时，`LendingPool` 会 `require(!_oracleAnomalous(), "price anomalous")`：

| 操作 | 受影响？ |
|---|---|
| 新增抵押品 `_supplyCollateralCore` | ❌ **被拒** |
| 借新债 `_borrowCore` | ❌ **被拒** |
| 存入 / 提取 / 还款 | ✅ 不受影响（**资金不会被困死**） |

**最麻烦的是前端看不出来**：`getAssetPrice` 照样返回价格，UI 一片正常，
用户只会看到借款交易莫名 revert。

恢复要靠治理动作：PAUSER `enableFallback()`，或 PARAM_ADMIN `setMaxDeviation()` 放宽阈值。
所以别等出事——**现在就让它跑起来**。

## 热钱包的安全规则（重要）

| 规则 | 原因 |
|---|---|
| **专用、一次性**，不要复用任何其它用途的钱包 | 密钥会存在 Cloudflare 上 |
| **不要给它任何协议角色** | `updatePrice` 是 permissionless 的，它只需要 gas |
| **绝不要用 PARAM_ADMIN / PAUSER 的密钥** | 那两个能暂停、能改参数，泄露代价完全不同 |
| 私钥**只在 Cloudflare secret 里**，不要落盘到仓库 | `setup.ps1` 会生成到临时文件→上传→覆写删除 |

即使这个密钥泄露，攻击者最多能做的就是替你调 `updatePrice` —— 那本身就是公开可调的，
**动不了任何资金**。所以它是个低价值目标，可以放心让它跑。

## 一键安装

在仓库根目录执行（Windows PowerShell）：

```powershell
powershell -ExecutionPolicy Bypass -File services\keeper-worker\setup.ps1
```

脚本会依次做四件事：

1. `cast wallet new` 生成一个**全新**热钱包
2. 私钥写入临时文件 → `wrangler secret bulk` 上传为 Cloudflare secret → **覆写并删除临时文件**
3. `wrangler deploy` 部署 Worker（含每小时 cron）
4. 打印**热钱包地址**，等你转 gas

**私钥全程不上屏、不进命令行参数、不经过任何人。**

> 脚本里 `cast` 需要已安装 Foundry；`wrangler` 会优先用本目录或 `frontend/node_modules` 里的。

## 然后：转 gas

脚本最后会打印地址，往它转 **Base 网络的 ETH**。

**实测成本**（2026-09-29，主网真实测量，含 L1 data fee）：

| 项 | 数值 |
|---|---|
| 单轮 5 个资产 | **329,734 gas** |
| Base base fee（最近 60 区块） | **稳定在 0.005 gwei**（min = median = p90 = max） |
| L1 data fee 占比 | **2.1%**（可忽略，L2 占 97.9%） |
| 单轮成本 | **0.0000020 ETH ≈ $0.0055** |
| 每小时一次 | **$0.13/天 ≈ $3.95/月** |

转多少：

| 金额 | 大约能跑（每小时一次） |
|---|---|
| 0.001 ETH | ~3 周 |
| 0.005 ETH | ~3.5 个月 |
| **0.01 ETH（建议）** | **~7 个月** |

> keeper 里写了低余额检查：低于 **0.0003 ETH** 会在日志里喊
> `keeper: LOW BALANCE …`。**别让钱包跑干** —— 跑干了 keeper 静默停止，自锁风险就回来了。

## 验证

```bash
# 只读健康检查：余额、gas、偏差阈值、oracle 是否暂停、参与资产
curl https://orbitfi-keeper.<你的子域>.workers.dev
```

期望输出：

```json
{"ok":true,"address":"0x…","balanceEth":"0.01","lowBalance":false,
 "gasPriceGwei":"0.006","maxDeviationPct":20,"paused":false,
 "assets":["USDC","USDT","DAI","ETH","cbBTC"]}
```

看运行日志：

```bash
cd services/keeper-worker && npm run tail
```

手动触发一轮（需先设 `TRIGGER_TOKEN` secret）：

```bash
curl -X POST "https://orbitfi-keeper.<你的子域>.workers.dev?token=<TRIGGER_TOKEN>"
```

## 本地跑一轮（不部署）

```bash
cd services/keeper-worker
npm install
echo "KEEPER_PRIVATE_KEY=0x<你的私钥>" > .dev.vars    # 已 gitignore
npm run dev                                            # 启动本地 Worker
curl "http://127.0.0.1:8787/__scheduled?cron=0+*+*+*+*"
```

## 已验证到什么程度

| 项 | 结果 |
|---|---|
| `wrangler deploy --dry-run` 打包 | ✅ 797 KiB / **gzip 154 KiB**（免费额度内） |
| 本地 `wrangler dev` 跑 GET 健康检查 | ✅ 地址、余额、gas、`maxDeviationPct=20`、`paused=false`、5 个资产全部正确 |
| 本地触发 scheduled 全链路 | ✅ 5 个资产逐个 ABI 编码 → 估气 → 发送；用 0 余额测试钱包验证，失败点正是「余额不足」，**无交易上链** |

> ⚠️ **尚未在真实资金下跑过**：上面用的是一次性测试私钥（余额 0），
> 所以「交易真的上链并成功」这一步要等你转完 gas 后由第一次 cron 验证。
> 第一次跑完请用 `npm run tail` 看日志里的 `"sent":5`。

## 与 `services/monitor` 的关系

两者**完全不同**，别搞混：

| | `services/monitor` | 本目录（keeper） |
|---|---|---|
| 做什么 | 轮询仓位/市场，发告警落指标 | 周期 `updatePrice` 刷新偏差基准 |
| 写链 | 否（只读） | **是** |
| 要私钥 | 不需要 | 需要（只要 gas） |
| 要用户名单 | 是（为空会拒绝启动） | 否 |

keeper 用 Worker 跑（随时在线）；monitor 需要有真实仓位后才有意义，可以先不出。

## 故障排查

| 现象 | 原因 / 处理 |
|---|---|
| 日志出现 `KEEPER_PRIVATE_KEY is not set` | secret 没上传成功，重跑 `setup.ps1` |
| `LOW BALANCE` | 给热钱包转 gas |
| 所有资产都 `exceeds the balance` | 同上 |
| `PRICE ANOMALY on ETH,…` | 实时价偏离基准超过 `maxDeviation`。**要人介入**：PAUSER `enableFallback()` 或 PARAM_ADMIN 放宽阈值 |
| 部署时提示缺少 `@cloudflare/workerd-windows-64` / `@esbuild/win32-x64` | npm 跳过了可选依赖，跑 `npm install --include=optional` |
| 想加新资产 | **两处都要改**：本目录 `src/index.js` 的 `ASSETS_DEFAULT` + `services/monitor/config/positions.json` |
