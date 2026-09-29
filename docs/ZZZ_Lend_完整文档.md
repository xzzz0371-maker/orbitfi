# ZZZ Lend — 完整项目文档

> **单一总文档**：汇总产品、架构、合约、阶段进度、测试、安全、部署与待办（原分阶段/交接/配置文档已并入后删除）。
> 归总日期：2026-08-29（**V2 多资产更新：2026-09-02；测试补强/主网模板/上限/Timelock/监控：2026-09-03**）
> 新接手者先读 \docs/接手指南.md\（快速上手/关键实现/部署运维）。 ｜ 状态：阶段 7/8 已实现（2026-08-31/09-01）＋ **阶段 9 多资产 V2（2026-09-02，单池多市场：USDC/USDT/DAI 借贷 × ETH/wstETH/WBTC 抵押）已实现并部署 Sepolia**（见 `frontend/README.md`） ｜ 测试：31 suites / 230 passed（行覆盖：LendingPool 92%+ / LiquidationManager 100% / RiskManager 100%）
> ⚠️ 本文档按 V1 单市场撰写；**多资产 V2 全部改动与新增资产表见第 9 章（2026-09-02）**，正文中冲突处以第 9 章为准。

---

# 第 1 部分 项目概述

## 1.1 一句话定位

> **ZZZ Lend 是一个以资本效率和风险透明定价为核心的 DeFi 借贷协议，让用户自主选择 LTV 风险档位，并根据真实借款利率、资金利用率、预期损失和协议费用实时计算预估收益。**

核心不是复制 Aave，而是 **"用户自己选择风险，系统实时给风险定价。"**

## 1.2 核心产品理念

- 存款人存入 **USDC/USDT/DAI**（各自独立市场）获得动态预估 **Supply APY**（不构成固定收益承诺）；借款人抵押 **ETH / wstETH / WBTC**（跨资产共享、按资产分档）借出稳定币。
- **五档 LTV**：50% / 60% / 70% / 75% / 80%（按抵押资产分别校准，WBTC 用保守表 45/55/65/70/75%）；**LTV 越高 → 利率越高 → 风险越高**。
- 80% 是高风险档位，**不是固定收益承诺**。
- 收益动态计算链路：
  - `Gross Yield = Borrow APR × Utilization`
  - `Expected Loss = Default Probability × Loss Given Default`
  - `Estimated Net Yield = Gross Yield − Expected Loss − Protocol Fee`
- 三个收益率分离：**Projected / Current / Realized APY**。
- 必须建立 **Risk Reserve**、**Health Factor**、**Liquidation**、**Stress Test**、**历史数据**。
- 铁律：**不承诺固定收益、不隐藏坏账、公开利用率/储备/清算数据**。

## 1.3 当前阶段状态

| 阶段 | 内容 | 状态 |
|---|---|---|
| 产品/架构设计 | 见本文档第 1.4/2 节（已并入） | ✅ |
| 1 开发环境 | Git + Foundry 1.8.1 + OpenZeppelin v5.7 + lint + Anvil | ✅ |
| 2 业务合约 | LendingPool / 分层 LTV / HF / 清算 / 坏账 / 三套利率预设 | ✅ |
| 2 补充验证 | 压力矩阵 / 重入 / 精度 / 部分还款 | ✅ |
| 4 专项测试 | 以测试形式完成（并入 2/6） | ✅ |
| 6 Oracle + 风险引擎 | ChainlinkOracle / SwitchableOracle / RiskEngine / 坏账即时传导 / minSeize | ✅ |
| 7 Sepolia 部署 | 脚本 + 本地广播验证完成；**链上广播待凭据** | 🔶 |\n| 7.1 安全改进 | ETH转账call / USDC脱锚计价 / 偏差不revert / RiskEngineAuto / 事件补全 / 清算时间差 / 覆盖率 | ✅ 已完成 |
| 7.2 参数与边界 | maxDeviation 默认 30%；异常价禁止新增借款/抵押 | ✅ 已完成 |
| 8 前端 | **Next.js 14 Dashboard 已实现**（Home/Dashboard/Stress Test/History/About，全英文，连接 Sepolia），见 `frontend/README.md` 与 `docs/archive/前端_验证报告_v1.0.md` | ✅ 已完成 |
| 3/5/9/10 | Sepolia E2E 真跑、回测、审计、主网 | ⏳ |
| **9 多资产 V2** | 单池多市场（USDC/USDT/DAI 借贷 × ETH/wstETH/WBTC 抵押）、按资产五档 LTV/LT、跨市场同 tier 借款、任意抵押×市场清算、每市场独立利率/储备/坏账、前端多市场卡+选择器；部署 Sepolia（2026-09-02） | ✅ 已完成（详见第 9 章） |

## 1.4 产品设计详解

### 80% LTV 是高风险档
80% 不代表"保证借 80%"，而是"最高风险档位，用户愿意承担更高风险换取更高资本效率"。
80% LTV → 更高风险 → 更高 Borrow APR → 更高潜在 Supply APY。

### 收益率必须实时变化且三分离
- **Projected APY**：模型预测；**Current APY**：当前实时（随利用率/利率/风险变化）；**Realized APY**：真实历史。
- 展示示例：`Borrow APR ~20.00% / Utilization ~80.42% / Gross Yield ~16.08% / Expected Loss ~-1.12% / Protocol Fee ~-1.00% / Estimated Net APY ~13.96%`。
- *以上均为预估收益，随市场利率和资金利用率实时变化，不构成固定收益承诺*。

### 资金流
```
存款人 USDC → LendingPool ─→ 借款人（抵押 ETH 独立记账）
借款利息 → 存款人收益 + 风险储备 + Treasury
```

### 风险储备（Risk Reserve）
利息按**固定费率**分配：存款人 94% / 风险储备 4% / Treasury 2%（合计 100%）。储备目标 = `totalBorrows × 3%`：每次计息后，储备总资产（账面 `totalReserve` + 物理 `ReserveManager` 余额）超过目标的部分自动溢出转入 Treasury（事件 `ReserveOverflowTransferred`）。溢出从**账面 `totalReserve`** 划转；**物理储备（`ReserveManager` 余额）只被坏账消耗，不直接转入 Treasury**（安全设计：储备金只能回注池）。**当 `totalBorrows = 0` 时目标为 0，但**不触发溢出**，储备保留**，待借款恢复后按新目标继续计息。风险储备是**第一损失缓冲**：坏账发生时先由储备覆盖，储备不足部分即时降低 `supplyIndex`，由所有存款人按份额承担（类似基金净值下跌），不挂账、无需核销。Treasury 由 `collectTreasury()`（任何人可调）归集：将 `treasuryAccrued` 全部转给 `treasuryAddress` 并**清零**，`treasuryAddress` 为零地址时 revert。

### 风险来源（不止违约率）
市场、清算（价格急跌来不及清算）、流动性（抵押物无买盘）、Oracle（异常/延迟）、智能合约、坏账、收益率（利用率下降）、极端行情（ETH -30%~-50%）。

### Health Factor 状态灯
🟢 Healthy / 🟡 Warning / 🟠 High Risk / 🔴 Liquidation（HF<1）。

### 压力测试（已实现为 StressTest）
用户可模拟 ETH -10/-20/-30/-40/-50%，查看 LTV/HF/是否清算。

### 动态风险引擎
LTV 档位可随市场调整（正常/高波动/极端三套预设；极端暂停高 LTV 档）。

