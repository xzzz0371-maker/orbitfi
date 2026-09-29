// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IPriceOracle} from "./interfaces/IPriceOracle.sol";
import {IInterestRateModel} from "./InterestRateModel.sol";
import {IRiskManager} from "./RiskManager.sol";
import {ILiquidationManager} from "./LiquidationManager.sol";
import {IReserveManager} from "./ReserveManager.sol";

/// @title OrbitFi LendingPool V2 (multi-asset)
/// @notice 单合约多市场：可注册多个借贷资产（USDC/USDT/DAI…）与多个抵押资产（ETH/wstETH/WBTC…）。
///         每个借贷资产为独立市场（独立现金/供应指数/利率/储备/坏账）；抵押品在池内跨资产记账。
///         tier 为全局仓位属性：首笔借款锁定，此后所有市场的借款必须同档（与 V1 一致）。
///         市场 0 由构造注册（默认 USDC）、抵押品 0 为原生 ETH；不带市场/抵押参数的
///         动作与视图默认绑定市场 0 / ETH，行为与 V1 完全一致（存量测试/前端语义不变）。
contract LendingPool is AccessControl, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;
    uint256 public constant WAD = 1e18;
    uint256 public constant MAX_TIERS = 5;
    uint256 public constant MAX_MARKETS = 8;
    uint256 public constant MAX_COLLATERALS = 8;
    uint256 public constant SECONDS_PER_YEAR = 31536000;
    uint256 public constant PRICE_SCALE = 1e8;
    uint256 public constant DUST_THRESHOLD = 100;
    uint256 public constant MIN_SUPPLY_BASE = 10; // 最小存款（整 token 数）
    uint256 public constant MIN_BORROW_BASE = 100; // 最小借款（整 token 数）
    uint256 public constant MIN_COLLATERAL_UNITS = 0.01 ether; // 最小抵押 0.01（WAD 形式，按精度缩放）
    address public constant ETH = 0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE;

    bytes32 public constant PARAM_ADMIN_ROLE = keccak256("PARAM_ADMIN_ROLE");
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");

    IPriceOracle public priceOracle;
    IInterestRateModel public interestRateModel;
    IRiskManager public riskManager;
    ILiquidationManager public liquidationManager;
    IReserveManager public reserveManager;

    struct Market {
        IERC20 asset;
        uint8 decimals;
        uint8 enabled;
        uint256 wadScale; // 10^(18-decimals)
        uint256 cash;
        uint256 totalShares;
        uint256 supplyIndex;
        uint256 lastAccrual;
        uint256 totalReserve;
        uint256 treasuryAccrued;
        uint256[6] borrowIndexByTier;
        uint256[6] totalNormalizedByTier;
    }

    struct Collateral {
        address token;
        uint8 decimals;
        uint8 enabled;
        uint256 wadScale;
    }

    Market[] internal _markets;
    Collateral[] internal _collaterals;
    mapping(address => uint256) internal _marketIndex;
    mapping(address => uint256) internal _collateralIndex;

    mapping(address => mapping(uint8 => uint256)) public userShares;
    mapping(address => mapping(uint8 => uint256)) public userBorrowNorm;
    mapping(address => mapping(uint8 => uint8)) public userTier;
    mapping(address => uint8) public userGlobalTier; // 0 = 无借款
    mapping(address => mapping(uint256 => uint256)) public userCollateral;

    uint256 public reserveTargetRatio = 3e16;
    uint256 public reserveFactor = 4e16;
    uint256 public treasuryFactor = 2e16;
    address public treasuryAddress;

    // ===== 上限风控（每市场供应上限 / 每抵押品上限；0 = 不限制，主网白名单逐项配置）=====
    /// @notice 市场总供应上限（token 单位，含累计利息）。0 = 无上限。
    mapping(uint8 => uint256) public marketSupplyCap;
    /// @notice 抵押品总量上限（token 原始单位）。0 = 无上限。
    mapping(uint8 => uint256) public collateralCap;
    /// @notice 池内当前各抵押品总量账本（raw 单位），供 collateralCap 判定。
    mapping(uint8 => uint256) public collateralTotal;

    event Supplied(address indexed user, uint256 amount, uint256 shares);
    event Withdrawn(address indexed user, uint256 amount, uint256 shares);
    event CollateralSupplied(address indexed user, uint256 amount);
    event CollateralWithdrawn(address indexed user, uint256 amount);
    event Borrowed(address indexed user, uint256 tier, uint256 amount, uint256 newLtv, uint256 healthFactor);
    event Repaid(address indexed user, uint256 amount, uint256 remainingDebt);
    event Liquidated(
        address indexed liquidator,
        address indexed target,
        uint256 debtCovered,
        uint256 collateralSeized,
        uint256 postHealthFactor
    );
    event InterestAccrued(uint256 interest, uint256 intervalSeconds);
    event BadDebtRealized(
        address indexed user,
        uint256 badDebtAmount,
        uint256 coveredByReserve,
        uint256 lossToDepositors,
        uint256 oldSupplyIndex,
        uint256 newSupplyIndex
    );
    event ReserveSkimmed(uint256 amount);
    event ReserveTargetRatioUpdated(uint256 value);
    event ReserveFactorUpdated(uint256 value);
    event TreasuryFactorUpdated(uint256 value);
    event ReserveOverflowTransferred(uint256 amount);
    event TreasuryAddressUpdated(address value);
    event TreasuryCollected(uint256 amount, address to);

    event MarketAdded(uint8 marketId, address indexed asset, uint8 decimals);
    event CollateralAdded(uint8 collId, address indexed token, uint8 decimals);
    event MarketSupplied(uint8 marketId, address indexed user, uint256 amount, uint256 shares);
    event MarketWithdrawn(uint8 marketId, address indexed user, uint256 amount, uint256 shares);
    event MarketBorrowed(uint8 marketId, address indexed user, uint8 tier, uint256 amount);
    event MarketRepaid(uint8 marketId, address indexed user, uint256 amount, uint256 remainingDebt);
    event MarketLiquidated(
        uint8 marketId,
        address indexed liquidator,
        address indexed target,
        uint8 collId,
        uint256 debtCovered,
        uint256 collateralSeized,
        uint256 postHealthFactor
    );
    event CollateralSuppliedAsset(uint8 collId, address indexed user, uint256 amount);
    event CollateralWithdrawnAsset(uint8 collId, address indexed user, uint256 amount);
    event MarketReserveSkimmed(uint8 marketId, uint256 amount);
    event MarketTreasuryCollected(uint8 marketId, uint256 amount, address to);

    constructor(
        IERC20 usdc_,
        IPriceOracle oracle_,
        IInterestRateModel interestRateModel_,
        IRiskManager riskManager_,
        ILiquidationManager liquidationManager_,
        IReserveManager reserveManager_
    ) {
        priceOracle = oracle_;
        interestRateModel = interestRateModel_;
        riskManager = riskManager_;
        liquidationManager = liquidationManager_;
        reserveManager = reserveManager_;
        _addMarketInternal(address(usdc_), 6);
        _addCollateralInternal(ETH, 18);
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(PARAM_ADMIN_ROLE, msg.sender);
        _grantRole(PAUSER_ROLE, msg.sender);
    }

    // ==================== User actions (V1-compat: market 0 / ETH collateral) ====================

    function supplyCollateral() external payable nonReentrant whenNotPaused {
        uint256 amount = _supplyCollateralCore(0, msg.value);
    }

    function skimReserve() external nonReentrant {
        uint256 amount = _skimReserveCore(0);
    }

    function accrue() external {
        _accrueAll();
    }

    function collectTreasury() external nonReentrant {
        (uint256 amount,) = _collectTreasuryCore(0);
    }

    /// @notice 按市场提取该市场累计 Treasury（USDT/DAI 等）。任何人可调用；treasuryAddress 为零时 revert。
    function collectTreasury(uint8 marketId) external nonReentrant {
        (uint256 amount,) = _collectTreasuryCore(marketId);
    }

    // ==================== User actions (V2: market / collateral aware) ====================

    function supply(uint8 marketId, uint256 amount) external nonReentrant whenNotPaused {
        uint256 shares = _supplyCore(marketId, amount);
    }

    function withdraw(uint8 marketId, uint256 shares) external nonReentrant {
        uint256 amount = _withdrawCore(marketId, shares);
    }

    function supplyCollateral(address token, uint256 amount) external nonReentrant whenNotPaused {
        uint8 collId = _requireCollateral(token);
        require(amount >= _minCollateral(collId), "value below min");
        _supplyCollateralCore(collId, amount);
    }

    function withdrawCollateral(address token, uint256 amount) external nonReentrant {
        uint8 collId = _requireCollateral(token);
        _withdrawCollateralCore(collId, amount);
    }

    function borrow(uint8 marketId, uint256 amount, uint256 tier) external nonReentrant whenNotPaused {
        (uint256 newLtv, uint256 hf) = _borrowCore(marketId, amount, tier);
    }

    function repay(uint8 marketId, uint256 amount) external nonReentrant {
        (uint256 repayAmount, uint256 remainingDebt) = _repayCore(marketId, amount);
    }

    /// @param collToken 清算人要收取的抵押品 token（ETH 哨兵或已注册 ERC20）。
    function liquidate(address target, uint8 marketId, address collToken, uint256 debtToCover, uint256 minSeizeAmount)
        external
        nonReentrant
    {
        uint8 collId = _requireCollateral(collToken);
        (uint256 covered, uint256 seized, uint256 postHf) =
            _liquidateCore(marketId, target, collId, debtToCover, minSeizeAmount);
    }

    function handleBadDebt(address target, uint8 marketId) external nonReentrant {
        _handleBadDebtCore(marketId, target);
    }

    // ==================== Admin ====================

    function addMarket(address token, uint8 decimals) external onlyRole(PARAM_ADMIN_ROLE) {
        _addMarketInternal(token, decimals);
    }

    function addCollateral(address token, uint8 decimals) external onlyRole(PARAM_ADMIN_ROLE) {
        _addCollateralInternal(token, decimals);
    }

    function setPriceOracle(IPriceOracle oracle) external onlyRole(PARAM_ADMIN_ROLE) {
        require(address(oracle) != address(0), "zero address");
        priceOracle = oracle;
    }

    function setInterestRateModel(IInterestRateModel model) external onlyRole(PARAM_ADMIN_ROLE) {
        require(address(model) != address(0), "zero address");
        interestRateModel = model;
    }

    function setRiskManager(IRiskManager manager) external onlyRole(PARAM_ADMIN_ROLE) {
        require(address(manager) != address(0), "zero address");
        riskManager = manager;
    }

    function setLiquidationManager(ILiquidationManager manager) external onlyRole(PARAM_ADMIN_ROLE) {
        require(address(manager) != address(0), "zero address");
        liquidationManager = manager;
    }

    function setReserveManager(IReserveManager manager) external onlyRole(PARAM_ADMIN_ROLE) {
        require(address(manager) != address(0), "zero address");
        require(address(manager).code.length > 0, "not a contract");
        reserveManager = manager;
    }

    function setReserveTargetRatio(uint256 value) external onlyRole(PARAM_ADMIN_ROLE) {
        require(value <= WAD, "ratio>100%");
        reserveTargetRatio = value;
        emit ReserveTargetRatioUpdated(value);
    }

    function setReserveFactor(uint256 value) external onlyRole(PARAM_ADMIN_ROLE) {
        require(value <= WAD, "factor>100%");
        require(value + treasuryFactor <= WAD, "fees>100%");
        reserveFactor = value;
        emit ReserveFactorUpdated(value);
    }

    function setTreasuryFactor(uint256 value) external onlyRole(PARAM_ADMIN_ROLE) {
        require(value <= WAD, "fee>100%");
        require(value + reserveFactor <= WAD, "fees>100%");
        treasuryFactor = value;
        emit TreasuryFactorUpdated(value);
    }

    function setTreasuryAddress(address value) external onlyRole(PARAM_ADMIN_ROLE) {
        require(value != address(0), "zero address");
        treasuryAddress = value;
        emit TreasuryAddressUpdated(value);
    }

    /// @notice 设置市场总供应上限（token 单位）。0 = 解除限制。
    function setMarketSupplyCap(uint8 marketId, uint256 cap) external onlyRole(PARAM_ADMIN_ROLE) {
        _market(marketId); // 校验 marketId 存在
        marketSupplyCap[marketId] = cap;
    }

    /// @notice 设置抵押品总量上限（raw 单位）。0 = 解除限制。
    function setCollateralCap(uint8 collId, uint256 cap) external onlyRole(PARAM_ADMIN_ROLE) {
        require(collId < _collaterals.length, "bad collateral");
        collateralCap[collId] = cap;
    }

    function pause() external onlyRole(PAUSER_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(PAUSER_ROLE) {
        _unpause();
    }

    // ==================== Views (market 0 / V1-compat) ====================

    function getTotalBorrows() public view returns (uint256) {
        return _totalBorrowsToken(0);
    }

    function getTotalSupply() public view returns (uint256) {
        return _totalSupplyToken(0);
    }

    function getUtilization() public view returns (uint256) {
        return _utilization(0);
    }

    function getBorrowAPR(uint256 tier) external view returns (uint256) {
        return _getBorrowAPR(0, tier);
    }

    function getSupplyAPR() external view returns (uint256) {
        return _getSupplyAPR(0);
    }

    function cash() external view returns (uint256) {
        return _markets[0].cash;
    }

    function totalShares() external view returns (uint256) {
        return _markets[0].totalShares;
    }

    function supplyIndex() external view returns (uint256) {
        return _markets[0].supplyIndex;
    }

    function totalReserve() external view returns (uint256) {
        return _markets[0].totalReserve;
    }

    function treasuryAccrued() external view returns (uint256) {
        return _markets[0].treasuryAccrued;
    }

    function depositorShare() public view returns (uint256) {
        return WAD - reserveFactor - treasuryFactor;
    }

    function getDebt(address user) external view returns (uint256) {
        return _debtValueWad(user);
    }

    function getCollateralValue(address user) external view returns (uint256) {
        return _collateralValueWad(user);
    }

    function getUserHealthFactor(address user) external view returns (uint256) {
        uint256 debtWad = _debtValueWad(user);
        if (debtWad == 0) return type(uint256).max;
        return _healthFactor(user, debtWad);
    }

    function isLiquidatable(address user) external view returns (bool) {
        uint256 debtWad = _debtValueWad(user);
        if (debtWad == 0) return false;
        return _healthFactor(user, debtWad) < WAD;
    }

    function maxBorrowable(address user, uint256 tier) external view returns (uint256) {
        if (userGlobalTier[user] != 0 && uint256(userGlobalTier[user]) != tier) return 0;
        uint256 debtWad = _debtValueWad(user);
        uint256 capacity = _collateralPower(user, tier);
        if (debtWad >= capacity) return 0;
        Market storage m = _markets[0];
        return _wadToAmount(capacity - debtWad, m.wadScale, _priceOf(address(m.asset)));
    }

    function getUserPosition(address user)
        external
        view
        returns (
            uint256 shares,
            uint256 collateral,
            uint256 debt,
            uint256 collateralValue,
            uint256 healthFactor,
            uint256 tier,
            bool liquidatable
        )
    {
        shares = userShares[user][0];
        collateral = userCollateral[user][0];
        debt = _debtValueWad(user);
        collateralValue = _collateralValueWad(user);
        tier = userGlobalTier[user];
        if (debt == 0) {
            healthFactor = type(uint256).max;
        } else {
            healthFactor = _healthFactor(user, debt);
        }
        liquidatable = healthFactor < WAD;
    }

    // ==================== Views (V2) ====================

    /// @notice 返回某市场快照（cash/borrows/supply/reserve/treasury/supplyIndex）。
    function marketAccounts(uint8 marketId)
        external
        view
        returns (uint256 cash, uint256 borrows, uint256 supply, uint256 reserve, uint256 treasury, uint256 supplyIdx)
    {
        Market storage m = _market(marketId);
        cash = m.cash;
        borrows = _totalBorrowsToken(marketId);
        supply = _totalSupplyToken(marketId);
        reserve = m.totalReserve;
        treasury = m.treasuryAccrued;
        supplyIdx = m.supplyIndex;
    }

    function marketUtilization(uint8 marketId) external view returns (uint256) {
        return _utilization(marketId);
    }

    function marketSupplyAPR(uint8 marketId) external view returns (uint256) {
        return _getSupplyAPR(marketId);
    }

    function marketBorrowAPR(uint8 marketId, uint256 tier) external view returns (uint256) {
        return _getBorrowAPR(marketId, tier);
    }

    function userSharesOf(address user, uint8 marketId) external view returns (uint256) {
        return userShares[user][marketId];
    }

    function userCollateralOf(address user, uint256 collId) external view returns (uint256) {
        return userCollateral[user][collId];
    }

    function userDebtToken(address user, uint8 marketId) external view returns (uint256) {
        uint8 t = userTier[user][marketId];
        if (t == 0) return 0;
        return (userBorrowNorm[user][marketId] * _market(marketId).borrowIndexByTier[t] + WAD - 1) / WAD;
    }

    function getUserPositionV2(address user)
        external
        view
        returns (uint256 debtWad, uint256 collateralValueWad, uint256 healthFactor, bool liquidatable)
    {
        debtWad = _debtValueWad(user);
        collateralValueWad = _collateralValueWad(user);
        if (debtWad == 0) {
            healthFactor = type(uint256).max;
            liquidatable = false;
        } else {
            healthFactor = _healthFactor(user, debtWad);
            liquidatable = healthFactor < WAD;
        }
    }

    // ==================== Internal core ====================

    function _addMarketInternal(address token, uint8 decimals) internal {
        require(token != address(0) && token != ETH, "bad asset");
        require(_marketIndex[token] == 0, "market exists");
        require(_markets.length < MAX_MARKETS, "too many markets");
        Market storage m = _markets.push();
        m.asset = IERC20(token);
        m.decimals = decimals;
        m.enabled = 1;
        m.wadScale = _pow10(18 - uint256(decimals));
        m.supplyIndex = WAD;
        m.lastAccrual = block.timestamp;
        for (uint256 t = 1; t <= MAX_TIERS; t++) {
            m.borrowIndexByTier[t] = WAD;
        }
        _marketIndex[token] = _markets.length;
    }

    function _addCollateralInternal(address token, uint8 decimals) internal {
        require(token != address(0), "zero token");
        require(_collateralIndex[token] == 0, "collateral exists");
        require(_collaterals.length < MAX_COLLATERALS, "too many collaterals");
        Collateral storage c = _collaterals.push();
        c.token = token;
        c.decimals = decimals;
        c.enabled = 1;
        c.wadScale = _pow10(18 - uint256(decimals));
        _collateralIndex[token] = _collaterals.length;
    }

    function _supplyCore(uint8 marketId, uint256 amount) internal returns (uint256 shares) {
        Market storage m = _market(marketId);
        require(amount >= _minSupply(m), "amount below min");
        _accrueMarket(marketId);
        uint256 supplyBefore = m.totalShares * m.supplyIndex / WAD;
        require(marketSupplyCap[marketId] == 0 || supplyBefore + amount <= marketSupplyCap[marketId], "supply cap hit");
        shares = amount * WAD / m.supplyIndex;
        require(shares > 0, "shares=0");
        userShares[msg.sender][marketId] += shares;
        m.totalShares += shares;
        m.cash += amount;
        m.asset.safeTransferFrom(msg.sender, address(this), amount);
    }

    function _withdrawCore(uint8 marketId, uint256 shares) internal returns (uint256 amount) {
        Market storage m = _market(marketId);
        require(shares > 0, "shares=0");
        _accrueMarket(marketId);
        require(userShares[msg.sender][marketId] >= shares, "insufficient shares");
        amount = shares * m.supplyIndex / WAD;
        require(m.cash >= amount, "insufficient liquidity");
        userShares[msg.sender][marketId] -= shares;
        m.totalShares -= shares;
        m.cash -= amount;
        m.asset.safeTransfer(msg.sender, amount);
    }

    function _supplyCollateralCore(uint8 collId, uint256 amount) internal returns (uint8) {
        require(!_oracleAnomalous(), "price anomalous");
        require(amount >= _minCollateral(collId), "value below min");
        require(
            collateralCap[collId] == 0 || collateralTotal[collId] + amount <= collateralCap[collId],
            "collateral cap hit"
        );
        userCollateral[msg.sender][collId] += amount;
        collateralTotal[collId] += amount;
        if (_collaterals[collId].token != ETH) {
            IERC20(_collaterals[collId].token).safeTransferFrom(msg.sender, address(this), amount);
        }
        return collId;
    }

    function _withdrawCollateralCore(uint8 collId, uint256 amount) internal {
        require(amount > 0, "amount=0");
        _accrueAll();
        require(userCollateral[msg.sender][collId] >= amount, "insufficient collateral");
        if (_debtValueWad(msg.sender) > 0) {
            userCollateral[msg.sender][collId] -= amount;
            uint256 hf = _healthFactor(msg.sender, _debtValueWad(msg.sender));
            require(hf >= WAD, "unhealthy");
            userCollateral[msg.sender][collId] += amount;
        }
        userCollateral[msg.sender][collId] -= amount;
        collateralTotal[collId] -= amount;
        if (_collaterals[collId].token == ETH) {
            _safeSendEth(payable(msg.sender), amount);
        } else {
            IERC20(_collaterals[collId].token).safeTransfer(msg.sender, amount);
        }
    }

    function _borrowCore(uint8 marketId, uint256 amount, uint256 tier)
        internal
        returns (uint256 newLtv, uint256 healthFactor)
    {
        Market storage m = _market(marketId);
        require(amount >= _minBorrow(m), "amount below min");
        require(tier >= 1 && tier <= MAX_TIERS, "bad tier");
        require(tier <= riskManager.getMaxBorrowTier(), "tier disabled");
        require(!_oracleAnomalous(), "price anomalous");
        _accrueMarket(marketId);
        require(_collateralValueWad(msg.sender) > 0, "no collateral");
        if (userGlobalTier[msg.sender] != 0) {
            require(uint256(userGlobalTier[msg.sender]) == tier, "tier locked");
        }
        uint256 debtWadBefore = _debtValueWad(msg.sender);
        uint256 amountWad = _amountToWadUsd(amount, m.wadScale, _priceOf(address(m.asset)));
        uint256 newDebtWad = debtWadBefore + amountWad;
        uint256 capacity = _collateralPower(msg.sender, tier);
        require(newDebtWad <= capacity, "ltv too high");
        require(m.cash >= amount, "insufficient liquidity");
        uint256 norm = _mulDivUp(amount, WAD, m.borrowIndexByTier[tier]);
        userBorrowNorm[msg.sender][marketId] += norm;
        userTier[msg.sender][marketId] = uint8(tier);
        m.totalNormalizedByTier[tier] += norm;
        m.cash -= amount;
        if (userGlobalTier[msg.sender] == 0) {
            userGlobalTier[msg.sender] = uint8(tier);
        }
        newLtv = newDebtWad * WAD / _collateralValueWad(msg.sender);
        healthFactor = _healthFactor(msg.sender, newDebtWad);
        m.asset.safeTransfer(msg.sender, amount);
    }

    function _repayCore(uint8 marketId, uint256 amount) internal returns (uint256 repayAmount, uint256 remainingDebt) {
        Market storage m = _market(marketId);
        require(amount > 0, "amount=0");
        _accrueMarket(marketId);
        uint8 t = userTier[msg.sender][marketId];
        require(t > 0, "no debt");
        uint256 debt = (userBorrowNorm[msg.sender][marketId] * m.borrowIndexByTier[t] + WAD - 1) / WAD;
        repayAmount = amount == type(uint256).max ? debt : (amount < debt ? amount : debt);
        if (repayAmount >= debt) {
            // 全额还清：一次性清零（避免 floor 取整残留“还了一次还要还尾巴”）。
            m.totalNormalizedByTier[t] -= userBorrowNorm[msg.sender][marketId];
            userBorrowNorm[msg.sender][marketId] = 0;
            userTier[msg.sender][marketId] = 0;
            if (!_anyBorrow(msg.sender)) userGlobalTier[msg.sender] = 0;
            m.cash += repayAmount;
            remainingDebt = 0;
        } else {
            uint256 normReduction = repayAmount * WAD / m.borrowIndexByTier[t];
            if (normReduction > userBorrowNorm[msg.sender][marketId]) {
                normReduction = userBorrowNorm[msg.sender][marketId];
            }
            userBorrowNorm[msg.sender][marketId] -= normReduction;
            m.totalNormalizedByTier[t] -= normReduction;
            if (userBorrowNorm[msg.sender][marketId] <= DUST_THRESHOLD) {
                m.totalNormalizedByTier[t] -= userBorrowNorm[msg.sender][marketId];
                userBorrowNorm[msg.sender][marketId] = 0;
                userTier[msg.sender][marketId] = 0;
            }
            m.cash += repayAmount;
            if (!_anyBorrow(msg.sender)) userGlobalTier[msg.sender] = 0;
            remainingDebt = _debtValueWad(msg.sender);
        }
        m.asset.safeTransferFrom(msg.sender, address(this), repayAmount);
    }

    function _liquidateCore(uint8 marketId, address target, uint8 collId, uint256 debtToCover, uint256 minSeizeAmount)
        internal
        returns (uint256 covered, uint256 seized, uint256 postHf)
    {
        require(target != msg.sender, "self-liquidation");
        require(debtToCover > 0, "amount=0");
        _accrueAll();
        Market storage m = _market(marketId);
        uint8 t = userTier[target][marketId];
        require(t > 0, "no debt");

        // 金额计算拆到 helper（含 closeFactor 封顶 / seize 上限 / minSeize 校验 / cover 封顶），
        // 既保证语义不变，也避免 _liquidateCore 局部变量过多在关闭 viaIR 时 stack too deep。
        (uint256 coverAmount, uint256 seizeAmount) =
            _liquidateAmounts(m, target, marketId, collId, debtToCover, minSeizeAmount, t);

        uint256 normReduction = _mulDivUp(coverAmount, WAD, m.borrowIndexByTier[t]);
        if (normReduction > userBorrowNorm[target][marketId]) normReduction = userBorrowNorm[target][marketId];
        userBorrowNorm[target][marketId] -= normReduction;
        m.totalNormalizedByTier[t] -= normReduction;
        if (userBorrowNorm[target][marketId] <= DUST_THRESHOLD) {
            m.totalNormalizedByTier[t] -= userBorrowNorm[target][marketId];
            userBorrowNorm[target][marketId] = 0;
            userTier[target][marketId] = 0;
        }
        userCollateral[target][collId] -= seizeAmount;
        collateralTotal[collId] -= seizeAmount;
        m.cash += coverAmount;
        covered = coverAmount;
        seized = seizeAmount;
        if (!_anyBorrow(target)) userGlobalTier[target] = 0;
        if (_debtValueWad(target) == 0) {
            postHf = type(uint256).max;
        } else {
            postHf = _healthFactor(target, _debtValueWad(target));
        }
        m.asset.safeTransferFrom(msg.sender, address(this), coverAmount);
        if (_collaterals[collId].token == ETH) {
            _safeSendEth(payable(msg.sender), seizeAmount);
        } else {
            IERC20(_collaterals[collId].token).safeTransfer(msg.sender, seizeAmount);
        }
    }

    /// @notice 清算金额计算（只读）：cover ≤ closeFactor×债务、≤债务；seize ≤ 抵押现值×bonus 且 ≤ 用户持有。
    ///         返回 (coverAmount token, seizeAmount token)。仅校验/读取，不修改状态。
    function _liquidateAmounts(
        Market storage m,
        address target,
        uint8 marketId,
        uint8 collId,
        uint256 debtToCover,
        uint256 minSeizeAmount,
        uint8 t
    ) internal view returns (uint256 coverAmount, uint256 seizeAmount) {
        uint256 debtWad = _debtValueWad(target);
        uint256 debtToken = (userBorrowNorm[target][marketId] * m.borrowIndexByTier[t] + WAD - 1) / WAD;
        require(_healthFactor(target, debtWad) < WAD, "not liquidatable");
        // 先按该市场债务（token 单位）封顶再换算 USD，避免超大 debtToCover 输入在乘法中溢出
        uint256 coverRequest = debtToCover > debtToken ? debtToken : debtToCover;
        uint256 coverWad = _amountToWadUsd(coverRequest, m.wadScale, _priceOf(address(m.asset)));
        if (coverWad > debtWad * riskManager.getCloseFactor() / WAD) {
            coverWad = debtWad * riskManager.getCloseFactor() / WAD;
        }
        if (coverWad > debtWad) coverWad = debtWad;
        require(coverWad > 0, "cover=0");
        uint256 seizeValueWad = liquidationManager.computeSeizeValue(
            _collateralValueWad(target), coverWad, riskManager.getLiquidationBonus()
        );
        seizeAmount = _wadToAmount(seizeValueWad, _collaterals[collId].wadScale, _priceOf(_collaterals[collId].token));
        uint256 posColl = userCollateral[target][collId];
        if (seizeAmount > posColl) seizeAmount = posColl;
        require(seizeAmount > 0, "seize=0");
        if (minSeizeAmount > 0) require(seizeAmount >= minSeizeAmount, "seize below min");
        coverAmount = _wadToAmount(coverWad, m.wadScale, _priceOf(address(m.asset)));
        if (coverAmount > debtToken) coverAmount = debtToken;
    }

    function _handleBadDebtCore(uint8 marketId, address target) internal {
        _accrueMarket(marketId);
        Market storage m = _market(marketId);
        address token = address(m.asset);
        uint8 t = userTier[target][marketId];
        require(t > 0, "no debt");
        for (uint256 i = 0; i < _collaterals.length; i++) {
            require(userCollateral[target][i] == 0, "collateral exists");
        }
        uint256 badDebtAmount = (userBorrowNorm[target][marketId] * m.borrowIndexByTier[t] + WAD - 1) / WAD;
        uint256 reserveBalance = IERC20(token).balanceOf(address(reserveManager));
        uint256 coveredByReserve = badDebtAmount > reserveBalance ? reserveBalance : badDebtAmount;
        uint256 lossToDepositors = badDebtAmount - coveredByReserve;

        uint256 oldSupplyIndex = m.supplyIndex;
        uint256 newSupplyIndex = oldSupplyIndex;
        uint256 remaining = lossToDepositors;
        if (remaining > 0) {
            // 吸收顺序（审计 D1 修正）：物理储备(已覆盖) → 账面风险储备 → 存款人(supplyIndex) → Treasury 最后兜底
            if (remaining > 0 && m.totalReserve > 0) {
                uint256 absorbed = remaining >= m.totalReserve ? m.totalReserve : remaining;
                m.totalReserve -= absorbed;
                remaining -= absorbed;
            }
            if (remaining > 0) {
                uint256 supplyBefore = _totalSupplyToken(marketId);
                if (supplyBefore > 0) {
                    uint256 absorbed = remaining >= supplyBefore ? supplyBefore : remaining;
                    newSupplyIndex =
                        absorbed >= supplyBefore ? 0 : oldSupplyIndex * (supplyBefore - absorbed) / supplyBefore;
                    m.supplyIndex = newSupplyIndex;
                    remaining -= absorbed;
                }
            }
            if (remaining > 0 && m.treasuryAccrued > 0) {
                uint256 absorbed = remaining >= m.treasuryAccrued ? m.treasuryAccrued : remaining;
                m.treasuryAccrued -= absorbed;
                remaining -= absorbed;
            }
        }

        m.totalNormalizedByTier[t] -= userBorrowNorm[target][marketId];
        userBorrowNorm[target][marketId] = 0;
        userTier[target][marketId] = 0;
        if (!_anyBorrow(target)) userGlobalTier[target] = 0; // 其它市场仍有债务则保留全局 tier

        if (coveredByReserve > 0) {
            m.cash += coveredByReserve;
            reserveManager.coverBadDebt(token, coveredByReserve);
        }
        emit BadDebtRealized(target, badDebtAmount, coveredByReserve, lossToDepositors, oldSupplyIndex, newSupplyIndex);
    }

    function _skimReserveCore(uint8 marketId) internal returns (uint256 amount) {
        _accrueMarket(marketId);
        Market storage m = _market(marketId);
        amount = m.totalReserve > m.cash ? m.cash : m.totalReserve;
        require(amount > 0, "no reserve");
        m.totalReserve -= amount;
        m.cash -= amount;
        m.asset.safeTransfer(address(reserveManager), amount);
    }

    function _collectTreasuryCore(uint8 marketId) internal returns (uint256 amount, address to) {
        require(treasuryAddress != address(0), "treasury not set");
        Market storage m = _market(marketId);
        amount = m.treasuryAccrued;
        require(amount > 0, "no treasury");
        require(m.cash >= amount, "insufficient liquidity");
        m.treasuryAccrued = 0;
        m.cash -= amount;
        to = treasuryAddress;
        m.asset.safeTransfer(to, amount);
    }

    // ==================== Accrual ====================

    function _accrueAll() internal {
        for (uint8 i = 0; i < _markets.length; i++) {
            _accrueMarket(i);
        }
    }

    function _accrueMarket(uint8 marketId) internal {
        Market storage m = _market(marketId);
        if (m.enabled == 0) return;
        uint256 currentTimestamp = block.timestamp;
        if (currentTimestamp == m.lastAccrual) return;
        uint256 dt = currentTimestamp - m.lastAccrual;
        uint256 utilization = _utilization(marketId);
        uint256 totalInterest = 0;
        for (uint256 t = 1; t <= MAX_TIERS; t++) {
            uint256 totalNorm = m.totalNormalizedByTier[t];
            if (totalNorm == 0) continue;
            uint256 rate = interestRateModel.getBorrowRatePerSecond(utilization, t);
            uint256 index = m.borrowIndexByTier[t];
            uint256 interest = totalNorm * index * rate * dt / (WAD * WAD);
            m.borrowIndexByTier[t] = index + index * rate * dt / WAD;
            totalInterest += interest;
        }
        if (totalInterest == 0) {
            m.lastAccrual = currentTimestamp;
            return;
        }
        uint256 reserveShare = totalInterest * reserveFactor / WAD;
        uint256 treasuryShare = totalInterest * treasuryFactor / WAD;
        uint256 suppliersShare = totalInterest - reserveShare - treasuryShare;
        if (m.totalShares > 0) {
            m.supplyIndex += suppliersShare * WAD / m.totalShares;
            m.totalReserve += reserveShare;
            m.treasuryAccrued += treasuryShare;
        } else {
            m.totalReserve += totalInterest;
        }
        _overflowReserveToTreasury(marketId);
        m.lastAccrual = currentTimestamp;
        emit InterestAccrued(totalInterest, dt);
    }

    function _overflowReserveToTreasury(uint8 marketId) internal {
        Market storage m = _market(marketId);
        uint256 totalBorrows = _totalBorrowsToken(marketId);
        if (totalBorrows == 0) return;
        uint256 reserveTarget = totalBorrows * reserveTargetRatio / WAD;
        uint256 reserveAssets = m.totalReserve + IERC20(address(m.asset)).balanceOf(address(reserveManager));
        if (reserveAssets <= reserveTarget) return;
        uint256 overflow = reserveAssets - reserveTarget;
        uint256 transferable = overflow > m.totalReserve ? m.totalReserve : overflow;
        if (transferable == 0) return;
        m.totalReserve -= transferable;
        m.treasuryAccrued += transferable;
        emit ReserveOverflowTransferred(transferable);
    }

    // ==================== Value / risk internals ====================

    function _debtValueWad(address user) internal view returns (uint256) {
        uint256 total = 0;
        for (uint8 i = 0; i < _markets.length; i++) {
            Market storage m = _markets[i];
            uint8 t = userTier[user][i];
            if (t == 0) continue;
            uint256 debtToken = (userBorrowNorm[user][i] * m.borrowIndexByTier[t] + WAD - 1) / WAD;
            total += _amountToWadUsd(debtToken, m.wadScale, _priceOf(address(m.asset)));
        }
        return total;
    }

    function _collateralValueWad(address user) internal view returns (uint256) {
        uint256 total = 0;
        for (uint256 i = 0; i < _collaterals.length; i++) {
            uint256 amt = userCollateral[user][i];
            if (amt == 0) continue;
            total += _amountToWadUsd(amt, _collaterals[i].wadScale, _priceOf(_collaterals[i].token));
        }
        return total;
    }

    function _collateralPower(address user, uint256 tier) internal view returns (uint256) {
        uint256 total = 0;
        for (uint256 i = 0; i < _collaterals.length; i++) {
            uint256 amt = userCollateral[user][i];
            if (amt == 0) continue;
            uint256 value = _amountToWadUsd(amt, _collaterals[i].wadScale, _priceOf(_collaterals[i].token));
            total += value * riskManager.getMaxLTV(_collaterals[i].token, tier) / WAD;
        }
        return total;
    }

    /// @notice HF = Σ(抵押品价值×LT(collateral, tier)) / 债务（USD WAD）。
    function _healthFactor(address user, uint256 debtWad) internal view returns (uint256) {
        if (debtWad == 0) return type(uint256).max;
        uint8 tier = userGlobalTier[user];
        if (tier == 0) return type(uint256).max;
        uint256 weighted = 0;
        for (uint256 i = 0; i < _collaterals.length; i++) {
            uint256 amt = userCollateral[user][i];
            if (amt == 0) continue;
            uint256 value = _amountToWadUsd(amt, _collaterals[i].wadScale, _priceOf(_collaterals[i].token));
            weighted += value * riskManager.getLiquidationThreshold(_collaterals[i].token, tier) / WAD;
        }
        return weighted * WAD / debtWad;
    }

    function _anyBorrow(address user) internal view returns (bool) {
        for (uint8 i = 0; i < _markets.length; i++) {
            if (userBorrowNorm[user][i] > 0) return true;
        }
        return false;
    }

    function _utilization(uint8 marketId) internal view returns (uint256) {
        Market storage m = _market(marketId);
        uint256 borrows = _totalBorrowsToken(marketId);
        uint256 total = m.cash + borrows;
        if (total == 0) return 0;
        return borrows * WAD / total;
    }

    function _totalSupplyToken(uint8 marketId) internal view returns (uint256) {
        Market storage m = _market(marketId);
        return m.totalShares * m.supplyIndex / WAD;
    }

    function _totalBorrowsToken(uint8 marketId) internal view returns (uint256) {
        Market storage m = _market(marketId);
        uint256 total = 0;
        for (uint256 t = 1; t <= MAX_TIERS; t++) {
            total += m.totalNormalizedByTier[t] * m.borrowIndexByTier[t] / WAD;
        }
        return total;
    }

    function _getBorrowAPR(uint8 marketId, uint256 tier) internal view returns (uint256) {
        return interestRateModel.getBorrowRatePerSecond(_utilization(marketId), tier) * SECONDS_PER_YEAR;
    }

    function _getSupplyAPR(uint8 marketId) internal view returns (uint256) {
        Market storage m = _market(marketId);
        uint256 totalBorrows = 0;
        uint256 weighted = 0;
        uint256 utilization = _utilization(marketId);
        for (uint256 t = 1; t <= MAX_TIERS; t++) {
            uint256 norm = m.totalNormalizedByTier[t];
            if (norm == 0) continue;
            uint256 borrows = norm * m.borrowIndexByTier[t] / WAD;
            totalBorrows += borrows;
            weighted += borrows * interestRateModel.getBorrowRatePerSecond(utilization, t);
        }
        uint256 avgRate = totalBorrows == 0 ? 0 : weighted / totalBorrows;
        uint256 totalFee = reserveFactor + treasuryFactor;
        return avgRate * utilization * (WAD - totalFee) / WAD / WAD * SECONDS_PER_YEAR;
    }

    function _oracleAnomalous() internal view returns (bool) {
        for (uint256 i = 0; i < _markets.length; i++) {
            if (priceOracle.isPriceAnomalous(address(_markets[i].asset))) return true;
        }
        for (uint256 i = 0; i < _collaterals.length; i++) {
            if (priceOracle.isPriceAnomalous(_collaterals[i].token)) return true;
        }
        return false;
    }

    function _priceOf(address token) internal view returns (uint256) {
        uint256 p = priceOracle.getAssetPrice(token);
        require(p > 0, "bad price");
        return p;
    }

    function _minSupply(Market storage m) internal view returns (uint256) {
        return MIN_SUPPLY_BASE * WAD / m.wadScale;
    }

    function _minBorrow(Market storage m) internal view returns (uint256) {
        return MIN_BORROW_BASE * WAD / m.wadScale;
    }

    function _minCollateral(uint8 collId) internal view returns (uint256) {
        return MIN_COLLATERAL_UNITS / _collaterals[collId].wadScale;
    }

    function _market(uint8 marketId) internal view returns (Market storage) {
        require(marketId < _markets.length, "bad market");
        return _markets[marketId];
    }

    function _requireCollateral(address token) internal view returns (uint8) {
        uint256 idx = _collateralIndex[token];
        require(idx > 0, "not collateral");
        return uint8(idx - 1);
    }

    function _amountToWadUsd(uint256 amount, uint256 wadScale, uint256 price) internal pure returns (uint256) {
        return amount * price * wadScale / PRICE_SCALE;
    }

    function _wadToAmount(uint256 wadUsd, uint256 wadScale, uint256 price) internal pure returns (uint256) {
        return wadUsd * PRICE_SCALE / (price * wadScale);
    }

    function _mulDivUp(uint256 a, uint256 b, uint256 c) internal pure returns (uint256) {
        return (a * b + c - 1) / c;
    }

    function _pow10(uint256 n) internal pure returns (uint256) {
        uint256 r = 1;
        for (uint256 i = 0; i < n; i++) {
            r *= 10;
        }
        return r;
    }

    function _safeSendEth(address payable to, uint256 amount) internal {
        (bool ok,) = to.call{value: amount}("");
        require(ok, "eth transfer failed");
    }
}
