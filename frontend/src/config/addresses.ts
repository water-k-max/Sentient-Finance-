// Deployed contract addresses on Somnia testnet
// Deployed: 2026-05-26 from 0x32D35e6A1fDdbc29aC11276A22bFAD03aAa1Dc83

export const CONTRACT_ADDRESSES = {
  marginVault: "0xe6D13e4bdC46b0DAcB238FAAd8118d9a8033032b",
  perpEngine: "0xaA6e6c28EceFAAbCDD71b4EBD8bAF20803fF6230",
  orderBookFactory: "0x62991Cebaf011Ebdc7b6ABA3Eb5cA7e517dEAd15",
  orderBooks: {
    "BTC-USD": "0xA830E52C62F7694Ed859d9D6414cc203FC20B481",
    "ETH-USD": "0x64E1235dFd0AC1887B5FB852309f959817ac45B2",
    "SOL-USD": "0x1873B69a805Bd771cB74bF7a38997c730dcF3158",
  },
  liquidationSentinel: "0x002b992AE8E4867310Fb487765F872dFE9e08b61",
  liquidityProviderAgent: "0x4A15Ab0CA037C3Da4177b85B74697aC136f73af7",
  enhancedLiquidityProviderAgent: "0xB2Dc7E795D61E0F1C1C8E17B9935bDbB7557ffBd",
  agentInterface: "0x517Df8d1A94588eBb504CB864DD9B6d9d1c5A499",
  mockPriceFeed: "0xFBf1D7d9B1F94254aE1426B154eda465cFEabB19",
  oracleAdapter: "0x96c7879c149c7A1Ad18c5bb905ee297B1e79AAf0",
  agentOracle: "0xfB2DCde9E6A634dfC70ea0d529DE48630F72F0f9",
  sentimentOracle: "0xC8c4a728b9A3A1e700F6ff59fBdb08De3657B584",
  keeperRegistry: "0xAb3b04A51f052c817969EF28DeF409FAF9544756",
  somniaPriceOracle: "0x360D143528a4767359720D2E7E848FC96b8246e6",
  compositeOracle: "0x771E4C8fbF26012fcdD54d24600a5bBA3441b751",
};

export const SOMNIA_CHAIN_ID = 50312;
export const SOMNIA_RPC_URL = "https://dream-rpc.somnia.network";

export function isDeployed(): boolean {
  return CONTRACT_ADDRESSES.marginVault !== "0x0000000000000000000000000000000000000000";
}
