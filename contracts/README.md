# OrbitFi Contracts

Solidity 智能合约，基于 **Foundry** 开发。

## 环境变量

复制 `.env.example` 为 `.env` 并填入测试网配置（仅测试网）。`.env` 已被忽略，严禁提交。

## 常用命令

| 命令 | 作用 |
|---|---|
| `forge build` | 编译 |
| `forge test` | 运行测试 |
| `forge test -vvv` | 运行测试（详细输出） |
| `forge fmt` | 格式化 |
| `npm run lint` | solhint 静态检查 |
| `anvil` | 启动本地链 (127.0.0.1:8545) |
| `forge install` | 安装依赖 (forge-std / OpenZeppelin) |

## 目录说明

- `src/` 合约源码。当前为 forge 模板示例 `Counter.sol`（仅用于验证环境，后续会被业务合约替换）。
- `test/` 测试。`Counter.t.sol` 为模板示例测试。
- `script/` 部署脚本。`Counter.s.sol` 为模板示例脚本。
- `lib/` 外部依赖，由 `forge install` 管理（当前为 shallow clone，未注册为 submodule，已加入 `.gitignore`）。

## 依赖

- forge-std: 测试框架
- OpenZeppelin Contracts v5.7.0: 安全库（ReentrancyGuard、Ownable、Pausable 等）

## 合约设计（后续阶段）

LendingPool / InterestRateModel / 分层 LTV (50/60/70/75/80%) / Health Factor / Liquidation / Risk Reserve / OracleAdapter
