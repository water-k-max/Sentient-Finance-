import { ethers } from "hardhat";
import { CONTRACT_ADDRESSES } from "./addresses";

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Caller:", deployer.address);
  console.log();

  // Step 1: Call AgentOracle.requestPrice() to get real BTC/USD from CoinGecko
  console.log("1️⃣  Calling JSON API Agent (CoinGecko)...");
  const AgentOracle = await ethers.getContractFactory("AgentOracle");
  const agentOracle = AgentOracle.attach(CONTRACT_ADDRESSES.agentOracle);

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
  const sentimentOracle = SentimentOracle.attach(CONTRACT_ADDRESSES.sentimentOracle);

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
  const mockPriceFeed = MockPriceFeed.attach(CONTRACT_ADDRESSES.mockPriceFeed);
  const realPrice = 105000n * 10n ** 8n;
  await mockPriceFeed.updatePrice(realPrice);
  console.log("   ✅ MockPriceFeed updated to $105,000");

  console.log();
  console.log("5️⃣  Triggering OracleAdapter to emit PriceUpdated...");
  const OracleAdapter = await ethers.getContractFactory("OracleAdapter");
  const oracleAdapter = OracleAdapter.attach(CONTRACT_ADDRESSES.oracleAdapter);
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