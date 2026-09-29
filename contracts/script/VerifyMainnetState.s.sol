// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";

/// @dev 只读视图接口（仅本脚本使用，不动 contracts/src）。
interface IOracleView {
    function maxStaleness() external view returns (uint256);
    function maxDeviation() external view returns (uint256);
    function lastValidPrice(address) external view returns (uint256);
    function getAssetPrice(address) external view returns (uint256);
    function paused() external view returns (bool);
}

interface IPoolView {
    function treasuryAddress() external view returns (address);
    function priceOracle() external view returns (address);
    function paused() external view returns (bool);
    function marketSupplyCap(uint8) external view returns (uint256);
    function collateralCap(uint8) external view returns (uint256);
    function hasRole(bytes32, address) external view returns (bool);
    function DEFAULT_ADMIN_ROLE() external view returns (bytes32);
    function PARAM_ADMIN_ROLE() external view returns (bytes32);
    function PAUSER_ROLE() external view returns (bytes32);
}

interface IOwnableIRMView {
    function owner() external view returns (address);
    function marketGovernor() external view returns (address);
    function activePreset() external view returns (uint8);
}

interface IOwnableView {
    function owner() external view returns (address);
}

interface IReserveView {
    function owner() external view returns (address);
    function lendingPool() external view returns (address);
}

interface ITimelockView {
    function getMinDelay() external view returns (uint256);
    function hasRole(bytes32, address) external view returns (bool);
    function DEFAULT_ADMIN_ROLE() external view returns (bytes32);
    function PROPOSER_ROLE() external view returns (bytes32);
    function EXECUTOR_ROLE() external view returns (bytes32);
}

