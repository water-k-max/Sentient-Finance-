import { ethers } from "ethers";
import { CONTRACT_ADDRESSES, SOMNIA_RPC_URL } from "../config/addresses";

// PerpEngine ABI (only functions needed by frontend)
const PERP_ENGINE_ABI = [
  "function openPosition(bytes32 pairId, bool isLong, uint256 size, uint256 leverage, uint256 limitPrice) returns (uint256 orderId)",
  "function closePosition(bytes32 pairId) external",
  "function getMarkPrice(bytes32 pairId) view returns (uint256)",
  "function computeFundingRate(bytes32 pairId) view returns (int256)",
  "function totalVolume() view returns (uint256)",
  "function openInterest() view returns (uint256)",
  "function insuranceFundBalance() view returns (uint256)",
  "function getAllPairs() view returns (bytes32[])",
  "function indexPrices(bytes32 pairId) view returns (uint256)",
];

/**
 * Get a PerpEngine contract instance connected to a signer (for transactions).
 */
export function getPerpEngineWithSigner(signer: ethers.Signer): ethers.Contract {
  return new ethers.Contract(
    CONTRACT_ADDRESSES.perpEngine,
    PERP_ENGINE_ABI,
    signer
  );
}

/**
 * Get a read-only PerpEngine instance.
 */
export function getPerpEngineReadOnly(): ethers.Contract {
  const provider = new ethers.JsonRpcProvider(SOMNIA_RPC_URL);
  return new ethers.Contract(
    CONTRACT_ADDRESSES.perpEngine,
    PERP_ENGINE_ABI,
    provider
  );
}

/**
 * Convert a pair string (e.g., "BTC-USD") to a bytes32 pairId.
 */
export function pairToBytes32(pair: string): string {
  return ethers.keccak256(ethers.toUtf8Bytes(pair));
}

// MarginVault ABI for agent dashboard
const VAULT_ABI = [
  "function trackedTradersCount() view returns (uint256)",
  "function deposit(uint256 amount) external",
];

const SENTINEL_ABI = [
  "function paused() view returns (bool)",
];

const LP_AGENT_ABI = [
  "function spreadBps() view returns (uint256)",
  "function activeBidExists() view returns (bool)",
  "function activeAskExists() view returns (bool)",
  "function paused() view returns (bool)",
];

const ENHANCED_LP_ABI = [
  "function spreadBps() view returns (uint256)",
  "function sentimentMultiplierBps() view returns (int8)",
  "function lastVolatilityScore() view returns (uint256)",
  "function paused() view returns (bool)",
];

const SENTIMENT_ORACLE_ABI = [
  "function apiPrice() view returns (uint256)",
  "function websitePrice() view returns (uint256)",
  "function sentiment() view returns (string)",
  "function volatilityScore() view returns (uint256)",
  "function consensusPrice() view returns (uint256)",
  "function lastUpdated() view returns (uint256)",
];

/**
 * Get a read-only provider shared across all contracts.
 */
export function getProvider(): ethers.JsonRpcProvider {
  return new ethers.JsonRpcProvider(SOMNIA_RPC_URL);
}

/**
 * Get all agent contract instances for the AgentDashboard.
 */
export function getAgentContracts(provider: ethers.JsonRpcProvider) {
  return {
    vault: new ethers.Contract(CONTRACT_ADDRESSES.marginVault, VAULT_ABI, provider),
    sentinel: new ethers.Contract(CONTRACT_ADDRESSES.liquidationSentinel, SENTINEL_ABI, provider),
    lpAgent: new ethers.Contract(CONTRACT_ADDRESSES.liquidityProviderAgent, LP_AGENT_ABI, provider),
    enhancedLp: new ethers.Contract(CONTRACT_ADDRESSES.enhancedLiquidityProviderAgent, ENHANCED_LP_ABI, provider),
    sentimentOracle: new ethers.Contract(CONTRACT_ADDRESSES.sentimentOracle, SENTIMENT_ORACLE_ABI, provider),
  };
}