### 用户界面（规划）
首页展示 Total Supply / Borrow / Utilization / TVL / Supply APY / Borrow APR / Risk Reserve，并提供 **Choose Your Risk** 五档选择。

### ZZZ vs Aave
| Aave 类传统 | ZZZ Lend |
|---|---|
| 固定风险参数 | **风险分层** |
| 只看利率 | **同时看风险** |
| LTV 是参数 | **LTV 是用户选择** |
| APY | **Projected/Current/Realized** |
| 风险信息专业 | **风险可视化** |

### 赚钱方式
① Borrow Spread（借款人付 20%、存款人拿 ~14%，差价=协议收入）② Protocol Fee（利息一定比例进 Treasury）③ 未来：清算费/Vault/机构借贷。

### 项目原则
不承诺固定收益、不隐藏坏账、不只展示 APY、公开利用率/历史表现/风险储备/清算数据、让用户看到最坏情况。

### 核心公式
`Gross Yield = Borrow APR × Utilization`；`Expected Loss = PD × LGD`；`Net = Gross − Expected Loss − Protocol Fee`。

---

## 1.5 收益展示规范（强制）

### 1.5.1 核心原则

- 所有档位（50% / 60% / 70% / 75% / 80%）的收益均为预估，**没有任何一档是固定收益**。
- 高 LTV 档**不是**"高收益固定产品"，而是"**高风险、高潜在收益、高波动**"的档位。
- 低 LTV 档也**不是**"保本理财"，同样存在坏账风险和收益率波动。
- 任何收益数字前必须加"预估 / 预计 / ~"，首次出现 APY 必须标注"不构成固定收益承诺"。
- 存款本金可能因坏账而受损：坏账超出风险储备缓冲的部分由存款人按份额承担（`supplyIndex` 即时下降），类似基金净值下跌。

### 1.5.2 前端展示规范（阶段 8 必须遵守）

每个 LTV 档位卡片**必须**包含：

1. 档位名称和 LTV 数值（如 `Tier 5 · LTV 80%`）
2. **预估 APY**（数字前必须有"~"，如 `~13.96%`）
3. 收益拆解入口（点击展开显示 `Gross Yield / Expected Loss / Protocol Fee / Reserve`）
4. 风险等级标签（低 / 中 / 较高 / 高 / 极高）
5. 每档标注 **"Estimated, not guaranteed"**
6. 底部小字：`*预估收益，随市场利率和资金利用率实时变化，不构成固定收益承诺*`

#### 示例卡片

```
┌────────────────────────────────────────────┐
│  Tier 5 · LTV 80%                 [风险 极高] │
│  预估 APY: ~13.96%                          │
│  ─────────────────────────────────────────  │
│  ▼ 收益拆解（点击展开）                      │
│     Gross Yield      ~16.08%                │
│     Expected Loss    ~-1.12%                │
│     Protocol Fee     ~-1.00%                │
│     Reserve          ~-0.00%                │
│  ─────────────────────────────────────────  │
│  *预估收益，随市场利率和资金利用率实时变化，   │
│   不构成固定收益承诺*                        │
└────────────────────────────────────────────┘
```

---

## 1.6 前端界面与风险披露规范（强制·阶段 8 必须遵守）— v1.0 · 2026-09-01（已按本规范实现，见 `frontend/`）

1. **前端界面全部使用英文**，不出现中文宣传性文案。
2. **存款页面**必须显著展示风险提示：
   > "Deposits are not guaranteed. Your principal may decrease due to bad debt, similar to a fund whose NAV can decline."
3. **取款页面**展示当前可用流动性：
   > "Available Liquidity: $XX,XXX. Withdrawals may fail if pool liquidity is insufficient."
4. **首页**展示历史最大回撤（Max Drawdown）：
   > "Historical Max Drawdown: X.X%"
5. **所有 APY 数字标注 "Estimated"**，禁止使用 "Guaranteed" / "Fixed" / "Stable" 等表述。
6. 收益拆解展示：`Gross Yield / Expected Loss / Protocol Fee / Reserve`。
7. **五档 LTV 卡片每档标注 "Estimated, not guaranteed"**。
8. 每个 LTV 档位卡片遵循 §1.5.2 的展示规范（含预估 APY、收益拆解、风险标签、底部小字）。

---

# 第 2 部分 系统架构与技术选型

## 2.1 分层架构

```
用户/前端（Next.js 已实现）                数据服务（规划）
   │  viem/wagmi                    │  REST/WS
   ▼                                ▼
Wallet (EIP-1193)          ZZZ Backend（风险展示/历史/建议）
   │  tx                            │
   ▼                                ▼
┌────────────── 链上 (Sepolia) ──────────────┐
│ LendingPool（存/借/清算/坏账/储备）           │
│   ├─ InterestRateModel（利率+预设）          │
│   ├─ RiskManager（LTV档/清算参数）           │
│   ├─ LiquidationManager（清算数量）          │
│   ├─ ReserveManager（风险储备）             │
│   ├─ ChainlinkOracle（价格，含安全机制）      │
│   └─ RiskEngine（风险等级+波动率，只建议不执行）│
└──────────────┬──────────────────────────┘
               │ Chainlink Aggregator (ETH/USD, USDC/USD)
```

## 2.2 技术选型

| 领域 | 选型 |
|---|---|
| 合约框架 | Foundry 1.8.1（forge/anvil/cast） |
| 依赖 | OpenZeppelin Contracts v5.7.0、forge-std |
| Solidity | 0.8.24 / EVM cancun / optimizer 200 runs / via_ir |
| Oracle | Chainlink（ETH/USD、USDC/USD），带 stale/deviation/fallback/pause |
| 前端 | Next.js 14 + TypeScript + viem/wagmi + Tailwind（**已实现**，`frontend/`，连接 Sepolia） |
| 数据层 | The Graph Subgraph（规划）；`services/` 已预留 |
| 测试链 | Anvil（本地）/ Sepolia（测试网） |

---

# 第 3 部分 合约模块详解

## 3.1 合约清单（`contracts/src/`）— v1.0 · 2026-08-31

| 合约 | 作用 | 是否持资金 |
|---|---|---|
| `LendingPool.sol` | 主合约（**V2 多市场**）：市场注册（借贷资产）+ 抵押品注册；每市场 supply/withdraw、独立利用率/供应指数/储备/Treasury/坏账；borrow/repay/liquidate（任意市场债务 × 任意抵押品）；全局 tier（首笔借款锁定，跨市场同档）；多抵押加权 LTV/LT 健康度；HF/暂停 | ✅ USDC+USDT+DAI+ETH+wstETH+WBTC |
| `InterestRateModel.sol` | Utilization→Borrow APR（base+两段斜率+kink+每档溢价）；**三套市场预设** NORMAL/HIGH_VOL/EXTREME（纯公式，市场无关，各市场用自身利用率调用） | ❌ |
| `RiskManager.sol` | **V2 按抵押资产 × 档位** `tierConfig[token][tier]={maxLTV, liquidationThreshold}`；bonus 5%、close factor 50%、maxBorrowTier；ETH 哨兵档位构造预置 + 单 token 便捷读写（V1 兼容） | ❌ |
| `LiquidationManager.sol` | 清算没收量计算（USD 值，bonus 封顶抵押总额；资产无关，可复用） | ❌ |
| `ReserveManager.sol` | **V2 按 token 储备**：`defaultToken`（构造传入）+ `coverBadDebt(address token,uint256)` / `balanceOf(token)`；仅池可调；无任意取款 | ✅ 储备 |
| `oracle/ChainlinkOracle.sol` | Chainlink 适配器：按资产 feed 注册（ETH/USDC 真 feed；其余资产 Sepolia 无官方 feed → 部署时挂 MockAggregator feed）；8 位小数、freshness/deviation/fallback/pause | ❌ |
| `oracle/SwitchableOracle.sol` | 可切换预言机：主源=Chainlink；PAUSER 切到"管理员可设价"模式做清算/演示，按资产设价 | ❌ |
| `risk/RiskEngine.sol` | 风险等级（LOW/MED/HIGH/EXTREME）+ 波动率采样（按资产）+ 阈值（带上下限），**只输出建议**（基于默认 USDC 市场读数） | ❌ |
| `interfaces/IPriceOracle.sol` | 价格接口（按资产 `getAssetPrice(address)`，无缝替换 Mock/Chainlink） | — |
| `mocks/` | MockUSDC(6) / **MockToken（通用精度）→ MockUSDT(6)/MockDAI(18)/MockWstETH(18)/MockWBTC(8)**、MockPriceOracle、MockAggregatorV3 | — |

## 3.2 关键参数默认值 — v1.0 · 2026-08-31（参数变更后更新本表日期）

**五档 LTV / 清算阈值**（v1.0 · 2026-08-31）
| 档 | 最大 LTV | 清算阈值 | 利率溢价(t1..t5 基础之上) | 预估收益特征 |
|---|---|---|---|---|
| 1 🟢 | 50% | 60% | 0 | 预估，不承诺固定收益 |
| 2 🟡 | 60% | 70% | +0.5% | 预估，不承诺固定收益 |
| 3 🟠 | 70% | 78% | +1.5% | 预估，不承诺固定收益 |
| 4 🔴 | 75% | 85% | +3% | 预估，不承诺固定收益 |
| 5 🔴 | 80% | 90% | +6% | 预估，不承诺固定收益 |

**三套利率预设**（NORMAL / HIGH_VOL / EXTREME，v1.0 · 2026-08-31；NORMAL 三段式 v1.4 · 2026-09-02；**NORMAL 参数对标 Aave v3 Base 调整 v1.5 · 2026-09-29**）
| 预设 | base | slope1 (0..kink1) | kink1 | 中段 slope2a (kink1..kink2) | 末段 slope2 (>kink2) | kink2 | 溢价(t1..t5) | 高LTV档 |
|---|---|---|---|---|---|---|---|---|
| NORMAL | **2%** | **3%** | **90.5%** | **40%** | **150%** | **95%** | **0/0.5/1/1.5/2.5%** | 开放 |
| HIGH_VOL | 2% | 20% | 65% | 150%* | 150% | 65%* | 0/1/3/5/8% | 开放 |
| EXTREME | 5% | 40% | 50% | 300%* | 300% | 50%* | 0/2/5/8/12% | **tier4/5 暂停** |

> NORMAL 三段利率（tier1）：u≤90.5%：`2% + 3%×u`；90.5%<u≤95%：`4.715% + 40%×(u−90.5%)`；u>95%：`6.515% + 150%×(u−95%)`。边界：**80%→4.40%、90.5%→4.72%、95%→6.52%、100%→14.02%**。
>
> 拐点 90.5% 直接对标 Aave v3 的 `U_optimal`；@90% 利用率下 T1 借款 **4.70%**、存款 APY **3.98%**（Aave v3 Base 分别为 ~4.6% / 3.80%）。旧参数（kink1=80%）在 90% 处要 7.45%，比 Aave 贵 62%，会把借款人推走。详见 `docs/利率模型说明.md`。
>
> HIGH_VOL/EXTREME 的 kink2=kink1（中段宽度 0，标 *），曲线与历史两段一致；`kink2/slope2a` 可由 owner 经 `setKink2/setSlope2a` 配置。

**ChainlinkOracle 安全阈值**（v1.0 · 2026-08-31）
| 参数 | 默认 | 范围 |
|---|---|---|
| maxStaleness | 3600s(1h) | 300s~7天 |
| maxDeviation | 30% | 10%~200% |
| fallbackMaxAge | 86400s(1天) | 1h~30天 |
| pause 行为 | revert "oracle paused" | — |

**RiskEngine 判定阈值**（四因子取最高档，v1.0 · 2026-08-31）
| 因子 | LOW | MEDIUM | HIGH | EXTREME |
|---|---|---|---|---|
| 年化波动率 | <30% | 30-60% | 60-100% | ≥100% |
| Utilization | <50% | 50-75% | 75-90% | ≥90% |
| LTV/LT 比值 | <0.6 | 0.6-0.8 | 0.8-1.0 | ≥1.0 |
| 流动性 | ≥25% | ≥10% | ≥1% | <1% |

**池参数**（v1.3 · 2026-09-01，V2 下市场 0=USDC 与全局费率沿用）：固定费率（存款人 94% / 储备 `reserveFactor=4%` / Treasury `treasuryFactor=2%`）、储备目标 `reserveTargetRatio=3%`（按**各市场各自借款总额**、超出自动溢出转该市场 Treasury）、清算 bonus=5%、close factor=50%、supplyIndex 起始 1e18、**最小金额（按精度缩放，整 token 计）**：`MIN_SUPPLY=10`、`MIN_BORROW=100`、`MIN_COLLATERAL=0.01`（如 USDC/USDT→`10e6/100e6`、DAI→`10e18/100e18`、WBTC 抵押→`0.01e8`）。

### 3.2.1 多资产 V2 资产表（2026-09-02，详见第 9 章）

**借贷市场（每资产独立市场：现金/供应指数/利用率/利率/储备/Treasury/坏账各自独立，共享 InterestRateModel 参数但用各自利用率独立运行）**

| 市场 id | 资产 | 精度 | 最小存款 | 最小借款 | 价格源（部署） |
|---|---|---|---|---|---|
| 0（默认） | USDC | 6 | 10 USDC | 100 USDC | 真实 USDC/USD feed（常 stale，演示用可设价） |
| 1 | USDT | 6 | 10 USDT | 100 USDT | MockAggregator feed（Sepolia 无官方） |
| 2 | DAI | 18 | 10 DAI | 100 DAI | MockAggregator feed（Sepolia 无官方） |

**抵押品（跨市场共享，按资产分档）**

| coll id | 资产 | 精度 | 最小抵押 | 五档 LTV / 清算阈值 | 价格源（部署） |
|---|---|---|---|---|---|
| 0（默认） | ETH（原生） | 18 | 0.01 ETH | 50/60/70/75/80 ｜ 60/70/78/85/90 | 真实 ETH/USD feed |
| 1 | wstETH | 18 | 0.01 wstETH | 同 ETH（1:1 锚定表） | MockAggregator feed |
| 2 | WBTC | 8 | 0.01 WBTC | **45/55/65/70/75** ｜ 55/65/75/80/85（保守） | MockAggregator feed |

> 注：Sepolia 无 USDT/DAI/WBTC/wstETH 官方 Chainlink feed → 部署脚本对这些资产注册 **MockAggregatorV3 feed**（固定价 1/1/100000/3000 USD），链上主源即可读价；真实链上 USDC/USD feed 常 stale，演示/测试统一用 `SwitchableOracle.enableSettable()` + 按资产 `setPrice(...)` 提供确定价格（见 6.5/9.4）。上线主网前须换真实 feed（wstETH 可用 wstETH/ETH × ETH/USD 合成）。

## 3.3 资金流与不变式 — v1.0 · 2026-08-31