/// @title 主网部署后状态核验（只读，一行命令跑完全部断言）
/// @notice 用途：真实广播后立刻执行，把"人工照着手册敲 20+ 条 cast"变成一次自动检查。
///         只读，不广播任何交易；全部通过则 exit 0，任一项失败则 revert（exit != 0）。
///
///   用法：
///     forge script script/VerifyMainnetState.s.sol:VerifyMainnetState --rpc-url $MAINNET_RPC_URL
///     # 换用别的部署记录：
///     MAINNET_DEPLOYMENTS=./deployments/dryrun_fork.json forge script ... --rpc-url http://127.0.0.1:8545
///
///   可选环境变量：
///     MAINNET_DEPLOYMENTS        部署记录 JSON 路径（默认 ./deployments/mainnet.json）
///     MIN_STALENESS_SECONDS      maxStaleness 下限，默认 86400（= 本项目 feed 登记表里最长的 heartbeat）
///     MAX_DEVIATION_ALLOWED      maxDeviation 上限，默认 2e17（20%）
///     ALLOW_UNLIMITED_CAPS=1     允许 cap = 0（不限制）。默认❌：cap=0 视为失败（冷启动裸奔）
///     EXPECT_DEPLOYER            期望"已被撤销权限"的地址；默认取 json 里的 deployer
///
/// @dev 为什么这些断言值是这样取的（避免把"我们的偏好"误当成"事实"）：
///   - maxStaleness 下限 86400s：scripts/feed-health-check/feeds.ts 里 5 个 Base feed 的
///     heartbeatSec 全为 86400；且 fork rehearsal 实测稳定币 feed 更新间隔 11–13h。
///     合约默认值 3600（1h）会让该窗口内所有读价 revert，从而阻塞 borrow / 部分 repay /
///     withdrawCollateral / liquidate —— 这是上线前必须拦住的第一号问题。
///   - maxDeviation 上限 2e17：合约默认 3e17（30%）意味着 30% 的偏离都不告警，等于没有保护。
///   - lastValidPrice > 0：该值仅由 updatePrice() 且判定非异常时写入；为 0 则偏差保护完全失效。
contract VerifyMainnetState is Script {
    address internal constant ETH = 0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE;
    address internal constant ZERO = address(0);

    uint256 internal failures;
    uint256 internal checks;

    // ---- 断言辅助 ----

    /// @notice 记录一项检查结果。不立即 revert，以便一次跑完给出完整报告。
    function _check(bool ok, string memory label, string memory detail) internal {
        checks++;
        if (ok) {
            console2.log(string.concat("[ok]   ", label), detail);
        } else {
            failures++;
            console2.log(string.concat("[FAIL] ", label), detail);
        }
    }

    function _checkEqUint(uint256 got, uint256 want, string memory label) internal {
        _check(
            got == want,
            label,
            got == want ? vm.toString(got) : string.concat("got ", vm.toString(got), " expected ", vm.toString(want))
        );
    }

    function _checkEqAddr(address got, address want, string memory label) internal {
        _check(
            got == want,
            label,
            got == want ? vm.toString(got) : string.concat("got ", vm.toString(got), " expected ", vm.toString(want))
        );
    }

    function _info(string memory label, string memory value) internal view {
        console2.log(string.concat("       ", label), value);
    }

    function run() external {
        string memory cfgPath = vm.envOr("MAINNET_DEPLOYMENTS", string("./deployments/mainnet.json"));
        string memory cfg = vm.readFile(cfgPath);

        address pool = vm.parseJsonAddress(cfg, ".lendingPool");
        address oracle = vm.parseJsonAddress(cfg, ".oracle");
        address irm = vm.parseJsonAddress(cfg, ".interestRateModel");
        address rm = vm.parseJsonAddress(cfg, ".riskManager");
        address rsv = vm.parseJsonAddress(cfg, ".reserveManager");
        address treasury = vm.parseJsonAddress(cfg, ".treasury");
        address pauser = vm.parseJsonAddress(cfg, ".pauser");
        address admin = vm.parseJsonAddress(cfg, ".admin");
        address timelockAddr = vm.parseJsonAddress(cfg, ".timelock");
        address deployer = vm.envOr("EXPECT_DEPLOYER", vm.parseJsonAddress(cfg, ".deployer"));
        address governance = timelockAddr == ZERO ? admin : timelockAddr;

        uint256 minStaleness = vm.envOr("MIN_STALENESS_SECONDS", uint256(86400));
        uint256 maxDeviationAllowed = vm.envOr("MAX_DEVIATION_ALLOWED", uint256(2e17));
        bool allowUnlimitedCaps = vm.envOr("ALLOW_UNLIMITED_CAPS", false);

        console2.log("");
        console2.log("=== OrbitFi post-deploy state verification ===");
        _info("record:", cfgPath);
        _info("chainId:", vm.toString(block.chainid));
        _info("pool:", vm.toString(pool));
        _info("oracle:", vm.toString(oracle));
        _info("governance:", vm.toString(governance));
        _info("deployer:", vm.toString(deployer));
        console2.log("");

        // ===== 1. 预言机阈值（上线第一号问题的守门人）=====
        uint256 maxStaleness = IOracleView(oracle).maxStaleness();
        uint256 maxDeviation = IOracleView(oracle).maxDeviation();
        _check(
            maxStaleness >= minStaleness,
            "oracle.maxStaleness",
            maxStaleness >= minStaleness
                ? vm.toString(maxStaleness)
                : string.concat(
                    "got ",
                    vm.toString(maxStaleness),
                    " < required ",
                    vm.toString(minStaleness),
                    " -- stablecoin feeds update every 11-13h; too tight bricks borrow/repay/liquidate"
                )
        );
        _check(
            maxDeviation <= maxDeviationAllowed,
            "oracle.maxDeviation",
            maxDeviation <= maxDeviationAllowed
                ? vm.toString(maxDeviation)
                : string.concat("got ", vm.toString(maxDeviation), " > allowed ", vm.toString(maxDeviationAllowed))
        );

        // ===== 2. 偏差基准已初始化 =====
        uint256 baseEth = IOracleView(oracle).lastValidPrice(ETH);
        _check(
            baseEth > 0,
            "oracle.lastValidPrice(ETH) > 0",
            baseEth > 0
                ? vm.toString(baseEth)
                : "is 0 -- maxDeviation protection is INERT; call oracle.updatePrice(asset)"
        );

        // ===== 3. 每个已注册资产都能读到价 =====
        _checkPrice(oracle, ETH, "ETH");
        address usdc = vm.parseJsonAddress(cfg, ".usdc");
        _checkPrice(oracle, usdc, "USDC");
        _checkPriceIfSet(oracle, cfg, ".usdt", "USDT");
        _checkPriceIfSet(oracle, cfg, ".dai", "DAI");
        _checkPriceIfSet(oracle, cfg, ".cbbtc", "cbBTC");
        _checkPriceIfSet(oracle, cfg, ".wsteth", "wstETH");

        // ===== 4. 未处于暂停态 =====
        _check(!IOracleView(oracle).paused(), "oracle not paused", "");
        _check(!IPoolView(pool).paused(), "pool not paused", "");

        // ===== 5. 池子接线 =====
        _checkEqAddr(IPoolView(pool).priceOracle(), oracle, "pool.priceOracle");
        _checkEqAddr(IPoolView(pool).treasuryAddress(), treasury, "pool.treasuryAddress");
        _checkEqAddr(IReserveView(rsv).lendingPool(), pool, "reserveManager.lendingPool");

        // ===== 6. 额度已设置（机制建好必须接线）=====
        for (uint8 m = 0; m < 3; m++) {
            uint256 cap = IPoolView(pool).marketSupplyCap(m);
            _check(
                cap > 0 || allowUnlimitedCaps,
                string.concat("marketSupplyCap(", vm.toString(uint256(m)), ")"),
                cap > 0
                    ? vm.toString(cap)
                    : "is 0 = UNLIMITED -- set MAINNET_*_SUPPLY_CAP, or pass ALLOW_UNLIMITED_CAPS=1"
            );
        }
        for (uint8 c = 0; c < 2; c++) {
            uint256 cap = IPoolView(pool).collateralCap(c);
            _check(
                cap > 0 || allowUnlimitedCaps,
                string.concat("collateralCap(", vm.toString(uint256(c)), ")"),
                cap > 0
                    ? vm.toString(cap)
                    : "is 0 = UNLIMITED -- set MAINNET_*_COLLATERAL_CAP, or pass ALLOW_UNLIMITED_CAPS=1"
            );
        }

        // ===== 7. 权限收口：部署者必须已无任何角色（不可逆，最重要）=====
        bytes32 DADM = IPoolView(pool).DEFAULT_ADMIN_ROLE();
        bytes32 PARAM = IPoolView(pool).PARAM_ADMIN_ROLE();
        bytes32 PAU = IPoolView(pool).PAUSER_ROLE();
        _check(!IPoolView(pool).hasRole(DADM, deployer), "deployer has NO DEFAULT_ADMIN", vm.toString(deployer));
        _check(!IPoolView(pool).hasRole(PARAM, deployer), "deployer has NO PARAM_ADMIN", vm.toString(deployer));
        _check(!IPoolView(pool).hasRole(PAU, deployer), "deployer has NO PAUSER", vm.toString(deployer));

        // ===== 8. 治理与熔断方已真正拿到权限 =====
        _check(IPoolView(pool).hasRole(DADM, governance), "governance HAS DEFAULT_ADMIN", vm.toString(governance));
        _check(IPoolView(pool).hasRole(PARAM, governance), "governance HAS PARAM_ADMIN", vm.toString(governance));
        _check(IPoolView(pool).hasRole(PAU, pauser), "pauser HAS PAUSER", vm.toString(pauser));
        _checkEqAddr(IOwnableIRMView(irm).owner(), governance, "interestRateModel.owner");
        _checkEqAddr(IOwnableView(rm).owner(), governance, "riskManager.owner");
        _checkEqAddr(IReserveView(rsv).owner(), governance, "reserveManager.owner");

        // ===== 9. Timelock（若启用）=====
        if (timelockAddr != ZERO) {
            ITimelockView tl = ITimelockView(timelockAddr);
            uint256 delay = tl.getMinDelay();
            _check(delay > 0, "timelock.minDelay > 0", vm.toString(delay));
            _check(tl.hasRole(tl.DEFAULT_ADMIN_ROLE(), admin), "admin HAS timelock DEFAULT_ADMIN", "");
            _check(tl.hasRole(tl.PROPOSER_ROLE(), admin), "admin HAS timelock PROPOSER", "");
            _check(tl.hasRole(tl.EXECUTOR_ROLE(), admin), "admin HAS timelock EXECUTOR", "");
        } else {
            _info("timelock:", "disabled (multisig direct) -- skipped");
        }

        // ===== 10. 仅记录，不作断言（治理取舍项）=====
        address gov = IOwnableIRMView(irm).marketGovernor();
        _info(
            "irm.marketGovernor:",
            gov == ZERO
                ? "0x0 (IRM preset changes require Timelock delay)"
                : string.concat(vm.toString(gov), " (IRM presets bypass the Timelock delay)")
        );
        _info("irm.activePreset:", _presetName(IOwnableIRMView(irm).activePreset()));

        // ===== 汇总 =====
        console2.log("");
        console2.log("=== summary ===");
        console2.log("checks:", checks);
        console2.log("failures:", failures);
        require(failures == 0, "post-deploy verification FAILED (see [FAIL] lines above)");
        console2.log("[ok] all post-deploy checks passed");
    }

    // ---- helpers ----

    function _checkPrice(address oracle, address asset, string memory symbol) internal {
        try IOracleView(oracle).getAssetPrice(asset) returns (uint256 p) {
            _check(p > 0, string.concat("getAssetPrice(", symbol, ") > 0"), vm.toString(p));
        } catch {
            _check(
                false,
                string.concat("getAssetPrice(", symbol, ") readable"),
                "reverted -- feed missing / stale beyond maxStaleness / oracle paused. This market's borrow, withdrawCollateral and liquidate would all revert."
            );
        }
    }

    function _checkPriceIfSet(address oracle, string memory cfg, string memory key, string memory symbol) internal {
        address token = vm.parseJsonAddress(cfg, key);
        if (token == ZERO) {
            _info(string.concat(symbol, ":"), "not enabled -- skipped");
            return;
        }
        _checkPrice(oracle, token, symbol);
    }

    function _presetName(uint8 p) internal pure returns (string memory) {
        if (p == 0) return "0 NORMAL";
        if (p == 1) return "1 HIGH_VOLATILITY";
        if (p == 2) return "2 EXTREME";
        return "unknown";
    }
}
