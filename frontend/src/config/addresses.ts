// Deployed contract addresses on Somnia testnet
// Update these after running: npx hardhat run scripts/deploy.ts --network somnia
// Then copy the output addresses into this file.

export const CONTRACT_ADDRESSES = {
  // Core
  marginVault: "0x0000000000000000000000000000000000000000",
  perpEngine: "0x0000000000000000000000000000000000000000",
  orderBookFactory: "0x0000000000000000000000000000000000000000",

  // OrderBooks (deployed by factory)
  orderBooks: {
    "BTC-USD": "0x0000000000000000000000000000000000000000",
    "ETH-USD": "0x0000000000000000000000000000000000000000",
    "SOL-USD": "0x0000000000000000000000000000000000000000",
  },

  // Agents
  liquidationSentinel: "0x0000000000000000000000000000000000000000",
  liquidityProviderAgent: "0x0000000000000000000000000000000000000000",
  agentInterface: "0x0000000000000000000000000000000000000000",

  // Oracles
  mockPriceFeed: "0x0000000000000000000000000000000000000000",
  oracleAdapter: "0x0000000000000000000000000000000000000000",
  agentOracle: "0x0000000000000000000000000000000000000000",

  // Somnia
  sentimentOracle: "0x0000000000000000000000000000000000000000",
};

// Somnia testnet chain ID
export const SOMNIA_CHAIN_ID = 50312;

// Somnia testnet RPC URL
export const SOMNIA_RPC_URL = "https://dream-rpc.somnia.network";

// Helper: check if addresses are set
export function isDeployed(): boolean {
  return CONTRACT_ADDRESSES.marginVault !== "0x0000000000000000000000000000000000000000";
}
