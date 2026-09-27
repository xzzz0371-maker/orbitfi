# ZZZ Lend — Sepolia 端到端（E2E）测试报告

> **报告版本：v1.0（2026-08-31）** ｜ 网络：**Sepolia（chainId 11155111）** ｜ 执行日期：**2026-08-31** ｜ 执行人：E2E 测试工程师
> 前置：合约已按 `docs/ZZZ_Lend_完整文档.md §6.7` 部署（部署记录见该节）。本报告只做链上功能验证，**未修改合约代码、未部署新合约、未改动任何参数**。
> 版本更新约定：每次复跑/增补后递增版本号（v1.0 → v1.1 …），并更新日期。

---

## 1. 测试目标

在 Sepolia 上对已部署的 ZZZ Lend 合约执行完整 E2E，验证：存（supply）→ 补流动性 → 抵押（supplyCollateral）→ 借（borrow）→ 还（repay）→ 取（withdraw）→ 价格下跌清算（liquidate）→ 资金守恒，全部功能正常。

由于 USDC/USD Chainlink feed 当前 stale（长时间未更新），按任务约定 **全程使用 SwitchableOracle 可设价模式**，测试结束已切回 Chainlink 主源。

## 2. 测试环境 — v1.0 · 2026-08-31

| 项 | 值 |
|---|---|
| RPC | `https://ethereum-sepolia-rpc.publicnode.com` |
| 部署者地址 | `0xC35C7D8e83c71441630822f112E5472C8cf56830` |
| LendingPool | `0x4c0F60fb5ee400f8430259a8C20cB35dE31d1a19` |
| MockUSDC | `0x3b661C85cAC1eEfE87dA365c43498A0166399D5D`（6 位小数） |
| SwitchableOracle | `0x33e6974B61dA455a97482BfF05EFb8191a447007` |
| ChainlinkOracle | `0xb89ddB72c1F97b0C1CcbF5f842d029856Aff979c` |
| ETH 常量 | `0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE` |

## 3. E2E 测试用户 — v1.0 · 2026-08-31

| 角色 | 地址 | 私钥 |
|---|---|---|
| User A（存款人） | `0x8380C5EBE5E83D007BFe5600A73c3A4F454FEA3A` | `0x2fcf124d10fdbe2eb4067ac93534687c2c689a2c03b322fa80a796bc84e88c2c` |
| User B（借款人） | `0xB5D7e5699535F60b8Bf40C44B602b2c4524b2851` | `0x1afcd3a432f790f208daaa30ef0ddfeb35c55852f6330c91a984e3e1d11e6969` |

> 私钥为 `cast wallet new` 生成的测试网专用钱包，仅用于本次测试。

## 4. 资金准备

| 操作 | 金额 | 发起方→接收方 | 交易哈希 |
|---|---|---|---|
| 转账 ETH（gas） | 0.05 ETH | deployer→A | `0xf33e3abe…469a7` |
| 转账 ETH（gas） | 0.05 ETH | deployer→B | `0x1b96c3af…6cd9` |
| MockUSDC faucet | 500,000 USDC | deployer 自铸 | `0xbf0716d9…739a` |
| 转账 USDC | 20,000 | deployer→A | `0xa5bccd57…8644` |
| 转账 USDC（备还款） | 5,000 | deployer→B | `0xfd54b016…dc1d` |
| 转账 ETH（抵押补足，见 §7 问题①） | 3 ETH | deployer→B | `0xf490313b…8284` |

## 5. 第 2 步：SwitchableOracle 切可设价模式

| 操作 | 参数 | 交易哈希 |
|---|---|---|
| `enableSettable()` | — | `0xef50b048…e03` |
| `setPrice(ETH, 3000e8)` | ETH=3000 USD | `0x53d79c2e…6907` |
| `setPrice(USDC, 1e8)` | USDC=1 USD | `0x5fc37934…a391` |

验证：`useSettablePrice()=true`；`getAssetPrice(ETH)=300000000000`(3000)；`getAssetPrice(USDC)=100000000`(1)。

