import { ethers } from "hardhat";

const MOCK_PRICE_FEED = "0xFBf1D7d9B1F94254aE1426B154eda465cFEabB19";
const ORACLE_ADAPTER = "0x96c7879c149c7A1Ad18c5bb905ee297B1e79AAf0";

async function main() {
  // 1. Fetch real BTC/USD price from CoinGecko (off-chain HTTP — no Somnia agent delay)
  console.log("1️⃣  Fetching real BTC/USD price from CoinGecko...");
  const response = await fetch(
    "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd"
  );
  const data = (await response.json()) as { bitcoin: { usd: number } };
  const realPrice = data.bitcoin.usd;
  console.log(`   Current BTC price: $${realPrice.toLocaleString()}`);

  // 2. Push on-chain via MockPriceFeed (instant — no agent delay)
  const priceWei = BigInt(Math.floor(realPrice * 1e8)); // 8 decimals
  console.log(`   Price in wei: ${priceWei.toString()}`);

  const [deployer] = await ethers.getSigners();

  const MockPriceFeed = await ethers.getContractFactory("MockPriceFeed");
  const mockFeed = MockPriceFeed.attach(MOCK_PRICE_FEED);
  const tx1 = await mockFeed.updatePrice(priceWei);
  await tx1.wait();
  console.log("   ✅ MockPriceFeed updated on-chain");

  // 3. Emit PriceUpdated to trigger reactive cascade
  const OracleAdapter = await ethers.getContractFactory("OracleAdapter");
  const oracle = OracleAdapter.attach(ORACLE_ADAPTER);
  const tx2 = await oracle.updatePriceDirect(priceWei);
  await tx2.wait();
  console.log("   ✅ OracleAdapter emitted PriceUpdated → reactive cascade fires");
  console.log();
  console.log(`✅ BTC/USD now $${realPrice.toLocaleString()} — frontend updates in ~3s`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });