// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.24;

import {BaseSetup} from "./BaseSetup.t.sol";
import {InterestRateModel} from "../src/InterestRateModel.sol";

contract RatePresetsTest is BaseSetup {
    function _aprAt(InterestRateModel m, uint256 utilization, uint256 tier) internal view returns (uint256) {
        return m.getBorrowAPR(utilization, tier);
    }

    function test_NormalPresetCurve() public {
        // 默认即 NORMAL
        assertEq(uint256(irm.activePreset()), uint256(InterestRateModel.MarketPreset.NORMAL));
        // util=0 => baseRate 2%
        assertApproxEqAbs(_aprAt(irm, 0, 1), 2e16, 1e14);
        // kink1=90.5%：单调递增
        uint256 prev = 0;
        for (uint256 u = 0; u <= 100; u += 10) {
            uint256 apr = _aprAt(irm, u * 1e16, 1);
            assertGe(apr, prev);
            prev = apr;
        }
        // util=80% => 2% + 3%×0.8 = 4.4%
        assertApproxEqAbs(_aprAt(irm, 8e17, 1), 4.4e16, 1e14);
        // util=85%（仍在首段）=> 2% + 3%×0.85 = 4.55%
        assertApproxEqAbs(_aprAt(irm, 85e16, 1), 4.55e16, 1e14);
        // util=90% => 2% + 3%×0.9 = 4.7%（对标 Aave v3 Base ~4.6%）
        assertApproxEqAbs(_aprAt(irm, 9e17, 1), 4.7e16, 1e14);
        // util=100% => 4.715% + 40%×0.045 + 150%×0.05 = 14.015%
        assertApproxEqAbs(_aprAt(irm, 1e18, 1), 14.015e16, 1e14);
        // 两处拐点参数生效
        assertEq(irm.kinkUtilization(), 905e15);
        assertEq(irm.kink2Utilization(), 95e16);
        // 档位溢价：0 / 0.5 / 1 / 1.5 / 2.5%
        assertApproxEqAbs(_aprAt(irm, 5e17, 2) - _aprAt(irm, 5e17, 1), 0.5e16, 1e14);
        assertApproxEqAbs(_aprAt(irm, 5e17, 5) - _aprAt(irm, 5e17, 1), 2.5e16, 1e14);
    }

    function test_HighVolatilityPresetCurve() public {
        vm.prank(admin); // marketGovernor
        irm.applyPreset(InterestRateModel.MarketPreset.HIGH_VOLATILITY);
        assertEq(uint256(irm.activePreset()), uint256(InterestRateModel.MarketPreset.HIGH_VOLATILITY));
        assertApproxEqAbs(_aprAt(irm, 0, 1), 2e16, 1e14);
        uint256 prev = 0;
        for (uint256 u = 0; u <= 100; u += 10) {
            uint256 apr = _aprAt(irm, u * 1e16, 1);
            assertGe(apr, prev);
            prev = apr;
        }
        // util=100% => 2% + 20%*0.65 + 150%*0.35 = 67.5%
        assertApproxEqAbs(_aprAt(irm, 1e18, 1), 67.5e16, 1e14);
        // 高波动档位溢价更高
        assertGt(_aprAt(irm, 5e17, 5), _aprAt(irm, 5e17, 1));
    }

    function test_ExtremePresetCurve() public {
        vm.prank(admin);
        irm.applyPreset(InterestRateModel.MarketPreset.EXTREME);
        assertEq(uint256(irm.activePreset()), uint256(InterestRateModel.MarketPreset.EXTREME));
        assertApproxEqAbs(_aprAt(irm, 0, 1), 5e16, 1e14);
        uint256 prev = 0;
        for (uint256 u = 0; u <= 100; u += 10) {
            uint256 apr = _aprAt(irm, u * 1e16, 1);
            assertGe(apr, prev);
            prev = apr;
        }
        // util=100% => 5% + 40%*0.5 + 300%*0.5 = 175%
        assertApproxEqAbs(_aprAt(irm, 1e18, 1), 175e16, 1e14);
    }

    function test_PresetSwitchableOnlyByOwnerOrGovernor() public {
        vm.expectRevert(bytes("not governor"));
        vm.prank(alice);
        irm.applyPreset(InterestRateModel.MarketPreset.EXTREME);
        // owner（测试合约）也可切换
        irm.applyPreset(InterestRateModel.MarketPreset.HIGH_VOLATILITY);
        assertEq(uint256(irm.activePreset()), uint256(InterestRateModel.MarketPreset.HIGH_VOLATILITY));
    }

    function test_ExtremePresetPausesHighTierBorrow() public {
        vm.prank(admin);
        irm.applyPreset(InterestRateModel.MarketPreset.EXTREME);
        // 风险参数：极端市场只允许 tier<=3 借款
        riskManager.setMaxBorrowTier(3);
        assertEq(riskManager.getMaxBorrowTier(), 3);

        _supply(bob, 100_000e6);
        _supplyCollateral(alice, 2 ether);
        _borrow(alice, 3000e6, 3); // tier3 可用

        // 新借款人用 tier4/tier5 被暂停
        _supplyCollateral(bob, 2 ether);
        vm.expectRevert(bytes("tier disabled"));
        _borrow(bob, 1000e6, 4);
        vm.expectRevert(bytes("tier disabled"));
        _borrow(bob, 1000e6, 5);

        // 恢复所有档位
        riskManager.setMaxBorrowTier(5);
        _borrow(bob, 500e6, 5);
        assertGt(pool.getDebt(bob), 0);
    }

    function test_PresetsAreConfigurableNotHardcoded() public {
        // 预设可被 owner 覆盖为自定义参数
        irm.setParams(0.5e16, 0.1e18, 0.3e18, 9e17);
        assertApproxEqAbs(_aprAt(irm, 0, 1), 0.5e16, 1e14);
        // 再切回预设
        irm.applyPreset(InterestRateModel.MarketPreset.NORMAL);
        assertApproxEqAbs(_aprAt(irm, 0, 1), 2e16, 1e14);
    }
}
