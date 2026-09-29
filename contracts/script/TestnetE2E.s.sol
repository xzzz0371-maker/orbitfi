// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {MockUSDC} from "../src/mocks/MockUSDC.sol";
import {SwitchableOracle} from "../src/oracle/SwitchableOracle.sol";
import {LendingPool} from "../src/LendingPool.sol";

/// @title OrbitFi Sepolia 端到端测试脚本
/// @dev 依赖 ./deployments/sepolia.json（由 Deploy.s.sol 生成）
///   用法：forge script script/TestnetE2E.s.sol:TestnetE2E --rpc-url $SEPOLIA_RPC_URL --broadcast -vvvv
///   每个用户用自己的私钥签名；各角色须持有测试网 ETH（抵押与 gas）。
///   环境变量：PRIVATE_KEY(admin/deployer) / E2E_USER_A_KEY / E2E_USER_B_KEY / [E2E_LIQUIDATOR_KEY]
contract TestnetE2E is Script {
    address internal constant ETH = 0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE;
    uint256 internal constant WAD = 1e18;

    LendingPool internal pool;
    MockUSDC internal usdc;
    SwitchableOracle internal switchable;

    function run() external {
        uint256 adminKey = vm.envUint("PRIVATE_KEY");
        address admin = vm.addr(adminKey);
        uint256 keyA = vm.envUint("E2E_USER_A_KEY");
        uint256 keyB = vm.envUint("E2E_USER_B_KEY");
        address userA = vm.addr(keyA);
        address userB = vm.addr(keyB);
        uint256 liquidatorKey = vm.envOr("E2E_LIQUIDATOR_KEY", adminKey);

        string memory cfg = vm.readFile("./deployments/sepolia.json");
        usdc = MockUSDC(vm.parseJsonAddress(cfg, ".usdc"));
        pool = LendingPool(vm.parseJsonAddress(cfg, ".lendingPool"));
        switchable = SwitchableOracle(vm.parseJsonAddress(cfg, ".switchableOracle"));

        // 1. Supply：A 存入 1000 USDC
        vm.broadcast(keyA);
        usdc.faucet(10_000e6);
        vm.broadcast(keyA);
        usdc.approve(address(pool), type(uint256).max);
        vm.broadcast(keyA);
        pool.supply(0, 1000e6);
        (uint256 sharesA,,,,,,) = pool.getUserPosition(userA);
        console2.log("[1] A supplied 1000 USDC, shares:", sharesA);

        // 1b. 部署者补足流动性（支撑 B 的 70% LTV 借款与清算演示）
        vm.broadcast(adminKey);
        usdc.faucet(200_000e6);
        vm.broadcast(adminKey);
        usdc.approve(address(pool), type(uint256).max);
        vm.broadcast(adminKey);
        pool.supply(0, 200_000e6);
        console2.log("[1b] deployer supplied extra liquidity for liquidation demo");

        // 2. Supply Collateral：B 存入 10 ETH
        vm.broadcast(keyB);
        pool.supplyCollateral{value: 10 ether}();
        console2.log("[2] B supplied 10 ETH collateral");

        // 3. Borrow：B 选 70% LTV 档位（tier 3），借到档位上限
        uint256 maxBorrow = pool.maxBorrowable(userB, 3);
        vm.broadcast(keyB);
        pool.borrow(0, maxBorrow, 3);
        console2.log("[3] B borrowed (70% LTV cap):", maxBorrow, "USDC");

        // 4. 检查状态：债务 / 抵押价值 / HF / LTV
        (,, uint256 debtWad, uint256 collValueWad,,,) = pool.getUserPosition(userB);
        uint256 ltv = collValueWad == 0 ? 0 : debtWad * WAD / collValueWad;
        console2.log("[4] B debt(WAD):", debtWad, "collateralValue(WAD):", collValueWad);
        console2.log("[4] B LTV:", ltv, "HF:", pool.getUserHealthFactor(userB));

        // 5. Repay：B 偿还部分借款
        uint256 repayPart = maxBorrow / 10;
        vm.broadcast(keyB);
        usdc.approve(address(pool), type(uint256).max);
        vm.broadcast(keyB);
        pool.repay(0, repayPart);
        console2.log("[5] B repaid:", repayPart, "USDC");

        // 6. Withdraw：A 提取部分存款
        vm.broadcast(keyA);
        pool.withdraw(0, sharesA / 2);
        console2.log("[6] A withdrew half of shares");

        // 7. 模拟清算：SwitchableOracle 切到可设价模式，ETH 下跌 30%
        vm.broadcast(adminKey);
        switchable.enableSettable(); // PAUSER
        vm.broadcast(adminKey);
        switchable.setPrice(ETH, 3000e8 * 70 / 100); // PARAM_ADMIN 设价 -30%
        uint256 hfAfter = pool.getUserHealthFactor(userB);
        console2.log("[7] after -30% ETH price, B HF:", hfAfter, "liquidatable:", pool.isLiquidatable(userB));
        if (hfAfter < WAD) {
            vm.broadcast(liquidatorKey);
            usdc.faucet(10_000e6);
            vm.broadcast(liquidatorKey);
            usdc.approve(address(pool), type(uint256).max);
            vm.broadcast(liquidatorKey);
            pool.liquidate(userB, 0, 0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE, 100_000e6, 0);
            console2.log("[7] liquidated user B; new HF:", pool.getUserHealthFactor(userB));
        } else {
            console2.log("[7] B not liquidatable, skip liquidation");
        }
        vm.broadcast(adminKey);
        switchable.disableSettable(); // PAUSER 切回主源
        console2.log("[7] oracle switched back to primary (Chainlink)");

        // 8. 资金守恒检查
        uint256 lhs = pool.cash() + pool.getTotalBorrows();
        uint256 rhs = pool.getTotalSupply() + pool.totalReserve() + pool.treasuryAccrued();
        bool conserved = lhs > rhs ? (lhs - rhs) < 1e6 : (rhs - lhs) < 1e6;
        console2.log("[8] conserved:", conserved, "(cash+borrows vs supply+reserve+treasury)");

        console2.log("users:", userA, userB);
        console2.log("admin:", admin);
    }
}
