# Deploy Safe 2/3 (Base) — 说明

## 方式 A（推荐）：Safe{Wallet} 官方界面
1. 打开 `https://app.safe.global` → 右上角 **Add account / +** → 选 **Base** 网络。
2. 添加 3 个 owner（你 + 两位可信签名者的地址），阈值设为 **2/3**。
3. 界面会给出 Safe 地址；记住 owner/阈值，**无需花代码部署**。
4. 把得到的 Safe 地址填入 `contracts/.env.mainnet.example` 的 `MAINNET_ADMIN` / `MAINNET_TREASURY`。

> 优点：界面可见 owner/阈值、可后续管理；代码零风险。
> 缺点：地址由 Safe 服务端生成，无法脚本预演（本仓库两条路径并存，视你偏好）。

## 方式 B：脚本化（cast 调 SafeProxyFactory **v1.4.1**）

> ⚠️ 方式 B 创建的是 Safe **v1.4.1**。用官方界面（方式 A）创建得到的是 **v1.5.0**
> （底层为 SafeL2 singleton `0xEdd160fEBBD92E350D4D398fb636302fccd67C7e`，2026-09-29 实测）。
> 两个版本都能正常工作，**协议侧不关心 Safe 版本**（`DeployMainnet.s.sol` 只把 Safe 地址
> 当作普通地址接受）。但不要混用两条路径。

前提：本机有 `cast`（foundry 已装）。改 `deploy-safe.ps1` 里的 `O1/O2/O3` 与 `DEPLOYER_KEY`，然后：

```powershell
.\deploy-safe.ps1
```

脚本会：
1. 生成 `setup(owners=[O1,O2,O3], threshold=2, handler=0xfd07…, …)` calldata；
2. 用 `getAddressForCounterfactualSafe` **只读预演** Safe 地址（不花 gas）；
3. 打印广播命令 `createProxyWithNonce(singleton, setup, nonce=1)`（部署者需 Base ETH）。

> Base 官方地址（v1.4.1，已链上核验有代码）：
> - SafeProxyFactory: `0x4e1DCf7AD4e460CfD30791CCC4F9c8a4f820ec67`
> - Safe singleton: `0x41675C099F32341bf84BFc5382aF534df5C7461a`
> - Safe L2 singleton: `0x29fcB43b46531BcA003ddC8FCB67FFE91900C762`
> - CompatibilityFallbackHandler: `0xfd0732Dc9E303f09fCEf3a7388Ad10A83459Ec99`

## 之后
把 Safe 地址写入 `MAINNET_ADMIN`，即可进入主网部署（见 `contracts/.env.mainnet.example` 与 `docs/主网多签与权限收口手册.md`）。
