# ZZZ Lend — 项目进度总览（PROGRESS）

> ⚠️ **正文是 2026-09-03 的快照**，保留作历史轨迹用。**当前状态请看**
> [`上链差距清单_2026-09-15.md`](上链差距清单_2026-09-15.md)（还差什么）
> 与 [`主网部署执行手册_2026-09-19.md`](主网部署执行手册_2026-09-19.md)（怎么执行）。
>
> **09-03 之后的进展**
>
> | 日期 | 事件 |
> |---|---|
> | 09-04 | 主网就绪部署模板、Safe 2/3 脚本、Base fork dress rehearsal（8/8）、Oracle 配置表、多签收口手册、冷启动方案 |
> | 09-15 | 全量代码审查：**2 High**（H1 前端读价源指向未部署合约且静默回落硬编码价；H2 `maxStaleness=3600` 与 feed heartbeat 86400 矛盾 → 平稳行情下借款/取抵押/清算大面积 revert）、7 Medium、14 Low。前端与部署脚本修复当日落地 |
> | 09-19 | 部署脚本在本地 Base fork **完整广播执行通过** + 23 项链上核验；确认 README 的"两步部署"流程跑不通（`DeployMainnet` 已自带收口） |
> | 09-27 | 积压 23 天的改动入库（3 个 commit）；新增一键上线编排器 `scripts/go-live.mjs`，dry-run 端到端 31/31 通过 |
> | 09-29 | 项目更名 **OrbitFi**；利率参数对标 Aave v3 Base 重调（**kink1 80%→90.5%、base 0.5%→2%、档位溢价下调**）；Safe 多签 2-of-3 创建并激活；新增 `docs/利率模型说明.md`、`docs/上线操作清单.md` |
>
> **仍拦在上链前**：多签地址未就绪、真实广播需部署者私钥与 Base ETH、**外部审计未做**、monitor 真名单与 keeper 未配。

> 更新：2026-09-03 ｜ 仓库：https://github.com/xzzz0371-maker/zzz-lend （main）
> 定位：风险分层 DeFi 借贷（测试网 Sepolia V2 多资产）；**尚处主网准备期，未上主网**。
> 关联：`docs/ZZZ_Lend_完整文档.md`、`docs/安全审计报告_V2多资产_2026-09-02.md`、`docs/archive/主网准备_本轮改动说明与遗留问题_2026-09-03.md`、`docs/archive/任务记录.md`（本机）。

---

## 1. 当前状态（一句话）
代码/测试层已到“可自闭环的主网准备就绪”，并已 5 次整组部署到 Sepolia（最新池带正确 D1 顺序）；**上主网仍有外部/治理前置项未完成（见 §3.2 剩余项），当前不建议上主网**。PROGRESS §3.1 两项（部署模板+补强测试）已完成；本轮又落地 §3.2 中三项可本环境完成的代码项：**上限风控、Timelock 治理接线、轮询监控脚手架**（见 §2.8–§2.10）。

### 关键基线
- 合约测试：**31 suites / 230 passed / 0 failed**（自 189 递增：+26 补强测试、+10 Caps、+4 TimelockGovernance、+1 ETH 档位回归）
- 工具（2026-09-03 cap 后重跑）：`forge test --fuzz-runs 5000` 通过；状态机不变式 4/4；**Slither 41 合约/102 检测器 0 findings**（`contracts/audit_v2/slither_2026-09-03_caps_final.txt`，本机）；coverage：**LendingPool 行 94.21% (521/553)**、RiskManager/LiquidationManager 100%
- 合约尺寸：LendingPool **21,486B**（< EIP-170 24576）
- 前端：`npm run build` 通过，Cloudflare Pages 在线（静态导出，连 Sepolia 当前池）；ABI 快照已随新 cap setter 重新导出
- 监控脚手架：`services/monitor`（TS+viem，tsc 通过，**真实 Sepolia RPC 冒烟通过**；webhook 告警渠道可选）

---

## 2. 已完成工作

### 2.1 V2 多资产架构（合约）
- 单池多市场：USDC/USDT/DAI 借贷市场 × ETH/wstETH/WBTC 抵押；每市场独立现金/供应指数/利用率/利率/储备/Treasury/坏账
- 精度全参数化（wadScale；6/8/18 位）；跨抵押品加权 LTV/LT 健康度；跨市场同 tier 借款；任意市场×任意抵押品清算；全局 tier（首借锁定）
- RiskManager 按抵押资产×档位（ETH/wstETH 同表，WBTC 保守表）；ReserveManager 按 token；InterestRateModel NORMAL 三段曲线（**2026-09-29 调整为 kink1 90.5% / kink2 95% / slope2a 40% / base 2% / slope1 3% / slope2 150%，对标 Aave v3 Base**）
- 为过 EIP-170 做了压缩：移除用户事件、合并 `marketAccounts` 视图、精简 V1 包装（存量测试改为 market0 显式入参）

### 2.2 代码修复（审计与实测发现，均已进测试/主网前代码）
- **D1（审计 High）坏账吸收顺序**：最终正确顺序 = 物理储备 → 账面储备 → 存款人(supplyIndex) → **Treasury 最后兜底**；已按此修正并第 5 次上链
- **全额还款一次清零**：`repay ≥ 债务` 时整笔清零，消除 floor 取整尘埃
- **SafeERC20**：LendingPool/ReserveManager 全部 ERC20 转账改为 safe 版（兼容无返回值 token）
- 跨市场坏账时保留全局 tier（早期缺陷修复 + 回归）
- handleBadDebt dust/守恒、多市场守恒与坏账隔离（invariant + 多市场测试）

### 2.3 前端修复（全部已部署上线）
- Health Factor 空仓位显示 ∞；余额/份额 6s+后台刷新；交易成功即全量刷新
- Approve 一次授权 max；池写交易固定 gas 1,000,000（修连续交易 OOG）
- Repay：Max 精确 token 串（去科学计数/浮点）+ 金额钳制不超过债务 + 小额 8 位显示
- ETH 抵押提款修复（`withdrawCollateral(address,uint256)`）；pending 按钮统一“Waiting for wallet…”
- Borrow：档位实时“当前档位可借上限”+ 禁用原因红字；删除假的“收益率细分”
- Stress Test：准备金覆盖率跨 3 市场合计 + 演示假设明确标注
- 首页多市场卡片、Dashboard 市场/抵押选择器、Position 多抵押展示

### 2.4 测试网部署（Sepolia，已 5 次整组部署）
| 次 | 内容 | LendingPool 地址 |
|---|---|---|
| 1 | V2 多资产初版（含压缩） | `0x02f0d3…Eef6`（已归档） |
| 2 | + collectTreasury(uint8) | `0x8c38…8726`（已归档） |
| 3 | + 全额还款一次清零 | `0xc666…9481`（已归档） |
| 4 | + D1(旧序)+SafeERC20 | `0x7BAc…E8c`（已归档） |
| **5（当前）** | **D1 正确顺序**（物理→账面→存款人→Treasury 最后） | **`0xA958E9Ab95CEaFF5f341947824bA2237745Ec07D`** |
- 演示播种：USDC 5000 / USDT 3000 / DAI 15000 供应 + 0.01 ETH 抵押 + 可设价价格 + treasuryAddress
- 历次旧池资产仍在旧地址（仅存档，站点不再引用）

### 2.5 文档
- `ZZZ_Lend_完整文档.md`：架构/资产表/参数/部署地址(§6.7)/V2 附录(§9)/主网上线 GO-NO-GO(§9.7)
- `安全审计报告_V2多资产_2026-09-02.md`：11 节完整审计（D1/M1/L1-4/I1-5、28 向量、10 专项、8+5 补充、Gate10、优先级）
- `主网准备_本轮改动说明与遗留问题_2026-09-03.md`：本轮改动/做到位/遗留问题与不确定性
- `接手指南.md`：V2 快速上手

### 2.6 本轮新增：主网就绪部署模板（DeployMainnet.s.sol）
- **参数化模板**：真实 Chainlink feed（逐资产 feed 地址）、多签（MAINNET_ADMIN=Owner/角色持有、MAINNET_TREASURY、可独立 MAINNET_PAUSER）、**默认禁 settable**（不部署 SwitchableOracle，池价格源直连 ChainlinkOracle）、token 白名单（ENABLE_* 开关 + 逐资产 token/feed 配置项）
- 上链前**预检**：token/feed 非零、代码存在、feed decimals 匹配、answer>0、新鲜度 ≤2h；enabled 白名单资产缺配置即 revert
- 角色收口：池/oracle/RiskEngine 三角色授给多签后**撤销部署者**；IRM/RM/ReserveManager `transferOwnership(多签)`
- `.env.example` 已补主网变量注释；产物写 `deployments/mainnet.json`（区别于测试网 `sepolia.json`）

### 2.7 本轮新增：四组补强测试（PROGRESS §3.1 收尾）
| 文件 | 数 | 覆盖 |
|---|---|---|
| `DirectedFuzz.t.sol` | 7 | repay 部分/全额/跨市场边界 fuzz；liquidate closeFactor 封顶、seize 非零上限、跨市场(WBTC/USDT)、连续清算到清仓或坏账 |
| `ExtremeMatrix.t.sol` | 4 | closeFactor 5/50/100%、bonus 0/5/20%、reserveTarget 0/1%/50%、6×2×2 多档下跌组合的自动矩阵（全新池逐场景，守恒+溢出断言，产物落 test-out/） |
| `BadDebtFrontrunSnapshot.t.sol` | 4 | 坏账窗口 front-run 快照：抢先提款者逃损 vs 无人抢先按份分摊；快照恢复幂等；bank-run 受池现金上限约束 |
| `AdminBranches.t.sol` | 11 | addMarket zero/ETH/越权/超 MAX_MARKETS(8)；addCollateral zero/超 MAX_COLLATERALS(8)；非法 marketId/collateral 全操作 revert；角色矩阵；reserveTarget=100% 边界 |

### 2.8 本轮新增：供应/抵押上限风控（LendingPool + Caps.t.sol）
- **代码**：`LendingPool` 新增每市场供应上限 `marketSupplyCap[market]`、每抵押品上限 `collateralCap[coll]` 与抵押品池内总量账本 `collateralTotal[coll]`（supply/withdraw/liquidate 同步维护）；`setMarketSupplyCap/setCollateralCap`（PARAM_ADMIN，0=不限制=向后兼容）；supply 检查“现供+本次 ≤ 上限”，抵押品 supply/withdraw/liquidate 均计入/扣减。
- **合约尺寸**：21,486B（仍 < 24576）。**注意：此为合约代码变更，Sepolia 已部署池为旧代码，未含 cap 字段；如需上链须整组重部署。**
- **测试**：`Caps.t.sol`（10）达上限拦截、提款/清算释放、0=不限制、权限、坏 id。

### 2.9 本轮新增：Timelock 治理（OZ TimelockController）
- **接线**：`DeployMainnet.s.sol` 支持 `MAINNET_TIMELOCK_MIN_DELAY>0` → 部署 OZ `TimelockController`，`admin`（多签）为 proposer/executor；PARAM_ADMIN/DEFAULT_ADMIN/Ownable 全部指向 timelock；PAUSER 仍由独立 `pauser` 快速熔断（不延迟）；部署者撤销。
- **测试**：`TimelockGovernance.t.sol`（4）参数变更必须延时执行、直接调用被拒、PAUSER 独立、IRM owner 移交后仅能经 timelock 改参。
- **说明**：主网真正启用仍需真实多签 + 选定 minDelay 后再跑一次部署（模板已具备）。

### 2.10 本轮新增：轮询监控/索引脚手架（services/monitor）
- 事件已移除 → 监控只能靠视图轮询。脚手架：每轮 `marketAccounts`/`getUserPositionV2`/`isLiquidatable`/`reserveManager.balanceOf`/`getAssetPrice`，产出 `out/alerts.log`（去抖告警：可清算/低 HF/坏账窗口/高利用率/储备不足/喂价失效）与 `out/metrics.jsonl`（全量快照，可作 Subgraph 输入）。
- 状态：TS + viem 编译通过；`config/positions.json` 配置盯梢市场/用户。生产告警渠道（Telegram/邮件）为后续项。