- 资金流：存款人 USDC → 池 → 借款人；借款人 ETH → 抵押（独立记账）；利息 → 存款人 94% + 风险储备 4% + Treasury 2%。
- **核心不变式**：`cash + totalBorrows == getTotalSupply() + totalReserve + treasuryAccrued`（每笔操作后测试断言）。
- **V2 按市场不变式**：`marketAccounts(m).cash + borrows == supply + reserve + treasury`（逐市场，MultiAsset 套件逐市场断言；大份额 18dp 市场计息后存在 ≤totalShares/WAD 的取整余数，用容差断言）。
- 坏账（即时传导）：抵押归零仍有债 → `handleBadDebt`（任何人可调）先由风险储备（第一损失缓冲）覆盖可覆盖部分，未覆盖部分即时降低 `supplyIndex`，由所有存款人按份额承担损失；仓位一次性清零，**不挂账、无 `settleBadDebt`**。事件 `BadDebtRealized(user, badDebtAmount, coveredByReserve, lossToDepositors, oldSupplyIndex, newSupplyIndex)`。
- 储备溢出：每次计息后，储备总资产（账面 + 物理）超过 `totalBorrows × 3%` 的部分溢出转 Treasury（事件 `ReserveOverflowTransferred`）；溢出只从**账面 `totalReserve`** 划转，物理储备仅由坏账消耗；`totalBorrows = 0` 时不触发溢出，储备保留。
- 清算：HF<1 可清算，close factor 50%，清算人按 105% 估值没收 ETH；`liquidate(...,minSeizeAmount)` 支持最低没收量（0=不限）。
- **V2 多市场清算**：`liquidate(target, marketId, collToken, debtToCover, minSeize)` 支持**任意市场债务 × 任意抵押品**；没收额按所选抵押品当前价格换算并以该抵押品余额封顶（同 V1 封顶抵押总额后再按币种换算，永不超收）。
- **V2 tier 语义**：tier 为**全局仓位属性**——用户在任意市场首次借款即锁定 tier，之后所有市场借款必须同档（`userGlobalTier`）；健康度/可借能力按抵押品逐项 `value × LTV/LT(token, tier)` 加权求和。坏账在单市场清零债务时，若其它市场仍有债务则**保留**全局 tier（回归测试 `test_BadDebtOneMarketKeepsGlobalTierForOtherDebt` 覆盖）。

## 3.4 权限模型 — v1.0 · 2026-08-31

- LendingPool / ChainlinkOracle / RiskEngine：AccessControl 三角色（DEFAULT_ADMIN / PARAM_ADMIN / PAUSER，PAUSER 仅前两者有）。
- InterestRateModel / RiskManager / ReserveManager：Ownable。
- 管理员能：改参数/换模块地址/暂停/切预设；**不能**：动用户存款/抵押、绕过 LTV/HF/清算规则、注入任意价格、直接降低 `supplyIndex`（只能经 `handleBadDebt` 触发）、RiskEngine 不触碰资金。
- 风险引擎：只输出风险等级与建议，参数调整必须 PARAM_ADMIN/PAUSER 手动执行。

> **注（2026-09-01）**：Early Deposit Boost 已按产品决策**完全移除**（无补贴方案），不另设章节；收益完全来自 94/4/2 分成。前端利率展示改为透明化（利率范围 / 7D / 浮动提示），见 §1.6 与 `frontend/README.md`。

---

# 第 4 部分 测试体系与结果

## 4.1 测试总览 — 2026-09-03（每次跑完测试更新本表日期/用例数）

```
forge test:  31 suites, 230 passed, 0 failed, 0 skipped
forge fmt --check: 通过
```

> V2 备注：`BaseSetup.t.sol` 为 V1 语义基座（市场 0/ETH），`BaseSetupV2.t.sol` 在其上注册 USDT/DAI 市场与 wstETH/WBTC 抵押、配置 oracle 价格与各资产档位，并提供市场级守恒辅助。LendingPool 为通过 EIP-170（24576B）已做精简（去掉 V1/V2 用户操作事件与部分视图合并），事件相关断言改为状态断言，见 `Events.t.sol`。

| 测试文件 | 用例 | 覆盖 |
|---|---|---|
| LendingPool.t.sol | 14 | 存取/借贷/档位LTV/tier锁定/还款/利息/比例分配/利用率/流动性限制/HF |
| InterestRateModel.t.sol | 7 | 利率曲线/kink/档位溢价/权限/边界 |
| RiskManager.t.sol | 6 | 默认档位/LTV校验/HF/权限/边界 |
| Liquidation.t.sol | 7 | 健康不可清算/价格下跌清算/close factor/禁自清算/坏账兜底 |
| ReserveManager.t.sol | 7 | 储备分成/skim/仅池可调用/零地址/无任意取款 |
| Permissions.t.sol | 8 | 角色隔离/暂停语义/管理员不可挪用 |
| StressTest.t.sol | 1(30场景) | 6跌幅×5档：HF、清算时机、坏账、资金守恒、储备兜底 |
| Security.t.sol | 3 | borrow/withdraw/liquidate 重入被 Guard 拦截 |
| Precision.t.sol | 6 | 1微USDC存取/借贷/清算、向上取整、部分取款不超 |
| Repay.t.sol | 5 | 多次小额还款/档位锁定/超额封顶/复利正确 |
| RatePresets.t.sol | 6 | 三套预设曲线/切换权限/EXTREME暂停高LTV档 |
| Oracle.t.sol | 11 | 正常读取/stale/偏差事件化+29/31%边界/fallback+pause/参数权限/removeFeed/异常价禁借+清正常 |
| SwitchableOracle.t.sol | 7 | 默认走主源/切换可设价/设价权限/切回主源/PAUSER切换/暂停/与LendingPool清算集成 |
| RiskEngine.t.sol | 12 | 四级判定/波动率精度/不触碰资金/阈值边界/非法liquidity/calculateRiskLevelAuto |
| EthTransfer.t.sol | 3 | 合约收款不失败/清算转ETH给合约/重入仍被Guard拦截 |
| UsdcPeg.t.sol | 5 | USDC=1一致/溢价抬LTV降HF/脱锚降LTV抬HF/溢价触发清算/零价revert |
| Events.t.sol | 6 | Borrowed/Repaid/Liquidated/InterestAccrued/BadDebtRealized/OracleSwitched 事件参数 |
| LiquidationTimeGap.t.sol | 1(9场景) | 1h/6h/24h × 续跌5/10/20%：利息累计/坏账扩大/守恒 |
| BadDebt.t.sol | 9 | 坏账即时传导：储备充足 supplyIndex 不变 / 储备不足与为零时降 supplyIndex / 多存款人等比例受损 / 坏账后取款与利息累计 / 管理员不可直改 supplyIndex / 零坏账无状态变化 / BadDebtRealized 事件 |
| SecurityFixes.t.sol | 20 | 审计 v1.1 修复回归（F1 取整下溢 / F3 setPrice 校验 / F4 零地址 / F2 超额损失守恒 / F5 实时偏差 / F9 oracle 暂停清算）+ v1.2 最小金额限制（MIN_SUPPLY/MIN_BORROW/MIN_COLLATERAL） |
| FeeMechanism.t.sol | 12 | 固定费率 94/4/2 合计100%；储备未达标无溢出/达标溢出转Treasury/恰达目标新增4%全溢出/坏账消耗储备后溢出停止/借款增减改变目标/totalBorrows=0 不溢出储备保留/collectTreasury 转账与零地址revert/溢出事件/参数边界 |
| MinSeize.t.sol | 3 | minSeize 通过/不足 revert/0 不限制 |
| **DirectedFuzz.t.sol** | 7 | **定向 fuzz**：repay 部分/全额/跨市场边界；liquidate closeFactor 封顶、seize 非零上限、跨市场(WBTC/USDT)、连续清算到清仓或坏账（全程守恒） |
| **ExtremeMatrix.t.sol** | 4 | **参数极值矩阵**：closeFactor 5/50/100%、bonus 0/5/20%、reserveTarget 0/1%/50%、6 档下跌×closeFactor×bonus 组合（全新池逐场景，产物 `test-out/extreme_*_matrix.md`） |
| **BadDebtFrontrunSnapshot.t.sol** | 4 | **坏账 front-run 快照**：窗口内抢先提款逃损 vs 无人抢先按份分摊；快照恢复幂等；bank-run 受池现金上限约束 |
| **AdminBranches.t.sol** | 11 | **admin/注册分支**：addMarket zero/ETH/越权/超 MAX_MARKETS；addCollateral zero/超 MAX_COLLATERALS；非法 marketId/collateral 全操作 revert；角色矩阵；reserveTarget 边界 |
| **Caps.t.sol** | 10 | **供应/抵押上限**：市场总供应上限拦截与释放（提款/清算）、抵押品池内总量账本（supply/withdraw/liquidate 维护）、0=不限制兼容、仅 PARAM_ADMIN、坏 id |
| **TimelockGovernance.t.sol** | 4 | **治理 Timelock**：参数变更必须经 OZ TimelockController schedule+delay；直接改参被拒；PAUSER 独立熔断；Ownable 移交后仅能经 timelock 改参 |
| **BaseSetupV2.t.sol** | 基座 | 注册 USDT/DAI 市场 + wstETH/WBTC 抵押；oracle 价格与各资产档位；市场守恒（精确/容差）辅助 |
| **MultiAsset.t.sol** | 18 | **V2 多资产**：每资产（USDT/DAI/wstETH/WBTC）supply/borrow/repay/withdraw/liquidate；精度/最小金额（6/8/18 位）；跨抵押合计能力与加权健康度；跨市场同 tier 借款与市场隔离；任意抵押×市场清算；逐市场坏账隔离与全局 tier 保留（回归）；双市场利率独立累计 |

## 4.2 压力测试汇总（`contracts/test-out/stress_matrix.md` 自动生成）— 2026-08-31

| 跌幅 | T1(50) | T2(60) | T3(70) | T4(75) | T5(80) |
|---|---|---|---|---|---|
| -5%/-10% | 不触发清算/守恒 | 同左 | 同左 | 同左 | 同左 |
| -20% | 清算/守恒 | 清算/守恒 | 清算/守恒 | 清算/守恒 | 清算/**坏账**/守恒(储备兜底) |
| -30% | 清算/守恒 | 清算/守恒 | 清算/**坏账** | 清算/**坏账** | 清算/**坏账** |
| -40% | 清算/守恒 | 清算/**坏账** | 清算/**坏账** | 清算/**坏账** | 清算/**坏账** |
| -50% | 清算/**坏账** | 清算/**坏账** | 清算/**坏账** | 清算/**坏账** | 清算/**坏账** |

清算时机与独立计算的 HF<1 完全一致；所有场景资金守恒；坏账场景由储备部分兜底 + 存款人按份额承担。

## 4.3 部署与 E2E 本地验证 — v1.0 · 2026-08-31（Sepolia 真网 E2E 见 `docs/archive/E2E_Sepolia_测试报告.md`）

- 部署脚本 `script/Deploy.s.sol` 在 Anvil 真实广播成功（合约、角色、接线、JSON 正确）。
- E2E `script/e2e_sepolia.sh` 在 Anvil 全 8 步 status=0x1：
  A 存 1000 → deployer 补流动性 → B 存 10 ETH → B 借 21000@tier3（HF=1.114）→ 状态检查 → B 部分还款 → A 提取一半 → **Mock 价跌 30% 清算（HF 0.867→0.914）** → 资金守恒（差 1 尘埃）。

---

# 第 5 部分 安全模型与风险

## 5.1 已实现的安全机制

- ReentrancyGuard（全部状态函数）；ETH 转账用 `call{value}`（`_safeSendEth`，失败 revert），不受 2300 gas 限制，重入仍被 Guard 拦截。
- CEI：事件前置、状态先更新再外部调用。
- 份额记账 + 逐档指数计息；**全部金额向上/向下取整方向对协议有利**。
- **USDC 脱锚计价**：债务美元价值 = USDC 数量 × USDC/USD 价格（LTV/HF/可借额随之正确变化），资金守恒不变式不受影响。
- **Oracle 偏差不阻塞清算**：偏差过大不 revert，返回新价格并触发 `PriceAnomalyDetected`（maxDeviation 默认 **30%**，范围 10%~200%）；PAUSER 可暂停。
- **异常价禁止新增敞口**：价格被标记异常时，`borrow` 与 `supplyCollateral` revert（`"price anomalous"`）；`repay`/`withdraw`/`liquidate` 正常，保证能退出与清算。
- 暂停开关（暂停时仅允许取款/还款/清算）。
- Oracle：stale 仍 revert、偏差事件化、fallback 时限、pause；管理员无法注入任意价格。
- 管理员无法挪用用户资金（测试断言）。
- 关键状态变更均有事件（Borrowed/Repaid/Liquidated 含 LTV·HF·剩余债务·postHF；InterestAccrued；BadDebtRealized；OracleSwitched；PriceAnomalyDetected）。
  - ⚠️ **V2（2026-09-02）精简**：为满足 EIP-170 尺寸，已移除 V1/V2 **用户操作事件**（Supplied/Withdrawn/Borrowed/Repaid/Liquidated/Collateral*、MarketAdded/CollateralAdded 等）；参数化 `skimReserve(uint8)` 移除、`collectTreasury(uint8)` 已于 2026-09-02 恢复（按市场提取）；保留核心会计事件（`InterestAccrued`/`BadDebtRealized`/`ReserveOverflowTransferred`）与 oracle 事件。链上核对以视图为主（`marketAccounts`/`userDebtToken`/`userCollateralOf`/`getUserPositionV2`）；USDT/DAI 市场 reserve/Treasury 独立记账但无便捷提取（仅默认 USDC 市场保留 `skimReserve()/collectTreasury()`），见第 9 章。
- **坏账即时传导给存款人**：坏账超出风险储备（第一损失缓冲）的部分会即时降低 `supplyIndex`，所有存款人按份额承担，**存款本金可能受损**。
- **储备溢出自动转 Treasury**：储备总资产超过 `totalBorrows × 3%` 的部分自动转入 Treasury（`ReserveOverflowTransferred`），储备不会无限膨胀；溢出只从账面 `totalReserve` 划转（物理储备仅由坏账消耗），`totalBorrows = 0` 时不触发溢出。
- 所有收益均为预估，随市场利率和资金利用率实时变化，协议不承诺固定收益。

## 5.2 当前风险与待办 — v1.0 · 2026-08-31

| 风险 | 说明 | 缓解/待办 |
|---|---|---|
| 管理员集中 | 部署者持 DEFAULT_ADMIN + 多余 PARAM_ADMIN/PAUSER（未撤销） | 生产移交多签、撤销部署者 |
| Oracle 单点 | setFeed 可换价格源地址 | 生产多签；审计 |
| 风险引擎建议不自动执行 | 依赖管理员及时响应 | 前端监控告警 |
| 偏差容忍的副作用 | 极端跳价会以异常价执行（为保清算） | 事件监控 + PAUSER 暂停兜底 |
| liquidity 无挂钩 | RiskEngine 手动参数可被伪造；`calculateRiskLevelAuto` 从池直读（已有 0~1 校验） | 前端展示用 Auto |
| lint 风格 | 369 warnings（require→custom errors 等） | 后续优化 |
| 未经外部审计 | — | 阶段 8 审计 |

---

# 第 6 部分 部署指南（Sepolia）

## 6.1 前置

```bash
# .env（已 gitignore）至少含：
SEPOLIA_RPC_URL=...            # Alchemy/Infura
PRIVATE_KEY=0x...              # 测试网专用，cast wallet new 生成，绝不用主网
ETHERSCAN_API_KEY=...
SEPOLIA_ETH_USD_FEED=0x694AA1769357215DE4FAC081bf1f309aDC325306
SEPOLIA_USDC_USD_FEED=0xA2F78ab2355fe2f984D808B5CeE7FD0A93D5270E
TESTNET_ADMIN=0x...            # 可选，缺省=部署者
E2E_USER_A_KEY / E2E_USER_B_KEY # E2E 用户私钥（测试网）
```

## 6.2 部署

```bash
forge script script/Deploy.s.sol:Deploy --rpc-url $SEPOLIA_RPC_URL --broadcast --verify -vvvv
```
- 部署顺序：MockUSDC → ChainlinkOracle(+MockPriceOracle) → InterestRateModel → RiskManager → LiquidationManager → ReserveManager → RiskEngine → LendingPool → 初始化接线 → 角色移交。
- 地址写入 `deployments/sepolia.json`。

## 6.3 验证

```bash
forge script script/Verify.s.sol:Verify --rpc-url $SEPOLIA_RPC_URL
# 或逐合约：forge verify-contract <addr> LendingPool --chain 11155111 --compiler-version v0.8.24 --etherscan-api-key $ETHERSCAN_API_KEY --watch
```

## 6.4 E2E

```bash
bash script/e2e_sepolia.sh   # cast 逐笔，已本地验证（Anvil 全 8 步 status=0x1）
```

## 6.5 清算测试方案（关键）— v1.0 · 2026-08-31

- 真实 Chainlink 无法操纵 → 部署时 LendingPool 价格源 = **SwitchableOracle**（主源=Chainlink）。
- 测试流程：**PAUSER** `SwitchableOracle.enableSettable()` → **PARAM_ADMIN** `SwitchableOracle.setPrice(ETH, 2100e8)`（-30%）→ `LendingPool.liquidate(...)` → **PAUSER** `SwitchableOracle.disableSettable()` 切回主源。
- 已在 Anvil 真实广播验证（HF 1.114→0.867→清算→0.914，守恒精确相等）。

| 动作 | 合约 | 函数 | 权限 |
|---|---|---|---|
| 切换到可设价模式 | SwitchableOracle | `enableSettable()` | PAUSER |
| 设价（-30% → 2100e8） | SwitchableOracle | `setPrice(address,uint256)` | PARAM_ADMIN |
| 执行清算 | LendingPool | `liquidate(address,uint256,uint256)` | 无 |
| 切回主源（必须执行） | SwitchableOracle | `disableSettable()` | PAUSER |
| 紧急暂停读价 | SwitchableOracle | `pause()`/`unpause()` | PAUSER |

## 6.6 角色矩阵（部署后回填实际地址）— v1.0 · 2026-08-31

| 合约 | PARAM_ADMIN | PAUSER | DEFAULT_ADMIN / Owner |
|---|---|---|---|
| SwitchableOracle / LendingPool / ChainlinkOracle | 部署者 + TESTNET_ADMIN | 部署者 + TESTNET_ADMIN | **仅部署者** |
| RiskEngine | 部署者 + TESTNET_ADMIN | — | **仅部署者** |
| InterestRateModel / RiskManager / ReserveManager | — | — | Owner = TESTNET_ADMIN |

> **部署者始终是最终管理者**（DEFAULT_ADMIN 未移交 + 未撤销构造器角色）。测试网可接受；生产必须移交多签并撤销部署者角色。TESTNET_ADMIN 缺省=部署者。

## 6.7 已部署地址回填表（Sepolia · 2026-09-03 第五次部署 · 正确 D1 顺序上链）

| 合约/资产 | 地址 |
|---|---|
| MockUSDC | `0x54dE52C8F197A504F7B18F2AaAA77454C27FDD5E` |
| USDT（6dp） | `0x8Ecf7C345266aF5fc002c491e608530C917756CB` |
| DAI（18dp） | `0xb241519DAEC4aCBF294D59E7D24A2762dBd434EC` |
| wstETH（18dp） | `0xeA1d9f57537eB74114A47812b2D944CaBA6C152E` |
| WBTC（8dp） | `0x5a8026c320c1c337526A5a99C9D0D2b7c001e91B` |
| ChainlinkOracle | `0x355C32E63657E7aE6dFd5A03B8c77Ea38e58D944` |
| SwitchableOracle | `0x2506F626366b441437b096DDCF4AE98efd4d1446` |
| InterestRateModel | `0x1ADDA1A8B0C09DF6A7bC4379CDd2B88Ef31552E3` |
| RiskManager | `0xF1f9672ad8285DB29d63Af1DA4563Fe45Ec1E7b3` |
| LiquidationManager | `0xF8485e8fDD20F3E0141E4d95BF39150d4F7Fac7C` |
| ReserveManager | `0x8e06d57c2296224bCD48DE36B8BC4140555B5feB` |
| RiskEngine | `0x2E4F4Cd71D3230eb0f08abfbD1a669e55eB4D701` |
| LendingPool | `0xA958E9Ab95CEaFF5f341947824bA2237745Ec07D` |

> 部署记录（2026-09-03 第五次）：**D1 坏账吸收顺序按“物理储备→账面储备→存款人(supplyIndex)→Treasury 最后兜底”修正后已上链**；SafeERC20 与“Max 一次还清”亦在链上。演示已播种（USDC 5000 / USDT 3000 / DAI 15000 供应 + 0.01 ETH 抵押 + 可设价价格 + treasuryAddress）。测试：31 suites / 230 passed（含 D1 顺序回归、全额还款、peg 隔离、定向 fuzz、极值矩阵、坏账 front-run 快照、admin 分支、Caps、TimelockGovernance、ETH 档位回归）。历史部署池（`0x8c38…`/`0xc666…`/`0x7BAc…`）均已归档。⚠️ 2026-09-03 后续代码变更（供应/抵押上限、Timelock 治理接线）**未部署到 Sepolia 当前池**，主网上线需整组重部署。

## 6.8 cast 命令速查

```bash
# 部署（写 deployments/sepolia.json；--verify 需 ETHERSCAN_API_KEY）
forge script script/Deploy.s.sol:Deploy --rpc-url $SEPOLIA_RPC_URL --broadcast --verify -vvvv
# 本地逻辑验证（MOCK_FEEDS=1 部署模拟聚合器）
MOCK_FEEDS=1 forge script script/Deploy.s.sol:Deploy --rpc-url http://127.0.0.1:8545 --broadcast
# 验证合约
forge script script/Verify.s.sol:Verify --rpc-url $SEPOLIA_RPC_URL
# 手动操作（V2 均为市场/抵押显式入参）
# supply/withdraw/borrow/repay 第一参 = 市场 id（0=USDC/1=USDT/2=DAI）
cast send $POOL "supply(uint8,uint256)" 0 1000000000 --rpc-url $SEPOLIA_RPC_URL --private-key $USER_A_KEY
cast send $POOL "supplyCollateral()" --value 5000000000000000000 --rpc-url $SEPOLIA_RPC_URL --private-key $USER_B_KEY   # ETH 抵押
cast send $POOL "supplyCollateral(address,uint256)" $WSTETH 1000000000000000000 --rpc-url ... --private-key ...        # wstETH 抵押
cast send $POOL "borrow(uint8,uint256,uint256)" 1 1000000000 3 --rpc-url ... --private-key ...                          # USDT 市场借
cast send $POOL "liquidate(address,uint8,address,uint256,uint256)" $USER_B 0 $ETH 500000000 0 --rpc-url ... --private-key ...  # 清算（市场0/ETH）
# 只读（多市场）
cast call $POOL "marketAccounts(uint8)(uint256,uint256,uint256,uint256,uint256,uint256)" 0 --rpc-url ...
cast call $POOL "userDebtToken(address,uint8)(uint256)" $USER_B 1 --rpc-url ...
cast call $POOL "getUserPositionV2(address)(uint256,uint256,uint256,bool)" $USER_B --rpc-url ...
# 按市场提取 Treasury（USDT/DAI 收入；任何人均可调）
cast send $POOL "collectTreasury(uint8)" 1 --rpc-url ... --private-key ...
# 演示价格（USDC feed 常 stale）：SwitchableOracle 可设价模式
cast send $SWITCH "enableSettable()" --private-key $PAUSER_KEY
cast send $SWITCH "setPrice(address,uint256)" $ETH 300000000000 --private-key $DEPLOYER_KEY   # ETH 3000 USD（8位）
# 测试币：Mock 资产均支持 faucet()
```

## 6.9 常见错误排查

| 现象 | 原因 | 处理 |
|---|---|---|
| `InsufficientFunds` | 钱包无测试网 ETH | 先领 faucet |
| `nonce too low` | 并发交易 | 等确认或指定 `--nonce` |
| `stale price` / `price deviation` | Chainlink 未更新/价格跳变 | 等喂价或检查 feed |
| `insufficient liquidity` | 池内现金不足 | 增加存款 |
| `ltv too high` | 借款超档位上限 | 用 `maxBorrowable` |
| `oracle paused` | 预言机被 PAUSER 暂停 | `unpause()` |
| `tier locked` | 已有借款档位 | 先还清再换档 |
| `price not set` | SwitchableOracle 可设价模式下未设价 | 先 `setPrice` |
| 验证失败 | 少 compiler-version | 加 `--compiler-version v0.8.24` |

## 6.10 安全红线

- ❌ 不使用主网 RPC / 主网钱包 / 真实 USDC。
- ❌ 私钥只存 `.env`（已 gitignore），不进 git。
- ❌ 不得在任何宣传材料中使用"固定收益""保本保息"等表述。
- ❌ 不得宣传"保本""本金安全""刚兑""固定收益"等表述（存款本金可能因坏账而受损）。
- ✅ 全部测试网资产，可随时作废重建。
- ✅ 清算演示后必须 `disableSettable()` 切回真实 Chainlink。
  - ⚠️ **V2 演示例外（2026-09-02）**：Sepolia 的 USDC/USD 真 feed 常 stale，且 USDT/DAI/wstETH/WBTC 仅挂 Mock feed → 演示站点/冒烟测试**保持可设价模式**提供确定价格（测试网人为设定，非真实行情）；上线主网前必须换真实 feed 并关闭可设价模式。

---

# 第 7 部分 设计确认 Q&A（关键决策记录）

1. **ETH 抵押品**：原生 ETH；转账用 `call{value}`（`_safeSendEth`），失败 revert；不受 2300 gas 限制；重入仍被 ReentrancyGuard 拦截。
2. **ReentrancyGuard**：全部状态函数已加。
3. **minAmount 滑点**：V1 无 AMM 无滑点；清算已加 `minSeizeAmount`（0=不限）。
4. **70%→78% 清算阈值（缓冲 8%）**：有意设计，参数可配。
5. **USDC/USD**：债务美元价值 = USDC 数量 × USDC/USD Chainlink 价格；USDC=1 时行为与之前完全一致；USDC 溢价（>1）抬升 LTV、降低 Health Factor；USDC 脱锚（<1）降低 LTV、抬升 Health Factor；UsdcPeg.t.sol 已覆盖 5 个场景。
6. **RiskEngine**：纯建议；任何人可调 `getRiskLevel`；liquidity 有 0~1 校验。
7. **无绕过 oracle 校验的读价路径**。

---

# 第 8 部分 路线图与待办

## 8.1 待办

1. **Sepolia 真部署**（待凭据：RPC/测试币/私钥/Etherscan Key），回填本文档 6.7 地址表。
2. ✅ 前端 Dashboard（Next.js 已实现：Home/Dashboard/Stress Test/History/About，全英文，见 `frontend/README.md` 与 `docs/archive/前端_验证报告_v1.0.md`）。
3. 数据服务（`services/`）+ Subgraph。
4. 生产权限收口（多签/撤销部署者）、外部安全审计。
5. Git 首次提交（当前 `git init` 未提交、未配 user.name/email）。

## 8.2 完整路线（总纲）

产品设计 → 合约骨架 → Sepolia 全流程 → 回测/压力 → 前端 → 安全审计 → 小规模真实资金（主网后）。

---

# 第 9 部分 多资产 V2 附录（2026-09-02）

> V2 = 单一 `LendingPool` 内部多市场（单池多市场），正文 V1 章节中与本附录冲突处以本附录为准。全部改动含合约源码、测试、部署与前端（commit 见 git log 2026-09-02）。

## 9.1 架构与数据模型

- **市场（借贷资产）**：`Market[] _markets`，每市场含 `asset / decimals / wadScale(=10^(18-d)) / cash / totalShares / supplyIndex / lastAccrual / totalReserve / treasuryAccrued / borrowIndexByTier[6] / totalNormalizedByTier[6]`。市场 0 在构造时注册（USDC），`addMarket(token,decimals)`（PARAM_ADMIN）追加。
- **抵押品**：`Collateral[] _collaterals`（token/decimals/wadScale/enabled），构造注册 ETH 哨兵，`addCollateral(token,decimals)`（PARAM_ADMIN）追加。
- **用户仓位**：按市场 `userShares[user][m]` / `userBorrowNorm[user][m]` / `userTier[user][m]`；抵押品 `userCollateral[user][collId]`；全局档位 `userGlobalTier[user]`。
- **美元换算**：`amount→WAD = amount×price×wadScale/1e8`；`WAD→amount = wad×1e8/(price×wadScale)`（逐 token 精度，向下/向上取整方向对协议有利）。
- **每市场独立利率/储备/坏账**：accrue 逐市场跑自身利用率；储备目标与溢出、Treasury 记账均按各自市场 token；坏账传导只影响该市场 `supplyIndex` 与该市场存款人。

## 9.2 关键接口（V2 显式入参；市场 0 / ETH 的 V1 便捷形态）

| 动作 | V1 便捷形态（保留） | V2 显式形态 |
|---|---|---|
| 存款/取款 | `supply(amount)`/`withdraw(shares)` | `supply(marketId,amount)`/`withdraw(marketId,shares)` |
| 抵押 | `supplyCollateral() payable`（ETH）、`withdrawCollateral(amount)` | `supplyCollateral(token,amount)`/`withdrawCollateral(token,amount)` |
| 借款/还款 | `borrow(amount,tier)`/`repay(amount)` | `borrow(marketId,amount,tier)`/`repay(marketId,amount)` |
| 清算 | `liquidate(target,cover,minSeize)`（市场0+ETH） | `liquidate(target,marketId,collToken,cover,minSeize)` |
| 坏账 | `handleBadDebt(target)` | `handleBadDebt(target,marketId)` |
| 视图 | market0 聚合（`cash/getTotalSupply/.../getUserPosition` 等，语义见 §9.6） | `marketAccounts(m)(cash,borrows,supply,reserve,treasury,supplyIndex)`、`marketUtilization/SupplyAPR/BorrowAPR(m,...)`、`userSharesOf/userCollateralOf/userDebtToken`、`getUserPositionV2(user)`、`userGlobalTier(user)` |

> ⚠️ 为满足 EIP-170（24576B），LendingPool 已精简：**移除 V1/V2 用户操作事件**与参数化 `skimReserve(uint8)`（`collectTreasury(uint8)` 已于 2026-09-02 恢复，按市场提取，见 §5.1 注）；`RiskManager`/`ReserveManager` ABI 亦更新（token×tier 配置 / 按 token 覆盖）。

## 9.3 设计决策与语义

1. **tier 全局锁**：跨市场借款必须同档（`userGlobalTier` 首笔锁定），与 V1 单市场语义一致；坏账清单市场债务时其它市场仍有债则保留全局 tier（有回归测试）。
2. **健康度/能力为抵押品加权**：`capacity = Σ value_i×LTV(token_i,tier)`；`HF = Σ value_i×LT(token_i,tier) / debtWad`（多抵押自动按各资产档位）。
3. **按抵押分档表**：ETH/wstETH 用 50/60/70/75/80（LT 60/70/78/85/90）；**WBTC 保守 45/55/65/70/75（LT 55/65/75/80/85）**；档位仍是借款端利率溢价与风险刻度，LTV/LT 由各抵押资产自己的表约束。
4. **精度**：借贷 USDC/USDT(6)、DAI(18)；抵押 ETH/wstETH(18)、WBTC(8)。金额换算全部过 `wadScale`，不假设 6 位。
5. **最小金额**：按整 token 缩放（10 存 / 100 借 / 0.01 抵押 × 10^decimals）；`DUST_THRESHOLD=100`（raw 单位）。
6. **市场 0 保持默认**：构造注册 USDC 市场与 ETH 抵押，使存量 V1 交互/前端/测试（市场0）语义不变。
7. **价格源**：Sepolia 仅 ETH/USD、USDC/USD 有真 feed（后者常 stale）；其余资产部署时挂 **MockAggregator feed**；主网须换真实 feed（wstETH 建议 wstETH/ETH×ETH/USD）。

## 9.4 演示/测试网运维（cast）

- 演示/冒烟价格设定（可设价模式，PAUSER 开、PARAM_ADMIN 设价）：
  `enableSettable()` → `setPrice(ETH,3000e8)` `setPrice(wstETH,3000e8)` `setPrice(WBTC,100000e8)` `setPrice(USDC/USDT/DAI,1e8)`。价格 8 位小数。
- 每资产 E2E 脚本：`bash script/e2e_sepolia_v2.sh`（supply/borrow/repay/withdraw/部分 liquidate），或 PowerShell 逐笔流程见会话记录。
- 自清算被禁止：target 与 msg.sender 不能相同；需独立签名账户当清算人。
- 只读核对：`marketAccounts`、`userDebtToken(user,m)`、`userCollateralOf(user,collId)`、`getUserPositionV2`、`isLiquidatable`。

## 9.5 新增资产接入指南（Checklist）

1. `MockToken`（或真实 token）+ decimals；若为借贷资产 → `pool.addMarket(token,decimals)`；若为抵押 → `pool.addCollateral(token,decimals)`（PARAM_ADMIN）。
2. `RiskManager.setTier(token, tier, maxLTV, lt)` 逐个写入五档（无默认表的新 token 需显式配置，0 值会令其无借款能力）。
3. 价格：ChainlinkOracle `setFeed(token, aggregator, decimals)`（Sepolia 用 MockAggregator 或走可设价模式）；主网用真实 feed。
4. 前端：`frontend/src/lib/config.ts` 的 `BORROW_MARKETS`/`COLLATERALS`（含 decimals/address/symbol）+ 必要时 `COLLATERAL_TIER_LTV/LT`（BorrowTab 客户端能力预估用）；ABI 若变了需从 `contracts/out/*.json` 重新生成 `frontend/src/lib/abis/*.json`。
5. 文档：更新 §3.2.1 资产表与本表；测试网重跑 per-asset E2E。
6. 测试：仿 `MultiAsset.t.sol` 添加该资产 supply/borrow/repay/withdraw/liquidate + 精度/跨市场组合。

## 9.6 已知语义与待办

- `getUserPosition(user)`（V1 七元组）的 `collateral` 仅统计 ETH（V1 语义）；wstETH/WBTC 只体现在 `getUserPositionV2` 聚合中；Stress 演示页按 ETH 单抵押语义展示。
- USDT/DAI 市场 reserve/Treasury 独立记账，已提供按市场 `collectTreasury(uint8)`（USDT/DAI 等市场的收入可独立提取并转账给 `treasuryAddress`）；reserve 的 `skimReserve(uint8)` 仍仅默认 USDC 市场版本，如需按市场补 `skim` 可后续扩展（注意 EIP-170 预算）。
- 坏账吸收顺序沿用 V1：物理储备(已 skim)→该市场存款人(supplyIndex)→账面储备→Treasury；未 skim 的市场坏账先落该市场存款人 index。
- 用户操作事件已移除（日志监控靠视图）；如需完整事件需扩展合约（预计超 EIP-170，需拆模块）。
- `RiskEngine.calculateRiskLevelAuto` 基于默认 USDC 市场读数（市场0）；多市场逐一评估为后续增强项。
- 待办：主网真实 feed/权限收口/外部审计；每市场 reserve/treasury 提取通用化；前端 DOM 实测截图与链上 E2E 结果回填 §4/§6.7。

*本文档为项目唯一总文档（原分阶段文档已并入后删除）。

## 9.7 主网上线前置（GO/NO-GO，截至 2026-09-03）
1. 代码层（已完成）：D1 坏账顺序、SafeERC20、全额还款一次清零、三段利率、多市场隔离、230 测试/不变式/fuzz/Slither0。
2. 本环境可完成项（2026-09-03 已落地）：`script/DeployMainnet.s.sol` 主网就绪参数化模板（真实 feed/多签/默认禁 settable/token 白名单/cap/可选 Timelock/上链预检）+ 补强测试（fuzz/极值矩阵/front-run 快照/admin 分支/Caps/TimelockGovernance，见 PROGRESS §2.6–§2.9）+ `services/monitor` 轮询监控脚手架（§2.10）。**以上均未在真实主网执行；cap/Timelock 为合约代码变更，Sepolia 当前池为旧代码。**
3. 未完成（需外部资源/治理）：外部第三方审计；主网真实 feed（含 wstETH 合成）并移除 Mock/可设价；多签+Timelock **真网执行**（minDelay 治理决策）；事件/索引（Subgraph）+监控**告警渠道**；坏账前提取公平性策略；供应/抵押上限**具体数值**；真实历史 APY。
4. 门槛：3 全部落地 + 全量回归通过后再评审上主网。
V2 多资产附录完（2026-09-02）。*
