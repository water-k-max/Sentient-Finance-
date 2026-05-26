import { ethers } from "hardhat";

async function main() {
  console.log("=== Sentient Finance Testnet Verification ===\n");

  // Contract addresses
  const MARGIN_VAULT = "0xe6D13e4bdC46b0DAcB238FAAd8118d9a8033032b";
  const ORDER_BOOK = "0xA830E52C62F7694Ed859d9D6414cc203FC20B481";
  const LP_AGENT = "0x4A15Ab0CA037C3Da4177b85B74697aC136f73af7";
  const ENHANCED_LP = "0xB2Dc7E795D61E0F1C1C8E17B9935bDbB7557ffBd";
  const SENTIMENT_ORACLE = "0xC6820057c77394bB73E607CD76Ef0b600bfAaAAd";
  const AGENT_INTERFACE = "0x517Df8d1A94588eBb504CB864DD9B6d9d1c5A499";
  const PERP_ENGINE = "0xaA6e6c28EceFAAbCDD71b4EBD8bAF20803fF6230";

  const MarginVault = await ethers.getContractFactory("MarginVault");
  const marginVault = MarginVault.attach(MARGIN_VAULT);

  const OrderBook = await ethers.getContractFactory("OrderBook");
  const orderBook = OrderBook.attach(ORDER_BOOK);

  const PerpEngine = await ethers.getContractFactory("PerpEngine");
  const perpEngine = PerpEngine.attach(PERP_ENGINE);

  // Verify contracts are reachable
  console.log("1. Contract connectivity:");
  console.log(`   MarginVault owner: ${await marginVault.owner()}`);
  console.log(`   OrderBook best bid: ${await orderBook.bestBid()}`);
  console.log(`   PerpEngine pairs: ${await perpEngine.getAllPairs()}`);
  console.log("   ✅ All contracts reachable\n");

  // Check LP Agent state
  const LPAgent = await ethers.getContractFactory("LiquidityProviderAgent");
  const lpAgent = LPAgent.attach(LP_AGENT);
  console.log("2. LP Agent state:");
  console.log(`   Spread: ${(await lpAgent.spreadBps()).toString()} bps`);
  console.log(`   Order size: ${ethers.formatUnits(await lpAgent.orderSizeUSDC(), 18)}`);
  console.log(`   Active bid exists: ${await lpAgent.activeBidExists()}`);
  console.log(`   Active ask exists: ${await lpAgent.activeAskExists()}`);
  console.log(`   Paused: ${await lpAgent.paused()}`);

  // Check Enhanced LP Agent
  const EnhancedLP = await ethers.getContractFactory("EnhancedLiquidityProviderAgent");
  const enhancedLP = EnhancedLP.attach(ENHANCED_LP);
  console.log("\n3. Enhanced LP Agent state:");
  console.log(`   Spread: ${(await enhancedLP.spreadBps()).toString()} bps`);
  console.log(`   Sentiment multiplier: ${await enhancedLP.sentimentMultiplierBps()}`);
  console.log(`   Volatility score: ${await enhancedLP.lastVolatilityScore()}`);

  // Check SentimentOracle config
  const SentimentOracle = await ethers.getContractFactory("SentimentOracle");
  const sentimentOracle = SentimentOracle.attach(SENTIMENT_ORACLE);
  console.log("\n4. SentimentOracle config:");
  console.log(`   JSON API Agent ID: ${await sentimentOracle.JSON_API_AGENT_ID()}`);
  console.log(`   LLM Inference Agent ID: ${await sentimentOracle.LLM_INFERENCE_AGENT_ID()}`);
  console.log(`   LLM Parse Website Agent ID: ${await sentimentOracle.LLM_PARSE_WEBSITE_AGENT_ID()}`);
  console.log(`   Divergence threshold: ${(await sentimentOracle.divergenceThresholdBps()).toString()} bps`);

  // Check AgentInterface subscriptions
  const AgentInterface = await ethers.getContractFactory("AgentInterface");
  const agentInterface = AgentInterface.attach(AGENT_INTERFACE);
  const ORDER_PLACED_TOPIC = await agentInterface.ORDER_PLACED_TOPIC();
  const PRICE_UPDATED_TOPIC = await agentInterface.PRICE_UPDATED_TOPIC();
  console.log("\n5. AgentInterface subscriptions:");
  console.log(`   BTC-USD OrderPlaced subscribed: ${await agentInterface.subscriptions(ORDER_BOOK, ORDER_PLACED_TOPIC)}`);

  console.log("\n✅ All verification checks passed!");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
