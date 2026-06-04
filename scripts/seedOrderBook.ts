import { ethers } from "hardhat";
import { CONTRACT_ADDRESSES } from "./addresses";

/**
 * Seed all three order books with initial depth for the demo.
 * Places 10 staggered limit buy and 10 staggered limit sell orders
 * around each pair's mid price with 0.1% increments.
 *
 * Usage: npx hardhat run scripts/seedOrderBook.ts --network somnia
 */
async function main() {

  const pairConfigs: Record<string, { midPrice: number; step: number }> = {
    "BTC-USD": { midPrice: 50000, step: 50 },
    "ETH-USD": { midPrice: 3000, step: 3 },
    "SOL-USD": { midPrice: 150, step: 0.15 },
  };

  const [deployer] = await ethers.getSigners();
  console.log(`Seeding from: ${deployer.address}\n`);

  const MarginVault = await ethers.getContractFactory("MarginVault");
  const marginVault = MarginVault.attach(CONTRACT_ADDRESSES.marginVault);

  const OrderBook = await ethers.getContractFactory("OrderBook");

  const PRICE_SCALE = 10n ** 8n;
  const SIZE_SCALE = 10n ** 18n;
  const size = 1n * SIZE_SCALE;
  const leverage = 10n;

  // Seed each pair
  for (const [pairName, obAddr] of Object.entries(CONTRACT_ADDRESSES.orderBooks)) {
    const config = pairConfigs[pairName];
    const midPrice = BigInt(Math.floor(config.midPrice)) * PRICE_SCALE;
    const step = BigInt(Math.floor(config.step * 1e8));

    console.log(`\n📊 Seeding ${pairName}...`);
    const orderBook = OrderBook.attach(obAddr);

    // Calculate margin and deposit
    const notional = (size * midPrice) / SIZE_SCALE;
    const marginPerOrder = notional / leverage;
    const totalMargin = marginPerOrder * 20n;

    console.log(`  Mid: $${config.midPrice} | Deposit: ${totalMargin / SIZE_SCALE} USDC`);
    await marginVault.connect(deployer).deposit(totalMargin);

    // Place 10 bids (descending from mid price)
    for (let i = 1; i <= 10; i++) {
      const priceOffset = (midPrice * BigInt(i) * 10n) / 10000n;
      const bidPrice = midPrice - priceOffset;

      const tx = await orderBook.connect(deployer).placeOrder(true, bidPrice, size, leverage);
      await tx.wait();
      const priceUsd = Number(bidPrice) / 1e8;
      console.log(`    Bid #${i}: $${priceUsd.toLocaleString()}`);
    }

    // Place 10 asks (ascending from mid price)
    for (let i = 1; i <= 10; i++) {
      const priceOffset = (midPrice * BigInt(i) * 10n) / 10000n;
      const askPrice = midPrice + priceOffset;

      const tx = await orderBook.connect(deployer).placeOrder(false, askPrice, size, leverage);
      await tx.wait();
      const priceUsd = Number(askPrice) / 1e8;
      console.log(`    Ask #${i}: $${priceUsd.toLocaleString()}`);
    }

    const bestBid = Number(await orderBook.bestBid()) / 1e8;
    const bestAsk = Number(await orderBook.bestAsk()) / 1e8;
    console.log(`  ✅ ${pairName} seeded — Best bid: $${bestBid.toLocaleString()} | Best ask: $${bestAsk.toLocaleString()}`);
  }

  console.log("\n✅ All order books seeded!");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });