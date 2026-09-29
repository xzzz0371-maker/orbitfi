import LendingPoolAbiRaw from "./abis/LendingPool.json";
import MockUSDCAbiRaw from "./abis/MockUSDC.json";
import MockTokenAbiRaw from "./abis/MockToken.json";
import SwitchableOracleAbiRaw from "./abis/SwitchableOracle.json";
import ChainlinkOracleAbiRaw from "./abis/ChainlinkOracle.json";
import RiskManagerAbiRaw from "./abis/RiskManager.json";
import ReserveManagerAbiRaw from "./abis/ReserveManager.json";
import InterestRateModelAbiRaw from "./abis/InterestRateModel.json";

// 价格源最小 ABI。ChainlinkOracle 与 SwitchableOracle 都实现 getAssetPrice(address)->uint256，
// 所以同一份 ABI 对两者都可用，避免因部署形态不同而拿错 ABI。
export const PriceOracleAbi = [
  {
    type: "function",
    name: "getAssetPrice",
    stateMutability: "view",
    inputs: [{ type: "address", name: "asset" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "isPriceAnomalous",
    stateMutability: "view",
    inputs: [{ type: "address", name: "asset" }],
    outputs: [{ type: "bool" }],
  },
] as const;

// Cast to `any` — the raw JSON ABI literal is too complex for wagmi's generic inference
// in a browser bundle, and we only need loosely-typed reads/writes in the demo frontend.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const LendingPoolAbi = LendingPoolAbiRaw as any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const MockUSDCAbi = MockUSDCAbiRaw as any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const MockTokenAbi = MockTokenAbiRaw as any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const SwitchableOracleAbi = SwitchableOracleAbiRaw as any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const ChainlinkOracleAbi = ChainlinkOracleAbiRaw as any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const RiskManagerAbi = RiskManagerAbiRaw as any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const ReserveManagerAbi = ReserveManagerAbiRaw as any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const InterestRateModelAbi = InterestRateModelAbiRaw as any;