### 2.11 本轮新增：工具重跑与监控验证（A 组收尾）
- **Slither 重跑（cap 变更后）**：41 合约 / 102 检测器 / **0 findings**（本机 `audit_v2/slither_mainnet-final_2026-09-03.txt`）。
- **coverage 重跑**：`_liquidateCore` 局部变量过多导致无 viaIR 时 stack too deep → 将清算金额计算拆为 `internal view _liquidateAmounts`（语义不变，230 回归通过）。结果 **LendingPool 行 94.21%**。注：coverage 命令需 `forge coverage --ir-minimum --skip script`。
- **monitor 真网冒烟**：publicnode Sepolia RPC 单次轮询通过——正确读 3 市场现金（USDC 5000/USDT 3000/**DAI 15000**，0 借款）与 ETH 真价；对 Sepolia 池 wstETH/WBTC/USDC/USDT/DAI 主源（stale/mock）正确触发 CRITICAL（`out/alerts.log`/`out/metrics.jsonl`）。修 Windows 路径目录 bug。
- **告警渠道**：可选 `ALERT_WEBHOOK_URL` + **Telegram bot**（`TELEGRAM_BOT_TOKEN`/`TELEGRAM_CHAT_ID`，WARN/CRITICAL 推送）已接入；`.env.example`/README 更新。
- **Subgraph 完整索引**：仍属外部项（无事件流；可在脚手架 metrics 数据上自建索引或重新引入最小事件集后建 Subgraph）。

### 2.12 主网收尾专项（P0–P2）
- **P0 ETH 档位显式化**：Deploy.s.sol / DeployMainnet.s.sol 补 `_setRiskTiers(rm, ETH哨兵, …)`（RiskManager 构造本就预置 50/60/70/75/80；显式写入=防御加固）+ `_verifyEthTiers` 部署后校验（ETH 5 档 LTV 非 0、LT>LTV）+ `test_EthSentinelTiersNonZero_AfterDeployDefaults` 回归 → **230 passed**。
- **DAI 播种精度修复**：实测 Sepolia 当前池 DAI 现金原仅 **15 DAI（1.5e19）**（播种少 1000×，文档曾称 15000）→ 链上补供 14985e18 → DAI 现金=**15000e18**（tx 见任务记录会话 36）。
- **前端干净重建**：清 `.next`/`out` → `npm run build`（8 路由静态导出）→ 引用资源 0 缺失、地址=第 5 次池 `0xA958…07D`。**Cloudflare 部署待有效凭据**（传入 token 无效 code 9109）。
- **工具重跑存档**（本机 `audit_v2/`）：Slither 41/102/0、coverage LendingPool 94.21%。
- 文档：D1 顺序统一为“物理→账面→存款人→Treasury 最后”（主网准备 §3.1#1 修正、删除 treasury 承担讨论）；AuditPoc 注释更新。

### 2.13 Base 主网第二阶段专项（Oracle 配置 / fork rehearsal / 多签收口 / 冷启动）
- **Oracle 真实配置（任务1）**：从 docs.chain.link 地址页 SSR + **Base 主网 RPC 链上实测**核对 5 个官方 feed（ETH/USDC/USDT/DAI/cbBTC，desc/decimals/answer/新鲜度全过）。**关键结论：Base 无官方 wstETH/ETH 或 wstETH/USD**（仅有 wstETH/stETH；stETH/ETH 检索实为 Inception instETH/ETH）→ **Base V1 禁 wstETH**（`ENABLE_WSTETH=false`，合约保留支持）；BTC 抵押采用 **cbBTC**（Base 生态标准，官方 cbBTC/USD `0x07DA0E…`）。`DeployMainnet.s.sol` 内建 Base 官方 token/feed 默认值 + 预检新鲜度放宽 26h（稳定币偏差型 10h+ 更新）。交付 `docs/主网Oracle配置表.md`、`scripts/feed-health-check`（TS+viem，5/5 OK）。
- **fork dress rehearsal（任务2）**：`test/ForkMainnet.t.sol`（fork-only，chainId 8453 判定 skip）——真实 Chainlink feed 只读 + Mock 同精度代币（因 Base 真 token fork 上 approve 不可用，见报告），全流程 **8/8 passed**（供应/抵押/借款/还款/提现/清算/坏账/守恒）。交付 `docs/Fork主网dress rehearsal报告.md`。
- **多签/Timelock 收口（任务3）**：Safe Base 官方地址核验（factory `0x4e1D…`、Safe1.4.1 `0x4167…`、SafeL2 `0x29fc…`、handler `0xfd07…`）；`script/MainnetDeployAndTransfer.s.sol`（Step4–11 收口流程）；交付 `docs/主网多签与权限收口手册.md`。
- **冷启动与运营（任务4）**：交付 `docs/冷启动与运营方案.md`（流动性 A/B/C 评估+推荐、限额与提升时间表、获客渠道、监控指标、收入预测与盈亏平衡结论）。
- 全量：`forge test` 32 suites / **230 passed** + 1 fork skipped（`ForkMainnet` 需 `--fork-url https://mainnet.base.org`）。

---

## 3. 未完成待办

### 3.1 本环境可继续（已完成）
- ✅ Deploy 脚本“主网就绪”参数化模板（真实 feed / 多签 / 默认禁 settable / token 白名单配置项）→ `script/DeployMainnet.s.sol`
- ✅ 补强测试：repay/liquidate 定向 fuzz、closeFactor/bonus/reserve 极值矩阵、坏账 front-run 快照、addMarket/admin 分支覆盖 → 见 §2.7（29 suites / 215 passed）
- ✅ 本轮新增代码项（§3.2 中可自闭环的三项）：供应/抵押上限风控、Timelock 治理接线、轮询监控脚手架 → §2.8–§2.10（31 suites / 229 passed）

### 3.2 外部 / 需决策（部分已落地，写入 §9.7）
1. 外部第三方安全审计 + 修复回归 —— ❌ 未做
2. 主网真实 Chainlink feed（含 wstETH 合成）+ 移除 Mock/可设价 —— ⚠️ 模板已参数化，未真网执行
3. 主网 fork dress rehearsal —— ❌ 未做
4. 多签 + Timelock 治理；撤销部署者、隔离 Pauser/Treasury —— ✅ 代码/测试落地（§2.9）；真网执行待治理
5. 事件/索引（Subgraph）+ 清算与异常监控告警 —— ⚠️ 轮询脚手架已建（§2.10）；Subgraph 与告警渠道未做
6. 坏账 front-run 公平策略（提款队列/锁窗/公示承担模型） —— ❌ 未做（front-run 快照已固化权衡）
7. 代币白名单 + 供应/抵押上限风控 + 真实历史 APY —— ✅ 白名单(§2.6)与上限(§2.8)已落地；真实历史 APY 未做

---

## 4. 关键决策记录
| # | 决策 | 依据/备注 |
|---|---|---|
| K1 | V2 采用“单池多市场”方案（非每资产一池） | 复用 V1 记账闭环；已实现 3 市场×3 抵押 |
| K2 | tier 为全局仓位属性（跨市场同档，首借锁定） | 与 V1 语义一致，避免跨市场档位套利 |
| K3 | 按抵押资产分档 LTV/LT（WBTC 保守） | 需求指定 |
| K4 | 合约不可升级（无 proxy） | 已证明；任何修复=整组重部署+旧池归档。主网上线前需再评估是否引入升级方案 |
| K5 | 用户事件移除（为过 EIP-170） | 监控靠视图/轮询；主网需 Subgraph 补齐（未做） |
| K6 | 演示/测试网使用 SwitchableOracle 可设价 | USDC/USD feed stale + 其余无 Sepolia feed；**非主网方案** |
| K7 | 池写交易固定 gas 1,000,000；Approve 一次 max | 修复连续 OOG 与重复授权体验 |
| K8 | D1 坏账吸收顺序：物理→账面→存款人→**Treasury 最后** | 用户复核纠正（Treasury 是最后防线）；已上链 |
| K9 | 全额还款一次清零（repay ≥ 债务） | 消除尘埃尾巴；部分还款仍按取整 |
| K10 | SafeERC20 + “仅标准 ERC20”原则 | 兼容无返回值 token；禁 fee-on-transfer/rebasing |
| K11 | 94/4/2 分成、储备目标 ~3%、三段利率初值 | 需求给定，待真实流量验证 |
| K12 | “测试网功能版 ≠ 可上主网” | GO/NO-GO 见 §9.7；自审不替代外部审计 |
| K13 | cap 用“0=不限制”默认，向后兼容；账本 `collateralTotal` 随 supply/withdraw/liquidate 维护 | 新增存储与记账不破坏既有 189 语义；**Sepolia 已部署池为旧代码（无 cap）** |
| K14 | 治理：governance 持 PARAM/DEFAULT/Owner，PAUSER 独立快速熔断；可选 OZ Timelock 包裹 | 满足“多签+Timelock+撤销部署者+隔离 Pauser/Treasury”；Timelock 默认关闭，主网启用需真网再跑 |

---

## 5. 风险与不确定（摘要）
详见 `docs/archive/主网准备_本轮改动说明与遗留问题_2026-09-03.md`，要点：无外部审计；Oracle 中断锁“有债用户”降险；事件缺失靠轮询（脚手架已建 + 真网冒烟通过，Subgraph/告警渠道正式化待做）；坏账 front-run 无延迟；wstETH 真实兑换率/合成 feed 未验证；Sepolia 演示掩盖 feed 可用性（monitor 冒烟已实测 wstETH/WBTC 主源 stale → CRITICAL 正确）；Smart Account（第三方钱包模块）兼容与报错提示待打磨；历次归档旧池资产需注意；**cap/Timelock 为合约代码变更，Sepolia 当前池尚未包含（待整组重部署）；cap 上限值、Timelock minDelay 均为主网配置决策**。

---

*本文档为进度总览，随项目推进更新；详细技术内容以主文档与专项文档为准。*
