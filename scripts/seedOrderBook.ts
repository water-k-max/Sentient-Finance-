import { ethers } from "hardhat";

/**
 * Seed the order book with initial depth for the demo.
 * Places 10 staggered limit buy orders and 10 staggered limit sell orders
 * around the mock oracle's initial price with 0.1% increments.
 */
async function main() {
  if (process.argv.length < 4) {
    console.log("Usage: npx hardhat run scripts/seedOrderBook.ts --network <network> -- <orderBookAddr> <marginVaultAddr>");
    process.exit(1);
  }

  const orderBookAddr = process.argv[2];
  const marginVaultAddr = process.argv[3];

  const [deployer] = await ethers.getSigners();
  console.log(`Seeding order book from: ${deployer.address}\n`);

  const OrderBook = await ethers.getContractFactory("OrderBook");
  const orderBook = OrderBook.attach(orderBookAddr);

  const MarginVault = await ethers.getContractFactory("MarginVault");
  const marginVault = MarginVault.attach(marginVaultAddr);

  const PRICE_SCALE = 10n ** 8n;
  const SIZE_SCALE = 10n ** 18n;
  const midPrice = 50000n * PRICE_SCALE; // $50,000
  const size = 1n * SIZE_SCALE;
  const leverage = 10n;

  console.log(`Mid price: $50,000 | Size: 1 BTC | Leverage: 10x\n`);

  // Calculate total margin needed
  const notional = (size * midPrice) / SIZE_SCALE;
  const marginPerOrder = notional / leverage;
  const totalMargin = marginPerOrder * 20n; // 10 bids + 10 asks

  console.log(`Depositing ${totalMargin / SIZE_SCALE} USDC collateral...`);
  await marginVault.connect(deployer).deposit(totalMargin);
  console.log("✅ Collateral deposited\n");

  // Place 10 bid orders (below mid price, descending)
  console.log("Placing 10 bid orders...");
  for (let i = 1; i <= 10; i++) {
    const priceOffset = (midPrice * BigInt(i) * 10n) / 10000n; // 0.1% increments
    const bidPrice = midPrice - priceOffset;

    const tx = await orderBook.connect(deployer).placeOrder(true, bidPrice, size, leverage);
    await tx.wait();
    console.log(`  Bid #${i}: $${Number(bidPrice / PRICE_SCALE).toLocaleString()}`);
  }

  console.log("\nPlacing 10 ask orders...");
  for (let i = 1; i <= 10; i++) {
    const priceOffset = (midPrice * BigInt(i) * 10n) / 10000n;
    const askPrice = midPrice + priceOffset;

    const tx = await orderBook.connect(deployer).placeOrder(false, askPrice, size, leverage);
    await tx.wait();
    console.log(`  Ask #${i}: $${Number(askPrice / PRICE_SCALE).toLocaleString()}`);
  }

  console.log("\n✅ Order book seeded!");
  console.log(`Best bid: $${Number(await orderBook.bestBid() / PRICE_SCALE).toLocaleString()}`);
  console.log(`Best ask: $${Number(await orderBook.bestAsk() / PRICE_SCALE).toLocaleString()}`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
