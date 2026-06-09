import { ethers } from "hardhat";
import { CONTRACT_ADDRESSES } from "./addresses";
import { formatEther } from "ethers";

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Caller:", deployer.address);
  console.log();

  const SentimentOracle = await ethers.getContractFactory("SentimentOracle");
  const sentimentOracle = SentimentOracle.attach(CONTRACT_ADDRESSES.sentimentOracle);

  const [apiDeposit, llmDeposit, websiteDeposit] = await sentimentOracle.getDepositRequired();
  console.log(`Deposits required:
    JSON API (CoinGecko):     ${formatEther(apiDeposit)} STT
    LLM Parse Website (CoinDesk): ${formatEther(websiteDeposit)} STT
    LLM Inference (sentiment+vol): ${formatEther(llmDeposit)} STT\n`);

  // Step 1: CoinGecko price via JSON API Agent
  console.log("1️⃣  Requesting CoinGecko price (JSON API Agent)...");
  try {
    const tx = await sentimentOracle.requestApiPrice({ value: apiDeposit });
    await tx.wait();
    console.log(`   ✅ Request sent — tx: ${tx.hash}`);
    console.log("   ⏳ Waiting ~60s for Somnia validators to fetch CoinGecko...");
  } catch (e: any) {
    console.log(`   ⚠️  Failed: ${e?.reason || e?.message || "unknown"}`);
  }

  console.log();

  // Step 2: CoinDesk price via LLM Parse Website Agent
  console.log("2️⃣  Requesting CoinDesk price extraction (LLM Parse Website Agent)...");
  try {
    const tx = await sentimentOracle.requestWebsitePrice({ value: websiteDeposit });
    await tx.wait();
    console.log(`   ✅ Request sent — tx: ${tx.hash}`);
    console.log("   ⏳ Waiting ~60s for LLM parse website...");
  } catch (e: any) {
    console.log(`   ⚠️  Failed: ${e?.reason || e?.message || "unknown"}`);
  }

  console.log();

  // Step 3: Sentiment analysis via LLM Inference Agent
  console.log("3️⃣  Analyzing sentiment (LLM Inference Agent)...");
  try {
    const tx = await sentimentOracle.analyzeSentiment(
      "Bitcoin ETF inflows reach record high of 2.1 billion dollars signaling strong institutional interest",
      { value: llmDeposit }
    );
    await tx.wait();
    console.log(`   ✅ Sentiment analysis sent — tx: ${tx.hash}`);
    console.log("   ⏳ Waiting ~60s for LLM inference...");
  } catch (e: any) {
    console.log(`   ⚠️  Failed: ${e?.reason || e?.message || "unknown"}`);
  }

  console.log();

  // Step 4: Volatility scoring via LLM Inference Agent
  console.log("4️⃣  Computing volatility score (LLM Inference Agent)...");
  try {
    const tx = await sentimentOracle.computeVolatilityScore(
      "105000,104800,105200,105500,104900,105100,105300,104700",
      { value: llmDeposit }
    );
    await tx.wait();
    console.log(`   ✅ Volatility score sent — tx: ${tx.hash}`);
    console.log("   ⏳ Waiting ~60s for LLM inference...");
  } catch (e: any) {
    console.log(`   ⚠️  Failed: ${e?.reason || e?.message || "unknown"}`);
  }

  console.log();
  console.log("✅ All 4 agent requests sent! Check frontend AgentDashboard in ~60s for results.");
  console.log(`   View on explorer: https://explorer.testnet.somnia.network/address/${CONTRACT_ADDRESSES.sentimentOracle}`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });