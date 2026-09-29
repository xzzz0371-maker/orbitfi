// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

interface IInterestRateModel {
    /// @notice Returns the per-second borrow rate in WAD given utilization (WAD) and tier (1..5).
    function getBorrowRatePerSecond(uint256 utilization, uint256 tier) external view returns (uint256);
}

contract InterestRateModel is Ownable, IInterestRateModel {
    uint256 public constant WAD = 1e18;
    uint256 public constant SECONDS_PER_YEAR = 31536000;
    uint256 public constant MAX_TIERS = 5;

    enum MarketPreset {
        NORMAL,
        HIGH_VOLATILITY,
        EXTREME
    }

    uint256 public baseRatePerSecond;
    uint256 public slope1PerSecond;
    /// @notice kink1（首段→中段）利用率，默认 80%。
    uint256 public kinkUtilization = 8e17;
    /// @notice 中段斜率（kink1..kink2），NORMAL = 25%。
    uint256 public slope2aPerSecond;
    /// @notice kink2（中段→末段）利用率，NORMAL = 85%。
    uint256 public kink2Utilization = 85e16;
    /// @notice 末段斜率（>kink2），NORMAL = 50%（保留原 slope2 语义，但起点改为 kink2）。
    uint256 public slope2PerSecond;
    uint256[6] public tierPremiumPerSecond;

    MarketPreset public activePreset = MarketPreset.NORMAL;
    address public marketGovernor;

    event ParamsUpdated(uint256 baseRate, uint256 slope1, uint256 slope2, uint256 kink);
    event Slope2aUpdated(uint256 slope2a);
    event Kink2Updated(uint256 kink2);
    event TierPremiumUpdated(uint256 tier, uint256 premium);
    event PresetApplied(MarketPreset preset);
    event MarketGovernorUpdated(address governor);

    constructor() Ownable(msg.sender) {
        _applyNormal();
    }

    /// @notice 设置段参数：base / slope1（0..kink1）/ slope2（kink2 以上）/ kink1。
    ///         若 kink1 超过当前 kink2，kink2 自动抬升至 kink1（保持有序，中段宽度为 0）。
    function setParams(uint256 baseRate, uint256 slope1, uint256 slope2, uint256 kink) external onlyOwner {
        require(kink <= WAD, "kink>WAD");
        baseRatePerSecond = _aprToPerSecond(baseRate);
        slope1PerSecond = _aprToPerSecond(slope1);
        slope2PerSecond = _aprToPerSecond(slope2);
        kinkUtilization = kink;
        if (kink2Utilization < kinkUtilization) kink2Utilization = kinkUtilization;
        emit ParamsUpdated(baseRate, slope1, slope2, kink);
    }

    /// @notice 设置中段斜率 slope2a（kink1..kink2）。
    function setSlope2a(uint256 slope2a) external onlyOwner {
        slope2aPerSecond = _aprToPerSecond(slope2a);
        emit Slope2aUpdated(slope2a);
    }

    /// @notice 设置第二个拐点利用率 kink2（≥ kink1）。
    function setKink2(uint256 kink2) external onlyOwner {
        require(kink2 >= kinkUtilization && kink2 <= WAD, "kink2 out of range");
        kink2Utilization = kink2;
        emit Kink2Updated(kink2);
    }

    function setTierPremium(uint256 tier, uint256 premium) external onlyOwner {
        require(tier >= 1 && tier <= MAX_TIERS, "bad tier");
        tierPremiumPerSecond[tier] = _aprToPerSecond(premium);
        emit TierPremiumUpdated(tier, premium);
    }

    /// @notice 设置市场参数切换者（通常为 LendingPool 的 PARAM_ADMIN 持有者）。
    function setMarketGovernor(address governor) external onlyOwner {
        require(governor != address(0), "zero address");
        marketGovernor = governor;
        emit MarketGovernorUpdated(governor);
    }

    /// @notice 应用预设市场参数。owner 或 marketGovernor 可切换。
    function applyPreset(MarketPreset preset) external {
        require(msg.sender == owner() || msg.sender == marketGovernor, "not governor");
        if (preset == MarketPreset.NORMAL) {
            _applyNormal();
        } else if (preset == MarketPreset.HIGH_VOLATILITY) {
            _applyHighVolatility();
        } else {
            _applyExtreme();
        }
        activePreset = preset;
        emit PresetApplied(preset);
    }

    /// @notice 正常市场（三段式），对标 Aave v3 Base 的 90.5% 最优利用率：
    ///         0..90.5% 斜率 3%；90.5..95% 斜率 40%；>95% 斜率 150%。
    ///         目标（tier1）：80%→4.40%、90.5%→4.72%、95%→6.52%、100%→14.02%。
    ///         取向：前 90% 保持便宜以对标 Aave（@90% T1 = 4.70% vs Aave ~4.6%），
    ///         最后 10% 陡增以保住提现安全。
    function _applyNormal() internal {
        baseRatePerSecond = _aprToPerSecond(0.02e18);
        slope1PerSecond = _aprToPerSecond(0.03e18);
        slope2aPerSecond = _aprToPerSecond(0.4e18);
        slope2PerSecond = _aprToPerSecond(1.5e18);
        kinkUtilization = 905e15;
        kink2Utilization = 95e16;
        tierPremiumPerSecond[1] = _aprToPerSecond(0);
        tierPremiumPerSecond[2] = _aprToPerSecond(0.005e18);
        tierPremiumPerSecond[3] = _aprToPerSecond(0.01e18);
        tierPremiumPerSecond[4] = _aprToPerSecond(0.015e18);
        tierPremiumPerSecond[5] = _aprToPerSecond(0.025e18);
    }

    /// @notice 高波动市场：保持两段（kink2 = kink1，中段宽度为 0），曲线与历史一致。
    function _applyHighVolatility() internal {
        baseRatePerSecond = _aprToPerSecond(0.02e18);
        slope1PerSecond = _aprToPerSecond(0.2e18);
        slope2aPerSecond = _aprToPerSecond(1.5e18);
        slope2PerSecond = _aprToPerSecond(1.5e18);
        kinkUtilization = 65e16;
        kink2Utilization = 65e16;
        tierPremiumPerSecond[1] = _aprToPerSecond(0);
        tierPremiumPerSecond[2] = _aprToPerSecond(0.01e18);
        tierPremiumPerSecond[3] = _aprToPerSecond(0.03e18);
        tierPremiumPerSecond[4] = _aprToPerSecond(0.05e18);
        tierPremiumPerSecond[5] = _aprToPerSecond(0.08e18);
    }

    /// @notice 极端市场：保持两段（kink2 = kink1），曲线与历史一致。高 LTV 档借款由 RiskManager 另行暂停。
    function _applyExtreme() internal {
        baseRatePerSecond = _aprToPerSecond(0.05e18);
        slope1PerSecond = _aprToPerSecond(0.4e18);
        slope2aPerSecond = _aprToPerSecond(3e18);
        slope2PerSecond = _aprToPerSecond(3e18);
        kinkUtilization = 5e17;
        kink2Utilization = 5e17;
        tierPremiumPerSecond[1] = _aprToPerSecond(0);
        tierPremiumPerSecond[2] = _aprToPerSecond(0.02e18);
        tierPremiumPerSecond[3] = _aprToPerSecond(0.05e18);
        tierPremiumPerSecond[4] = _aprToPerSecond(0.08e18);
        tierPremiumPerSecond[5] = _aprToPerSecond(0.12e18);
    }

    function getBorrowRatePerSecond(uint256 utilization, uint256 tier) public view returns (uint256) {
        uint256 rate = baseRatePerSecond;
        if (utilization <= kinkUtilization) {
            rate += slope1PerSecond * utilization / WAD;
        } else if (utilization <= kink2Utilization) {
            rate += slope1PerSecond * kinkUtilization / WAD;
            rate += slope2aPerSecond * (utilization - kinkUtilization) / WAD;
        } else {
            rate += slope1PerSecond * kinkUtilization / WAD;
            rate += slope2aPerSecond * (kink2Utilization - kinkUtilization) / WAD;
            rate += slope2PerSecond * (utilization - kink2Utilization) / WAD;
        }
        return rate + tierPremiumPerSecond[tier];
    }

    function getBorrowAPR(uint256 utilization, uint256 tier) external view returns (uint256) {
        return getBorrowRatePerSecond(utilization, tier) * SECONDS_PER_YEAR;
    }

    function _aprToPerSecond(uint256 apr) internal pure returns (uint256) {
        return apr / SECONDS_PER_YEAR;
    }
}
