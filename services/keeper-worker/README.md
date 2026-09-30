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

脚本会：

1. `cast wallet new` 生成一个**全新**热钱包，**立刻打印地址**（万一后面失败，地址不会丢）
2. 私钥写入临时文件
3. `wrangler deploy --secrets-file <临时文件>` —— **一条命令同时建 Worker + 挂 secret**
4. **覆写并删除**临时文件

**私钥全程不上屏、不进命令行参数、不经过任何人。**

> **为什么用 `deploy --secrets-file` 而不是 `wrangler secret bulk`**：
> `secret bulk` 在 Worker 还不存在时会停下来问
> 「There doesn't seem to be a Worker called "orbitfi-keeper". Do you want to create…」
> —— 第一次跑必然卡在这个交互上。`deploy --secrets-file` 是原子的、非交互的，
> 顺带把 Worker 建出来。**这个坑已经踩过一次，别再改回去。**

> `cast` 需要已安装 Foundry；`wrangler` 会优先用本目录或 `frontend/node_modules` 里的。

## 当前部署状态

Worker 已经部署好了（我这边跑过一次验证）：

| 项 | 值 |
|---|---|
| 名称 | `orbitfi-keeper` |
| URL | `https://orbitfi-keeper.xzzz0371.workers.dev` |
| Cron | `0 * * * *`（每小时） |
| Secret | **未设置**（验证用的假密钥已删除） |

也就是说：**现在跑 `setup.ps1` 会生成真钱包、把 secret 挂上、重新部署一次**。
在此之前每小时会跑一轮但什么都不做（日志里是 `KEEPER_PRIVATE_KEY is not set`），**这是预期的、无害的**。

> ⚠️ **`workers.dev` 在部分网络下被 DNS 污染**（本机实测解析到 `31.13.85.53` /
> `2a03:2880:…:face:b00c`，是 Meta 的 IP 段）。
> **但这不影响 keeper** —— Cron 是 Cloudflare 内部触发的，根本不走 `workers.dev` 的 DNS。
> 只有「手动打开健康检查网址」这一件事会失败，改用下面的 `npm run tail` 看日志即可。

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

**首选方式是看日志**（`workers.dev` 可能被 DNS 污染，日志走的是 Cloudflare API，不受影响）：

```bash
cd services/keeper-worker
npm run tail
```

转完 gas 后的第一个整点，日志里应该出现：

```json
{"ok":true,"sent":5,"total":5,"anomalous":[],
 "balanceEth":"0.01","lowBalance":false,"gasPriceGwei":"0.005","maxDeviationPct":20,
 "results":[{"symbol":"USDC","ok":true,"tx":"0x…"}, …]}
```

`"sent":5` 就是成功。`"anomalous"` 非空才需要人工介入。

如果网络能通 `workers.dev`，也可以直接看健康检查（只读，不写链）：

```bash
curl https://orbitfi-keeper.xzzz0371.workers.dev
```

期望输出：

```json
{"ok":true,"address":"0x…","balanceEth":"0.01","lowBalance":false,
 "gasPriceGwei":"0.005","maxDeviationPct":20,"paused":false,
 "assets":["USDC","USDT","DAI","ETH","cbBTC"]}
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
| **真实部署** | ✅ Worker `orbitfi-keeper` 已建，**cron `0 * * * *` 已挂上** |
| `deploy --secrets-file` 原子挂 secret | ✅ 部署输出里出现 `env.KEEPER_PRIVATE_KEY ("(hidden)")`，无任何交互 |
| `secret list` / `secret delete` | ✅ 挂载与删除都验证过，删完 `secret list` 返回 `[]` |
| 本地 `wrangler dev` 跑 GET 健康检查 | ✅ 地址、余额、gas、`maxDeviationPct=20`、`paused=false`、5 个资产全部正确 |
| 本地触发 scheduled 全链路 | ✅ 5 个资产逐个 ABI 编码 → 估气 → 发送；用 0 余额测试钱包验证，失败点正是「余额不足」，**无交易上链** |
| `setup.ps1` 语法与编码 | ✅ PowerShell 解析器 **0 错误**；**纯 ASCII**（0 个非 ASCII 字节），PS 5.1 不会读乱码 |

> ⚠️ **尚未在真实资金下跑过**：上面用的是余额为 0 的一次性测试私钥，
> 所以「交易真的上链并成功」这一步要等你转完 gas 后由第一次 cron 验证。

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