## 6. 第 3 步：E2E 流程（含链上读取结果）— v1.0 · 2026-08-31

### 3.1 User A 存款 10,000 USDC
- `approve(POOL, 10000e6)` → `0xf6930210…051a`
- `supply(10000e6)` → `0x639cc7d7…ebc8`
- 结果：A 份额 `10000000000`(10,000e6)、`getTotalSupply()=10000000000`、`getUtilization()=0`、`cash=10000000000`

### 3.1b 部署者补流动性（必要步骤，见 §7 问题③）
- `approve(POOL, 30000e6)` → `0x51941d53…9a9a`；`supply(20000e6)` → `0x99718795…dc8`
- 结果：`cash=30000000000`(30,000e6)

### 3.2 User B 抵押 3 ETH（缩放，见 §7 问题①）
- `supplyCollateral{value:3ether}` → `0xa4903ba8…489b`
- 结果：B 抵押 `3000000000000000000`(3 ETH)，抵押值 = 3×3000 = 9,000 USD

### 3.3 User B 借款 6,000 USDC（tier3，70% LTV，缩放）
- `maxBorrowable(B,3)=6300000000`(6,300e6，容量=9,000×70%)
- `borrow(6000e6, 3)` → `0x244471b1…b584`
- 结果：`getDebt(B)=6000000000000000000000`(6,000e6)、**HF=1.17**（=9,000×0.78/6,000）、LTV≈**66.7%**、`getUtilization()=20%`、`cash=24,000e6`、B 持有 USDC 11,000e6

### 3.4 User B 部分还款 2,000 USDC（缩放）
- `approve(POOL, 2000e6)` → `0x7a23445a…75a6`；`repay(2000e6)` → `0xa458ee3e…dcd4`
- 结果：`getDebt(B)=4000000933…`（≈4,000e6，含微小利息）、**HF=1.754**、B 持有 USDC 9,000e6

### 3.5 User A 取出一半（5,000 份额）
- `withdraw(5000e6)` → `0x6850785b…a407`
- 结果：A 份额 10,000→**5,000e6**、A 收到 ≈5,000.000207 USDC、`cash≈21,000e6`

### 3.6 价格下跌 + 清算
- `setPrice(ETH, 2100e8)`（-30%）→ `0x31d67c32…1ad1a6`
  - B HF = **1.228**，`isLiquidatable=false`（**-30% 不触发**，见 §7 问题②）
- `setPrice(ETH, 1600e8)`（-46.7%）→ `0x15201481…cdf3`
  - B HF = **0.936** < 1，可清算
- 清算人=部署者（持有 455,000e6 USDC）：`approve(POOL,3000e6)` → `0xc04a5ad8…7315d`
- `liquidate(B, 1e14, 0)`（cover 按 closeFactor 50% 封顶）→ `0x9efaf7c8…1821`
- **清算事件**：debtCovered ≈ **2,000.0006 USDC**、collateralSeized = **1.3125 ETH**（=2,000×1.05/1,600）、postHF ≈ 1.052
- 清算后：`getDebt(B)=2000001184…`(2,000e6)、**HF=1.052**、抵押 3→**1.6875 ETH**、部署者收到 1.3125 ETH

### 3.7 资金守恒检查（不变式 `cash + totalBorrows == totalSupply + totalReserve + treasuryAccrued`）— v1.0 · 2026-08-31

| 项 | 值（USDC 单位） |
|---|---|
| cash | 23,000,000,977 |
| totalBorrows | 2,000,001,183 |
| **LHS = cash + totalBorrows** | **25,000,002,160** |
| totalSupply | 25,000,001,973 |
| totalReserve | 116 |
| treasuryAccrued | 69 |
| **RHS = supply + reserve + treasury** | **25,000,002,158** |
| 偏差 | **2（=0.000002 USDC，取整尘埃）** |

**结论：守恒成立 ✅**（偏差为份额/指数记账的取整余量，远小于允许误差）。

## 7. 遇到的问题与处理 — v1.0 · 2026-08-31

1. **① 抵押资金不足 → 金额缩放**：任务要求 B 抵押 10 ETH，但 B 仅 0.05 ETH、部署者约 3.9 ETH（无多余 Sepolia ETH 可注入）。故缩放为 **B 抵押 3 ETH、借款 6,000 USDC（tier3）**，其余步骤与机制完全一致。部署者向 B 补转 3 ETH。
2. **② -30% 无法触发清算（任务设定与公式矛盾）**：原方案（10 ETH/借 21,000/还 5,000）在 -30% 时 HF=21,000×0.78/16,000≈**1.02**，同样不可清算；本测试还款后 -30% 时 HF=1.228。故需更大跌幅：降至 **-46.7%（1,600）** 使 HF=0.936 触发清算。**非合约缺陷**。
3. **③ 借款前现金不足**：A 仅存 10,000 但 B 需借 21,000（本测试缩放后 6,000 也超 10,000 上限外的需求现金流），故由部署者补流动性 20,000 USDC（与完整文档 §4.3 E2E 的"部署者补流动性"一致）。
4. **④ 函数名与任务假设不符（已记录正确签名）**：任务中的 `getUserShares/getUserCollateral/getUserDebt/getCash/totalBorrows/getUserLtv/maxLiquidatable/getEthPrice/getUsdcPrice/isSettable` **均不存在**。正确签名：
   - 持仓：`positions(address)(uint256,uint256,uint256,uint256)`（shares, collateral, borrowNorm, tier）
   - 债务：`getDebt(address)`；现金：`cash()`；总借款：`getTotalBorrows()`
   - 借款/可借：`borrow(uint256,uint256)`、`maxBorrowable(address,uint256)`
   - 清算：`liquidate(address,uint256,uint256)`
   - 读价：`SwitchableOracle.getAssetPrice(address)`；模式：`useSettablePrice()`
5. **⑤ USDC/USD Chainlink feed stale（已知环境问题）**：全程用可设价模式规避；**切回主源后读 USDC 价（如 `getUserHealthFactor`）会 revert `stale price`**（feed 约 11h 未更新，价格本身正确 0.9999）。ETH feed 正常。
6. **⑥ RPC 偶发抖动**：publicnode 出现数次 TLS/连接瞬时错误，重试即成功，不影响结果。

## 8. 第 4 步：切回 Chainlink 主源（必须执行）

- `disableSettable()` → `0x7ea349a6…e3d3`，`useSettablePrice()=false` ✅
- 验证：`SwitchableOracle.getAssetPrice(ETH)=243480932197`（实时 Chainlink ≈2,434.8 USD）✅

## 9. 最终状态 — v1.0 · 2026-08-31

| 项 | 值 |
|---|---|
| 池子总存款（totalSupply） | 25,000.002e6 USDC |
| 池子总借款（totalBorrows） | 2,000.001e6 USDC |
| 利用率 | 8% |
| 现金（cash） | 23,000.001e6 USDC |
| 风险储备（totalReserve） | 116（尘埃） |
| Treasury 待提（treasuryAccrued） | 69（尘埃） |
| User A 份额 | 5,000e6 |
| User B | 抵押 1.6875 ETH，债务 2,000e6，HF 1.052 |
| SwitchableOracle | ✅ 已切回 Chainlink 主源 |

## 10. 测试结论

- 存 / 借 / 还 / 取 / 抵押 / 清算 / 守恒 **全部按预期工作**，无合约级 revert（除已知 USDC feed stale 的环境问题）。
- 清算数学正确：closeFactor 50% 封顶、105% 没收估值（1,312.5 ETH = 2,000×1.05/1,600）与事件一致。
- 资金守恒不变式成立（偏差 2 微 USDC 为取整余量）。
- **待办（需审核后执行）**：等 USDC feed 更新或由 PARAM_ADMIN 调大 `maxStaleness` 后，可复跑读价相关操作；如需更贴近任务原规模的 E2E，需先为 B 注入 ≥10 Sepolia ETH。

---

*本报告由 Sepolia E2E 执行生成，交易全部上链确认（status 0x1）。*
