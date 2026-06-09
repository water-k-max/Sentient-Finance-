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
  "function getCollateralBalance(address trader) view returns (uint256)",
];

const MOCK_USDC_ABI = [
  "function balanceOf(address account) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function mint(address to, uint256 amount) external",
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
  "function sentimentMultiplierBps() view returns (int16)",
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
  "function getDepositRequired() view returns (uint256 jsonApi, uint256 llmInference, uint256 llmParseWebsite)",
  "function requestApiPrice() payable returns (uint256)",
  "function requestWebsitePrice() payable returns (uint256)",
  "function analyzeSentiment(string headline) payable returns (uint256)",
  "function computeVolatilityScore(string priceHistory) payable returns (uint256)",
];

// Additional ABIs needed by hooks
const ORDERBOOK_ABI = [
  "function getOrderBookDepth(uint256 levels) view returns (uint256[] bidPrices, uint256[] bidSizes, uint256[] askPrices, uint256[] askSizes)",
  "function bestBid() view returns (uint256)",
  "function bestAsk() view returns (uint256)",
  "function cancelOrder(uint256 orderId) external",
  "function placeOrder(bool isBid, uint256 price, uint256 size, uint256 leverage) returns (uint256 orderId)",
];

const ORACLE_ADAPTER_ABI = [
  "function latestPrice() view returns (uint256)",
];

const AGENT_INTERFACE_ABI = [
  "function triggerApiPrice() external payable",
  "function triggerWebsitePrice() external payable",
  "function triggerSentimentAnalysis(string headline) external payable",
  "function triggerVolatilityScore(string priceHistory) external payable",
];

export const ABIS = {
  perpEngine: PERP_ENGINE_ABI,
  marginVault: VAULT_ABI,
  mockUSDC: MOCK_USDC_ABI,
  liquidationSentinel: SENTINEL_ABI,
  lpAgent: LP_AGENT_ABI,
  enhancedLp: ENHANCED_LP_ABI,
  sentimentOracle: SENTIMENT_ORACLE_ABI,
  orderBook: ORDERBOOK_ABI,
  oracleAdapter: ORACLE_ADAPTER_ABI,
  agentInterface: AGENT_INTERFACE_ABI,
};

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

/** Get a signed MockUSDC instance (for deposit) */
export function getMockUSDCWithSigner(signer: ethers.Signer): ethers.Contract {
  return new ethers.Contract(CONTRACT_ADDRESSES.mockUSDC, MOCK_USDC_ABI, signer);
}

/** Get a signed MarginVault instance (for deposit/withdraw) */
export function getVaultWithSigner(signer: ethers.Signer): ethers.Contract {
  return new ethers.Contract(CONTRACT_ADDRESSES.marginVault, VAULT_ABI, signer);
}

/** Get a signed SentimentOracle instance (for triggering agents) */
export function getSentimentOracleWithSigner(signer: ethers.Signer): ethers.Contract {
  return new ethers.Contract(CONTRACT_ADDRESSES.sentimentOracle, SENTIMENT_ORACLE_ABI, signer);
}