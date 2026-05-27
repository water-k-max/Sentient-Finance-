import { ethers } from "hardhat";

// Deployed addresses
const SENTIMENT_ORACLE = "0xC6820057c77394bB73E607CD76Ef0b600bfAaAAd";
const AGENT_ORACLE = "0xF026E887A1D91158ce4Ec0775e1ed6350B3C0eDa";
const MOCK_PRICE_FEED = "0xFBf1D7d9B1F94254aE1426B154eda465cFEabB19";
const ORACLE_ADAPTER = "0x96c7879c149c7A1Ad18c5bb905ee297B1e79AAf0";

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Caller:", deployer.address);
  console.log();

  // Step 1: Call AgentOracle.requestPrice() to get real BTC/USD from CoinGecko
  console.log("1️⃣  Calling JSON API Agent (CoinGecko)...");
  const AgentOracle = await ethers.getContractFactory("AgentOracle");
  const agentOracle = AgentOracle.attach(AGENT_ORACLE);

  const depositApi = 0.12; // 0.03 reserve + 0.09 reward (3 × 0.03)
  try {
    const tx = await agentOracle.requestPrice({
      value: ethers.parseEther(depositApi.toString()),
    });
    await tx.wait();
    console.log(`   ✅ Request sent — tx: ${tx.hash}`);
    console.log("   ⏳ Waiting ~60s for Somnia validators to fetch CoinGecko...");
  } catch (e: any) {
    console.log(`   ⚠️  Failed: ${e?.reason || e?.message || "unknown"}`);
  }

  console.log();
  console.log("2️⃣  Calling SentimentOracle to analyze sentiment (LLM Inference)...");
  const SentimentOracle = await ethers.getContractFactory("SentimentOracle");
  const sentimentOracle = SentimentOracle.attach(SENTIMENT_ORACLE);

  const depositLLM = 0.21; // 0.07 × 3 + reserve
  try {
    const tx = await sentimentOracle.analyzeSentiment(
      "Bitcoin ETF inflows reach record high of 2.1 billion dollars signaling strong institutional interest",
      { value: ethers.parseEther(depositLLM.toString()) }
    );
    await tx.wait();
    console.log(`   ✅ Sentiment analysis sent — tx: ${tx.hash}`);
    console.log("   ⏳ Waiting ~60s for LLM inference...");
  } catch (e: any) {
    console.log(`   ⚠️  Failed: ${e?.reason || e?.message || "unknown"}`);
  }

  console.log();
  console.log("3️⃣  Calling SentimentOracle for volatility scoring (LLM Inference)...");
  try {
    const tx = await sentimentOracle.computeVolatilityScore(
      "105000,104800,105200,105500,104900,105100,105300,104700",
      { value: ethers.parseEther(depositLLM.toString()) }
    );
    await tx.wait();
    console.log(`   ✅ Volatility score sent — tx: ${tx.hash}`);
    console.log("   ⏳ Waiting ~60s for LLM inference...");
  } catch (e: any) {
    console.log(`   ⚠️  Failed: ${e?.reason || e?.message || "unknown"}`);
  }

  console.log();
  console.log("4️⃣  Seeding MockPriceFeed with real market price ($105,000)...");
  const MockPriceFeed = await ethers.getContractFactory("MockPriceFeed");
  const mockPriceFeed = MockPriceFeed.attach(MOCK_PRICE_FEED);
  const realPrice = 105000n * 10n ** 8n;
  await mockPriceFeed.updatePrice(realPrice);
  console.log("   ✅ MockPriceFeed updated to $105,000");

  console.log();
  console.log("5️⃣  Triggering OracleAdapter to emit PriceUpdated...");
  const OracleAdapter = await ethers.getContractFactory("OracleAdapter");
  const oracleAdapter = OracleAdapter.attach(ORACLE_ADAPTER);
  await oracleAdapter.updatePriceDirect(realPrice);
  console.log("   ✅ OracleAdapter emitted PriceUpdated → reactive cascade fires");

  console.log();
  console.log("✅ All done! Check frontend AgentDashboard in ~60s for agent results.");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });