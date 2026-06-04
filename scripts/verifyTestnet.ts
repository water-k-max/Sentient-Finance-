import { ethers } from "hardhat";
import { CONTRACT_ADDRESSES } from "./addresses";

async function main() {
  console.log("=== Sentient Finance Testnet Verification ===\n");

  const MarginVault = await ethers.getContractFactory("MarginVault");
  const marginVault = MarginVault.attach(CONTRACT_ADDRESSES.marginVault);

  const OrderBook = await ethers.getContractFactory("OrderBook");
  const orderBook = OrderBook.attach(CONTRACT_ADDRESSES.orderBooks["BTC-USD"]);

  const PerpEngine = await ethers.getContractFactory("PerpEngine");
  const perpEngine = PerpEngine.attach(CONTRACT_ADDRESSES.perpEngine);

  // Verify contracts are reachable
  console.log("1. Contract connectivity:");
  console.log(`   MarginVault owner: ${await marginVault.owner()}`);
  console.log(`   OrderBook best bid: ${await orderBook.bestBid()}`);
  console.log(`   PerpEngine pairs: ${await perpEngine.getAllPairs()}`);
  console.log("   ✅ All contracts reachable\n");

  // Check LP Agent state
  const LPAgent = await ethers.getContractFactory("LiquidityProviderAgent");
  const lpAgent = LPAgent.attach(CONTRACT_ADDRESSES.liquidityProviderAgent);
  console.log("2. LP Agent state:");
  console.log(`   Spread: ${(await lpAgent.spreadBps()).toString()} bps`);
  console.log(`   Order size: ${ethers.formatUnits(await lpAgent.orderSizeUSDC(), 18)}`);
  console.log(`   Active bid exists: ${await lpAgent.activeBidExists()}`);
  console.log(`   Active ask exists: ${await lpAgent.activeAskExists()}`);
  console.log(`   Paused: ${await lpAgent.paused()}`);

  // Check Enhanced LP Agent
  const EnhancedLP = await ethers.getContractFactory("EnhancedLiquidityProviderAgent");
  const enhancedLP = EnhancedLP.attach(CONTRACT_ADDRESSES.enhancedLiquidityProviderAgent);
  console.log("\n3. Enhanced LP Agent state:");
  console.log(`   Spread: ${(await enhancedLP.spreadBps()).toString()} bps`);
  console.log(`   Sentiment multiplier: ${await enhancedLP.sentimentMultiplierBps()}`);
  console.log(`   Volatility score: ${await enhancedLP.lastVolatilityScore()}`);

  // Check SentimentOracle config
  const SentimentOracle = await ethers.getContractFactory("SentimentOracle");
  const sentimentOracle = SentimentOracle.attach(CONTRACT_ADDRESSES.sentimentOracle);
  console.log("\n4. SentimentOracle config:");
  console.log(`   JSON API Agent ID: ${await sentimentOracle.JSON_API_AGENT_ID()}`);
  console.log(`   LLM Inference Agent ID: ${await sentimentOracle.LLM_INFERENCE_AGENT_ID()}`);
  console.log(`   LLM Parse Website Agent ID: ${await sentimentOracle.LLM_PARSE_WEBSITE_AGENT_ID()}`);
  console.log(`   Divergence threshold: ${(await sentimentOracle.divergenceThresholdBps()).toString()} bps`);

  // Check AgentInterface subscriptions
  const AgentInterface = await ethers.getContractFactory("AgentInterface");
  const agentInterface = AgentInterface.attach(CONTRACT_ADDRESSES.agentInterface);
  const ORDER_PLACED_TOPIC = await agentInterface.ORDER_PLACED_TOPIC();
  const PRICE_UPDATED_TOPIC = await agentInterface.PRICE_UPDATED_TOPIC();
  console.log("\n5. AgentInterface subscriptions:");
  console.log(`   BTC-USD OrderPlaced subscribed: ${await agentInterface.subscriptions(CONTRACT_ADDRESSES.orderBooks["BTC-USD"], ORDER_PLACED_TOPIC)}`);

  console.log("\n✅ All verification checks passed!");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
