// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {InterestRateModel} from "../src/InterestRateModel.sol";

contract InterestRateModelTest is Test {
    InterestRateModel internal irm;

    function setUp() public {
        irm = new InterestRateModel();
    }

    function test_RateIncreasesWithUtilization() public view {
        uint256 r0 = irm.getBorrowRatePerSecond(0, 1);
        uint256 r50 = irm.getBorrowRatePerSecond(5e17, 1);
        uint256 r100 = irm.getBorrowRatePerSecond(1e18, 1);
        assertGt(r50, r0);
        assertGt(r100, r50);
    }

    function test_HigherTierHigherRate() public view {
        uint256 r1 = irm.getBorrowRatePerSecond(5e17, 1);
        uint256 r5 = irm.getBorrowRatePerSecond(5e17, 5);
        assertGt(r5, r1);
    }

    function test_AnnualizedRateAtHalfUtilization() public view {
        // base 2% + slope1 3% * 0.5 = 3.5% APR for tier 1
        uint256 apr = irm.getBorrowAPR(5e17, 1);
        assertApproxEqAbs(apr, 3.5e16, 1e15);
    }

    function test_NormalZeroUtilizationBorrowAPR() public view {
        // NORMAL 预设 utilization=0 时 Borrow APR = baseRate = 2%
        uint256 apr = irm.getBorrowAPR(0, 1);
        assertApproxEqAbs(apr, 2e16, 1e15);
    }

    function test_AboveKinkRateJumps() public view {
        uint256 belowKink = irm.getBorrowAPR(79e16, 1);
        uint256 aboveKink = irm.getBorrowAPR(81e16, 1);
        assertGt(aboveKink, belowKink);
    }

    /// @notice NORMAL 三段式：80 / 90.5 / 90.51 / 95 / 100 的边界值与连续性（tier1，无溢价）。
    function test_ThreeSegmentCurveNormal() public view {
        // 2% + 3%*0.8 = 4.4%
        assertApproxEqAbs(irm.getBorrowAPR(8e17, 1), 4.4e16, 1e10);
        // 2% + 3%*0.905 = 4.715%（kink1 上边界，属首段）
        assertApproxEqAbs(irm.getBorrowAPR(905e15, 1), 4.715e16, 1e10);
        // 90.51% → 中段起点：4.715% + 40%*0.0001 = 4.719%（段间连续性）
        uint256 justAbove = irm.getBorrowAPR(9051e14, 1);
        assertApproxEqAbs(justAbove, 4.719e16, 1e10);
        // 4.715% + 40%*0.045 = 6.515%（kink2 上边界，属中段）
        assertApproxEqAbs(irm.getBorrowAPR(95e16, 1), 6.515e16, 1e10);
        // 6.515% + 150%*0.05 = 14.015%
        assertApproxEqAbs(irm.getBorrowAPR(1e18, 1), 14.015e16, 1e10);
        // 单调性：80 → 90.5 → 90.51 → 95 → 100
        assertGe(irm.getBorrowAPR(905e15, 1), irm.getBorrowAPR(8e17, 1));
        assertGe(justAbove, irm.getBorrowAPR(905e15, 1));
        assertGe(irm.getBorrowAPR(95e16, 1), justAbove);
        assertGe(irm.getBorrowAPR(1e18, 1), irm.getBorrowAPR(95e16, 1));
        // 段斜率不同：80→90.5 增 0.315%，90.5→95 增 1.8%（后段更陡）
        uint256 seg1 = irm.getBorrowAPR(905e15, 1) - irm.getBorrowAPR(8e17, 1);
        uint256 seg2 = irm.getBorrowAPR(95e16, 1) - irm.getBorrowAPR(905e15, 1);
        assertApproxEqAbs(seg1, 0.315e16, 1e10);
        assertApproxEqAbs(seg2, 1.8e16, 1e10);
    }

    function test_SetSlope2aAndKink2OnlyOwner() public {
        vm.prank(makeAddr("attacker"));
        vm.expectRevert();
        irm.setSlope2a(3e17);
        vm.prank(makeAddr("attacker"));
        vm.expectRevert();
        irm.setKink2(96e16);
        // owner 可配；注意 kink1 现为 90.5%，setKink2 不得低于它
        irm.setSlope2a(3e17); // 中段斜率 30%
        irm.setKink2(96e16); // kink2 = 96%
        // util 95%：2% + 3%*0.905 + 30%*(0.95-0.905) = 2% + 2.715% + 1.35% = 6.065%
        assertApproxEqAbs(irm.getBorrowAPR(95e16, 1), 6.065e16, 1e14);
        vm.expectRevert(bytes("kink2 out of range"));
        irm.setKink2(7e17); // 70% < kink1 90.5%
    }

    function test_SetParamsOnlyOwner() public {
        vm.prank(makeAddr("attacker"));
        vm.expectRevert();
        irm.setParams(0, 0, 0, 8e17);
    }

    function test_KinkMustBeAtMostWad() public {
        vm.expectRevert(bytes("kink>WAD"));
        irm.setParams(0, 0, 0, 1e18 + 1);
    }

    function test_SetTierPremiumOnlyOwner() public {
        vm.prank(makeAddr("attacker"));
        vm.expectRevert();
        irm.setTierPremium(5, 1e17);
    }

    function test_SetTierPremiumSuccess() public {
        irm.setTierPremium(5, 8e16);
        assertApproxEqAbs(irm.getBorrowAPR(5e17, 5) - irm.getBorrowAPR(5e17, 1), 8e16, 1e14);
        vm.expectRevert(bytes("bad tier"));
        irm.setTierPremium(6, 1e17);
    }
}
