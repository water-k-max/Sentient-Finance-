// Deployed contract addresses on Somnia testnet
// Deployed: 2026-05-26 from 0x32D35e6A1fDdbc29aC11276A22bFAD03aAa1Dc83
// Also update scripts/addresses.ts after every re-deployment (canonical for Hardhat scripts).

export const CONTRACT_ADDRESSES = {
  "mockUSDC": "0x8D06699a029869f88437ecb10736B57306D3953F",
  "mockPriceFeed": "0xfFcfbe79bAe362734bE77712a34b9Fb35fa86680",
  "oracleAdapter": "0xA159BE1397c49f8Bb662E1ae7E9477BeAf9899c1",
  "marginVault": "0x2396207Bfe22190E0d8B8A511E9Ceae7d4E3f15D",
  "perpEngine": "0x67bae6CA52fAEeB93C1cABAD9C5821A25124F871",
  "orderBookFactory": "0xae27803c296916eE36A83220670eB918cAE4BcA5",
  "orderBooks": {
    "BTC-USD": "0x3B10165FD2490575fD514BE52cCCcAd57b3a284e",
    "ETH-USD": "0xddFBCae15030fF8b23CAd5F4598e7f7801F8A2f9",
    "SOL-USD": "0x51B411C22daaBc6130600e4c86cCe1Fac3E588CC"
  },
  "liquidationSentinel": "0xDBB064C78d0d42527a702fFe4d9e8F359f58FB8D",
  "liquidityProviderAgent": "0x1Ed3f6994C66aBCd142cEF939D7A50B518fD4246",
  "agentInterface": "0x7C07f58CBF26Ae5FFaEBB277A30283935E5E499F",
  "enhancedLiquidityProviderAgent": "0x5e9f53f52C7368C6c857e38e4ED2560cB29dfBF4",
  "sentimentOracle": "0xFCd8440d2097B7297A9c0944B7Bd448D9D4dCB2f",
  "agentOracle": "0x65E02f9D13A8D8E35e5D7e9f62Ae90dcA38140b2"
};
export const SOMNIA_CHAIN_ID = 50312;
export const SOMNIA_RPC_URL = "https://dream-rpc.somnia.network";

export function isDeployed(): boolean {
  return CONTRACT_ADDRESSES.marginVault !== "0x0000000000000000000000000000000000000000";
}
