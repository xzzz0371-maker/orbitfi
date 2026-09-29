// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {MockUSDC} from "../src/mocks/MockUSDC.sol";
import {MockToken} from "../src/mocks/MockToken.sol";
import {MockAggregatorV3} from "../src/mocks/MockAggregatorV3.sol";
import {MockPriceOracle} from "../src/mocks/MockPriceOracle.sol";
import {ChainlinkOracle, IAggregatorV3} from "../src/oracle/ChainlinkOracle.sol";
import {SwitchableOracle} from "../src/oracle/SwitchableOracle.sol";
import {InterestRateModel} from "../src/InterestRateModel.sol";
import {RiskManager} from "../src/RiskManager.sol";
import {LiquidationManager} from "../src/LiquidationManager.sol";
import {ReserveManager} from "../src/ReserveManager.sol";
import {RiskEngine} from "../src/risk/RiskEngine.sol";
import {LendingPool} from "../src/LendingPool.sol";

/// @title OrbitFi Sepolia V2 (multi-asset)
/// @dev
///   forge script script/Deploy.s.sol:Deploy --rpc-url $SEPOLIA_RPC_URL --broadcast --verify -vvvv
///          SEPOLIA_RPC_URL / PRIVATE_KEY / ETHERSCAN_API_KEY /
///                 SEPOLIA_ETH_USD_FEED / SEPOLIA_USDC_USD_FEED / [TESTNET_ADMIN]
///          ./deployments/sepolia.json
///  V2：注册 USDT/DAI 借贷市场与 wstETH/WBTC 抵押品，并按保守/锚定档位配置 RiskManager；
///  ETH/USDC 使用真实 Chainlink feed，其余资产使用 MockAggregator（Sepolia 无对应官方 feed）。
contract Deploy is Script {
    address internal constant ETH = 0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE;

    function run() external {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerKey);
        address testnetAdmin = vm.envOr("TESTNET_ADMIN", deployer);
        bool mockFeeds = vm.envOr("MOCK_FEEDS", false);
        address ethUsdFeed = vm.envAddress("SEPOLIA_ETH_USD_FEED");
        address usdcUsdFeed = vm.envAddress("SEPOLIA_USDC_USD_FEED");

        vm.startBroadcast(deployerKey);

        MockUSDC usdc = new MockUSDC();

        if (mockFeeds) {
            MockAggregatorV3 ethAgg = new MockAggregatorV3();
            ethAgg.setData(3000e8, block.timestamp, 8);
            MockAggregatorV3 usdcAgg = new MockAggregatorV3();
            usdcAgg.setData(1e8, block.timestamp, 8);
            ethUsdFeed = address(ethAgg);
            usdcUsdFeed = address(usdcAgg);
        }

        ChainlinkOracle oracle = new ChainlinkOracle();
        oracle.setFeed(ETH, IAggregatorV3(ethUsdFeed), 8);
        oracle.setFeed(address(usdc), IAggregatorV3(usdcUsdFeed), 8);
        oracle.grantRole(oracle.PARAM_ADMIN_ROLE(), testnetAdmin);
        oracle.grantRole(oracle.PAUSER_ROLE(), testnetAdmin);
        MockPriceOracle mockOracle = new MockPriceOracle();

        SwitchableOracle switchable = new SwitchableOracle(oracle);
        switchable.grantRole(switchable.PARAM_ADMIN_ROLE(), testnetAdmin);
        switchable.grantRole(switchable.PAUSER_ROLE(), testnetAdmin);

        InterestRateModel irm = new InterestRateModel();
        irm.applyPreset(InterestRateModel.MarketPreset.NORMAL);
        irm.setMarketGovernor(testnetAdmin);
        irm.transferOwnership(testnetAdmin);

        RiskManager rm = new RiskManager();
        LiquidationManager lm = new LiquidationManager();
        ReserveManager rsv = new ReserveManager(address(usdc));

        LendingPool pool = new LendingPool(usdc, switchable, irm, rm, lm, rsv);

        // ===== V2：额外资产与市场注册 =====
        MockToken usdt = new MockToken("Mock Tether USD", "USDT", 6);
        MockToken dai = new MockToken("Mock Dai Stablecoin", "DAI", 18);
        MockToken wsteth = new MockToken("Mock Wrapped Staked ETH", "wstETH", 18);
        MockToken wbtc = new MockToken("Mock Wrapped Bitcoin", "WBTC", 8);

        // 借贷市场：USDT(6) / DAI(18)
        pool.addMarket(address(usdt), 6);
        pool.addMarket(address(dai), 18);
        // 抵押品：wstETH(18, 与 ETH 同档) / WBTC(8, 保守档)
        pool.addCollateral(address(wsteth), 18);
        pool.addCollateral(address(wbtc), 8);

        // ETH 哨兵档位：RiskManager 构造已预置同表，此处显式声明（防御性，防构造默认被误改）。
        _setRiskTiers(rm, ETH, false); // 与 wstETH 相同：50/60/70/75/80 LTV
        _setRiskTiers(rm, address(wsteth), false); // 与 ETH 相同：50/60/70/75/80
        _setRiskTiers(rm, address(wbtc), true); // 保守：45/55/65/70/75
        _verifyEthTiers(rm); // 部署后验证 ETH 5 档非 0

        // 其余资产无真实 Sepolia feed → 注册 MockAggregator feed，主源可直接读价
        address[4] memory extraAssets = [address(usdt), address(dai), address(wsteth), address(wbtc)];
        uint256[4] memory extraPrices = [uint256(1e8), 1e8, 3000e8, 100_000e8];
        for (uint256 i = 0; i < extraAssets.length; i++) {
            MockAggregatorV3 agg = new MockAggregatorV3();
            agg.setData(int256(extraPrices[i]), block.timestamp, 8);
            oracle.setFeed(extraAssets[i], IAggregatorV3(address(agg)), 8);
        }

        // ===== RiskEngine / init / roles =====
        RiskEngine re = new RiskEngine(address(oracle), address(pool));
        re.grantRole(re.PARAM_ADMIN_ROLE(), testnetAdmin);

        rsv.setLendingPool(address(pool));
        pool.grantRole(pool.PARAM_ADMIN_ROLE(), testnetAdmin);
        pool.grantRole(pool.PAUSER_ROLE(), testnetAdmin);
        rsv.transferOwnership(testnetAdmin);
        rm.transferOwnership(testnetAdmin);

        vm.stopBroadcast();

        console2.log("=== OrbitFi Sepolia V2 ===");
        console2.log("Deployer:      ", deployer);
        console2.log("TestnetAdmin:  ", testnetAdmin);
        console2.log("MockUSDC:      ", address(usdc));
        console2.log("USDT:          ", address(usdt));
        console2.log("DAI:           ", address(dai));
        console2.log("wstETH:        ", address(wsteth));
        console2.log("WBTC:          ", address(wbtc));
        console2.log("ChainlinkOracle:", address(oracle));
        console2.log("SwitchableOracle:", address(switchable));
        console2.log("InterestRateModel:", address(irm));
        console2.log("RiskManager:   ", address(rm));
        console2.log("LiquidationManager:", address(lm));
        console2.log("ReserveManager:", address(rsv));
        console2.log("RiskEngine:    ", address(re));
        console2.log("LendingPool:   ", address(pool));

        string memory obj;
        obj = vm.serializeUint("root", "chainId", block.chainid);
        obj = vm.serializeAddress("root", "usdc", address(usdc));
        obj = vm.serializeAddress("root", "usdt", address(usdt));
        obj = vm.serializeAddress("root", "dai", address(dai));
        obj = vm.serializeAddress("root", "wsteth", address(wsteth));
        obj = vm.serializeAddress("root", "wbtc", address(wbtc));
        obj = vm.serializeAddress("root", "oracle", address(oracle));
        obj = vm.serializeAddress("root", "switchableOracle", address(switchable));
        obj = vm.serializeAddress("root", "mockOracle", address(mockOracle));
        obj = vm.serializeAddress("root", "interestRateModel", address(irm));
        obj = vm.serializeAddress("root", "riskManager", address(rm));
        obj = vm.serializeAddress("root", "liquidationManager", address(lm));
        obj = vm.serializeAddress("root", "reserveManager", address(rsv));
        obj = vm.serializeAddress("root", "riskEngine", address(re));
        obj = vm.serializeAddress("root", "lendingPool", address(pool));
        obj = vm.serializeAddress("root", "testnetAdmin", testnetAdmin);
        obj = vm.serializeString("root", "ethUsdFeed", vm.toString(ethUsdFeed));
        obj = vm.serializeString("root", "usdcUsdFeed", vm.toString(usdcUsdFeed));
        vm.writeJson(obj, "./deployments/sepolia.json");
    }

    function _setRiskTiers(RiskManager rm, address token, bool conservative) internal {
        if (conservative) {
            uint256[5] memory ltv = [uint256(45e16), 55e16, 65e16, 7e17, 75e16];
            uint256[5] memory lt = [uint256(55e16), 65e16, 75e16, 8e17, 85e16];
            for (uint256 i = 0; i < 5; i++) {
                rm.setTier(token, i + 1, ltv[i], lt[i]);
            }
        } else {
            uint256[5] memory ltv = [uint256(5e17), 6e17, 7e17, 75e16, 8e17];
            uint256[5] memory lt = [uint256(6e17), 7e17, 78e16, 85e16, 9e17];
            for (uint256 i = 0; i < 5; i++) {
                rm.setTier(token, i + 1, ltv[i], lt[i]);
            }
        }
    }

    /// @notice 部署后验证：ETH 哨兵 5 个档位 LTV 均非 0（防止档位缺失导致借款全废）。
    function _verifyEthTiers(RiskManager rm) internal view {
        for (uint256 i = 1; i <= 5; i++) {
            uint256 ltv = rm.getMaxLTV(ETH, i);
            uint256 lt = rm.getLiquidationThreshold(ETH, i);
            require(ltv > 0 && lt > ltv, "ETH tier misconfigured");
            console2.log("ETH tier", i, "LTV=", ltv);
            console2.log("ETH tier", i, "LT=", lt);
        }
    }
}
