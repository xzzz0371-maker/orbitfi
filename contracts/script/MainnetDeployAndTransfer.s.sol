// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {TimelockController} from "@openzeppelin/contracts/governance/TimelockController.sol";
import {ChainlinkOracle} from "../src/oracle/ChainlinkOracle.sol";
import {InterestRateModel} from "../src/InterestRateModel.sol";
import {RiskManager} from "../src/RiskManager.sol";
import {ReserveManager} from "../src/ReserveManager.sol";
import {RiskEngine} from "../src/risk/RiskEngine.sol";
import {LendingPool} from "../src/LendingPool.sol";

/// @title 主网权限收口流程（分步，可在已部署栈上单独执行 Step 4–11）
/// @dev
///   ⚠️ 本脚本**不做合约部署**（部署请先跑 DeployMainnet.s.sol 得到 deployments/mainnet.json）。
///   本脚本只做“权限收口”：把 PARAM_ADMIN/DEFAULT_ADMIN/Ownable 移交到 Safe(或 Timelock)，撤销部署者。
///
///   分步（对应手册 §4）：
///     Step 4/5:  设置 treasuryAddress=SAFE；PAUSER → SAFE
///     Step 6/7:  pool/oracle/riskEngine DEFAULT_ADMIN + PARAM_ADMIN → TIMELOCK（未启用 timelock 则 → SAFE）
///     Step 8:    IRM/RiskManager/ReserveManager transferOwnership(TIMELOCK 或 SAFE)
///     Step 9:    部署者逐个 renounceRole / 移交后撤销
///     Step 10/11: 只读断言脚本输出，需链上再手动验证
///
///   用法（先填 .env）：
///     forge script script/MainnetDeployAndTransfer.s.sol:MainnetDeployAndTransfer \
///           --rpc-url $MAINNET_RPC_URL --broadcast -vvvv
///   环境变量：
///     PRIVATE_KEY                    部署者（将被撤销）
///     MAINNET_DEPLOYMENTS            （可选）已部署 json 路径，默认 ./deployments/mainnet.json
///     MAINNET_ADMIN_SAFE             Safe 多签地址（必填，最终持有方）
///     MAINNET_TREASURY               （可选，默认=SAFE）
///     MAINNET_TIMELOCK               （可选）已部署 TimelockController 地址；不设则 governance=SAFE
///     MAINNET_PAUSER                 （可选，默认=SAFE）——若你希望 pauser 与 owner 分离，可传另一多签
///
///   ⚠️ 流程骨架以“步骤清晰、可审计”为要；请先在本机 fork 预演，确认步骤顺序与预期一致再真网广播。
contract MainnetDeployAndTransfer is Script {
    // 步骤标记，仅供注释清晰。
    // 注：原先的 _envAddrOr / _envStrOr（try/catch 静默回落）已移除 ——
    //     环境变量存在但格式非法时必须 revert，不能悄悄用默认值。

    function run() external {
        uint256 key = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(key);
        address safe = vm.envAddress("MAINNET_ADMIN_SAFE");
        // 注意：刻意不用 try/catch 包装 envAddress —— 变量存在但格式非法时必须 revert，
        // 不能静默回落到默认值（否则可能把所有权交给预期之外的地址）。
        address treasury = vm.envOr("MAINNET_TREASURY", safe);
        address pauser = vm.envOr("MAINNET_PAUSER", safe);
        address payable timelockAddr = payable(vm.envOr("MAINNET_TIMELOCK", address(0)));
        address governance = timelockAddr == address(0) ? safe : address(timelockAddr);

        // ===== 前置安全断言 =====
        // 撤销部署者角色是**不可逆**的：若接收方填成部署者本身，renounceRole 会把协议的管理员
        // 全部清空，之后无人能调参或暂停。这里必须在广播前拦住。
        require(safe != address(0), "MAINNET_ADMIN_SAFE required");
        require(safe != deployer, "safe must not be the deployer EOA");
        require(treasury != deployer, "treasury must not be the deployer EOA");
        require(pauser != deployer, "pauser must not be the deployer EOA");
        require(governance != deployer, "governance must not be the deployer EOA");

        string memory cfg = vm.readFile(vm.envOr("MAINNET_DEPLOYMENTS", string("./deployments/mainnet.json")));
        LendingPool pool = LendingPool(vm.parseJsonAddress(cfg, ".lendingPool"));
        ChainlinkOracle oracle = ChainlinkOracle(vm.parseJsonAddress(cfg, ".oracle"));
        InterestRateModel irm = InterestRateModel(vm.parseJsonAddress(cfg, ".interestRateModel"));
        RiskManager rm = RiskManager(vm.parseJsonAddress(cfg, ".riskManager"));
        ReserveManager rsv = ReserveManager(vm.parseJsonAddress(cfg, ".reserveManager"));
        RiskEngine re = RiskEngine(vm.parseJsonAddress(cfg, ".riskEngine"));

        // ===== 前置检查：部署者是否仍持有权限 =====
        // ⚠️ 本脚本与 DeployMainnet.s.sol 的收尾步骤**功能重叠**：
        //    DeployMainnet.s.sol 在广播结束前就已经完成「grantRole → transferOwnership →
        //    renounceRole(部署者)」全流程。因此「先 DeployMainnet 再跑本脚本」是无效组合，
        //    本脚本会在 setTreasuryAddress 处以原始 AccessControlUnauthorizedAccount 失败，
        //    很容易被误读为"移交失败"（实际上移交已经在上一步成功了）。
        //    本脚本适用于：用其它方式部署、但**尚未**移交权限的场景（如测试网 Deploy.s.sol）。
        //    这里提前给出可读提示，避免误判。
        require(
            pool.hasRole(pool.PARAM_ADMIN_ROLE(), deployer),
            "deployer lacks pool PARAM_ADMIN: roles were already handed over (DeployMainnet does the handover itself; this script is only for deployments that did NOT hand over)"
        );

        // ===== Timelock 预校验（若传入）=====
        // 必须确认 safe 在 Timelock 上真的有 proposer/executor/admin 角色且 delay > 0，
        // 否则移交后既不能立即执行也不能延时执行 = 协议被锁死。
        if (timelockAddr != address(0)) {
            TimelockController tl = TimelockController(timelockAddr);
            require(tl.getMinDelay() > 0, "timelock minDelay=0");
            require(tl.hasRole(tl.DEFAULT_ADMIN_ROLE(), safe), "safe lacks timelock DEFAULT_ADMIN");
            require(tl.hasRole(tl.PROPOSER_ROLE(), safe), "safe lacks timelock PROPOSER");
            require(tl.hasRole(tl.EXECUTOR_ROLE(), safe), "safe lacks timelock EXECUTOR");
        }

        console2.log("deployer:", deployer);
        console2.log("safe:", safe);
        console2.log("treasury:", treasury);
        console2.log("pauser:", pauser);
        console2.log("timelock:", address(timelockAddr), "-> governance:", governance);
        vm.startBroadcast(key);

        // ===== Step 4: treasuryAddress = treasury =====
        pool.setTreasuryAddress(treasury);

        // ===== Step 5: PAUSER → pauser（独立熔断，不经 timelock）=====
        pool.grantRole(pool.PAUSER_ROLE(), pauser);
        oracle.grantRole(oracle.PAUSER_ROLE(), pauser);

        // ===== Step 6/7: DEFAULT_ADMIN + PARAM_ADMIN → governance =====
        pool.grantRole(pool.DEFAULT_ADMIN_ROLE(), governance);
        pool.grantRole(pool.PARAM_ADMIN_ROLE(), governance);
        oracle.grantRole(oracle.DEFAULT_ADMIN_ROLE(), governance);
        oracle.grantRole(oracle.PARAM_ADMIN_ROLE(), governance);
        re.grantRole(re.DEFAULT_ADMIN_ROLE(), governance);
        re.grantRole(re.PARAM_ADMIN_ROLE(), governance);

        // ===== Step 8: Ownable → governance =====
        irm.transferOwnership(governance);
        rm.transferOwnership(governance);
        rsv.transferOwnership(governance);

        // ===== Step 8.5: 撤销前的"移交确认"门禁 =====
        // 关键：确认接收方**已经真正拿到**全部权限，之后才允许撤销部署者。
        // 缺这一步时，只要前面的 grantRole/transferOwnership 有一笔失败或地址填错，
        // Step 9 会把部署者撤成无管理员状态 —— 而 renounceRole 不可逆。
        require(pool.treasuryAddress() == treasury, "treasuryAddress not set");
        require(pool.hasRole(pool.DEFAULT_ADMIN_ROLE(), governance), "gov lacks pool DEFAULT_ADMIN");
        require(pool.hasRole(pool.PARAM_ADMIN_ROLE(), governance), "gov lacks pool PARAM_ADMIN");
        require(pool.hasRole(pool.PAUSER_ROLE(), pauser), "pauser lacks pool PAUSER");
        require(oracle.hasRole(oracle.DEFAULT_ADMIN_ROLE(), governance), "gov lacks oracle DEFAULT_ADMIN");
        require(oracle.hasRole(oracle.PARAM_ADMIN_ROLE(), governance), "gov lacks oracle PARAM_ADMIN");
        require(oracle.hasRole(oracle.PAUSER_ROLE(), pauser), "pauser lacks oracle PAUSER");
        require(re.hasRole(re.DEFAULT_ADMIN_ROLE(), governance), "gov lacks riskEngine DEFAULT_ADMIN");
        require(re.hasRole(re.PARAM_ADMIN_ROLE(), governance), "gov lacks riskEngine PARAM_ADMIN");
        require(irm.owner() == governance, "irm owner != governance");
        require(rm.owner() == governance, "riskManager owner != governance");
        require(rsv.owner() == governance, "reserveManager owner != governance");
        console2.log("[ok] handover verified; proceeding to revoke deployer");

        // ===== Step 9: 撤销部署者（先子角色，最后 DEFAULT_ADMIN）=====
        pool.renounceRole(pool.PARAM_ADMIN_ROLE(), deployer);
        pool.renounceRole(pool.PAUSER_ROLE(), deployer);
        pool.renounceRole(pool.DEFAULT_ADMIN_ROLE(), deployer);
        oracle.renounceRole(oracle.PARAM_ADMIN_ROLE(), deployer);
        oracle.renounceRole(oracle.PAUSER_ROLE(), deployer);
        oracle.renounceRole(oracle.DEFAULT_ADMIN_ROLE(), deployer);
        re.renounceRole(re.PARAM_ADMIN_ROLE(), deployer);
        re.renounceRole(re.DEFAULT_ADMIN_ROLE(), deployer);

        vm.stopBroadcast();

        // ===== Step 10/11: 只读断言 + 输出（原为纯 console2.log，脚本"看起来成功"也可能实际没移交，
        //              现改为 require：任何一项不成立就让整轮脚本失败）=====
        require(pool.hasRole(pool.DEFAULT_ADMIN_ROLE(), governance), "post: gov lacks pool DEFAULT_ADMIN");
        require(pool.hasRole(pool.PARAM_ADMIN_ROLE(), governance), "post: gov lacks pool PARAM_ADMIN");
        require(pool.hasRole(pool.PAUSER_ROLE(), pauser), "post: pauser lacks pool PAUSER");
        require(!pool.hasRole(pool.DEFAULT_ADMIN_ROLE(), deployer), "post: deployer still DEFAULT_ADMIN");
        require(!pool.hasRole(pool.PARAM_ADMIN_ROLE(), deployer), "post: deployer still PARAM_ADMIN");
        require(!pool.hasRole(pool.PAUSER_ROLE(), deployer), "post: deployer still PAUSER");
        require(!oracle.hasRole(oracle.DEFAULT_ADMIN_ROLE(), deployer), "post: deployer still oracle admin");
        require(!oracle.hasRole(oracle.PARAM_ADMIN_ROLE(), deployer), "post: deployer still oracle PARAM_ADMIN");
        require(!re.hasRole(re.DEFAULT_ADMIN_ROLE(), deployer), "post: deployer still riskEngine admin");
        require(irm.owner() == governance, "post: irm owner != governance");
        require(rm.owner() == governance, "post: riskManager owner != governance");
        require(rsv.owner() == governance, "post: reserveManager owner != governance");
        require(pool.treasuryAddress() == treasury, "post: treasuryAddress != treasury");
        console2.log("[ok] all handover assertions passed");
        console2.log("treasuryAddress:", pool.treasuryAddress());
        console2.log(
            "NOTE: still verify manually on chain (deployer calls rejected, pauser can pause instantly, param changes only via Timelock)."
        );
    }
}
