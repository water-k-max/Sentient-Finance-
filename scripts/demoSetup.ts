import { ethers } from "hardhat";

// Deployed addresses
const ORDER_BOOKS: Record<string, string> = {
  "BTC-USD": "0xA830E52C62F7694Ed859d9D6414cc203FC20B481",
  "ETH-USD": "0x64E1235dFd0AC1887B5FB852309f959817ac45B2",
  "SOL-USD": "0x1873B69a805Bd771cB74bF7a38997c730dcF3158",
};
const MARGIN_VAULT = "0xe6D13e4bdC46b0DAcB238FAAd8118d9a8033032b";
const MOCK_PRICE_FEED = "0xFBf1D7d9B1F94254aE1426B154eda465cFEabB19";
const ORACLE_ADAPTER = "0x96c7879c149c7A1Ad18c5bb905ee297B1e79AAf0";
const SENTIMENT_ORACLE = "0xC8c4a728b9A3A1e700F6ff59fBdb08De3657B584";
const AGENT_ORACLE = "0xfB2DCde9E6A634dfC70ea0d529DE48630F72F0f9";

const PRICE_SCALE = 10n ** 8n;
const SIZE_SCALE = 10n ** 18n;
const size = 1n * SIZE_SCALE;
const leverage = 10n;

const PAIR_CONFIGS: Record<string, { midPrice: number; step: number }> = {
  "BTC-USD": { midPrice: 74000, step: 50 },
  "ETH-USD": { midPrice: 3500, step: 3 },
  "SOL-USD": { midPrice: 180, step: 0.5 },
};

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Seeder:", deployer.address);

  // 1. Fetch real BTC price from CoinGecko, push on-chain
  console.log("\n💰 Fetching real BTC/USD price...");
  try {
    const resp = await fetch(
      "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd"
    );
    const data = (await resp.json()) as { bitcoin: { usd: number } };
    const realPrice = data.bitcoin.usd;
    console.log(`   BTC: $${realPrice.toLocaleString()}`);

    const priceWei = BigInt(Math.floor(realPrice * 1e8));
    const MockPriceFeed = await ethers.getContractFactory("MockPriceFeed");
    const feed = MockPriceFeed.attach(MOCK_PRICE_FEED);
    await (await feed.updatePrice(priceWei)).wait();

    const OracleAdapter = await ethers.getContractFactory("OracleAdapter");
    const oracle = OracleAdapter.attach(ORACLE_ADAPTER);
    await (await oracle.updatePriceDirect(priceWei)).wait();
    console.log("   ✅ PriceUpdate emitted → reactive cascade fires");
  } catch (e: any) {
    console.log("   ⚠️  CoinGecko fetch failed, using last known price");
  }

  // 2. Call all 3 Somnia agents in parallel for callbacks
  console.log("\n🤖 Calling Somnia agents (Threshold 2/3)...");

  try {
    const SentimentOracle = await ethers.getContractFactory("SentimentOracle");
    const sentimentOracle = SentimentOracle.attach(SENTIMENT_ORACLE);

    // Fire all 3 in parallel
    const [tx1, tx2, tx3] = await Promise.allSettled([
      sentimentOracle.requestApiPrice({ value: ethers.parseEther("0.12") }),
      sentimentOracle.analyzeSentiment(
        "Bitcoin ETF inflows reach record 2.1 billion as institutional demand surges",
        { value: ethers.parseEther("0.24") }
      ),
      sentimentOracle.computeVolatilityScore(
        "105000,104800,105200,105500,104900,105100,105300,104700",
        { value: ethers.parseEther("0.24") }
      ),
    ]);

    if (tx1.status === "fulfilled") {
      const r = await tx1.value.wait();
      console.log("   ✅ JSON API Agent called — tx:", r.hash);
    }
    if (tx2.status === "fulfilled") {
      const r = await tx2.value.wait();
      console.log("   ✅ Sentiment analysis called — tx:", r.hash);
    }
    if (tx3.status === "fulfilled") {
      const r = await tx3.value.wait();
      console.log("   ✅ Volatility scoring called — tx:", r.hash);
    }

    console.log("   ⏳ AgentDashboard updates in ~30-120s after validators respond");
  } catch (e: any) {
    console.log("   ⚠️  Agent calls failed:", e?.reason || e?.message);
  }

  // 3. Seed order books for each pair
  console.log("\n📊 Seeding order books...");
  const OrderBook = await ethers.getContractFactory("OrderBook");
  const MarginVault = await ethers.getContractFactory("MarginVault");
  const vault = MarginVault.attach(MARGIN_VAULT);

  for (const [pairName, obAddr] of Object.entries(ORDER_BOOKS)) {
    const cfg = PAIR_CONFIGS[pairName];
    const midPrice = BigInt(Math.floor(cfg.midPrice)) * PRICE_SCALE;
    const orderBook = OrderBook.attach(obAddr);

    // Check if book already has depth
    const bestBid = await orderBook.bestBid();
    const bestAsk = await orderBook.bestAsk();
    if (bestBid > 0n && bestAsk > 0n) {
      console.log(`   ${pairName}: already seeded (bid: $${(Number(bestBid) / 1e8).toLocaleString()}, ask: $${(Number(bestAsk) / 1e8).toLocaleString()})`);
      continue;
    }

    const notional = (size * midPrice) / SIZE_SCALE;
    const marginPerOrder = notional / leverage;
    const totalMargin = marginPerOrder * 20n;
    await vault.deployer && vault.connect(deployer).deposit(totalMargin);

    for (let i = 1; i <= 10; i++) {
      const offset = (midPrice * BigInt(i) * 10n) / 10000n;
      await (await orderBook.connect(deployer).placeOrder(true, midPrice - offset, size, leverage)).wait();
    }
    for (let i = 1; i <= 10; i++) {
      const offset = (midPrice * BigInt(i) * 10n) / 10000n;
      await (await orderBook.connect(deployer).placeOrder(false, midPrice + offset, size, leverage)).wait();
    }
    console.log(`   ✅ ${pairName} seeded`);
  }

  console.log("\n✅ Done — frontend at http://localhost:3000");
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });