import { ethers } from "hardhat";

// Deployed addresses
const REGISTRY = "0xAb3b04A51f052c817969EF28DeF409FAF9544756";
const ORACLE = "0xFbA084Db55bc52B6c3a872963636b69145FE834e";
const COMPOSITE = "0x9643278A02453da6e7087873440942f8e99266B8";

const ORDER_BOOKS: Record<string, string> = {
  "BTC-USD": "0xA830E52C62F7694Ed859d9D6414cc203FC20B481",
  "ETH-USD": "0x64E1235dFd0AC1887B5FB852309f959817ac45B2",
  "SOL-USD": "0x1873B69a805Bd771cB74bF7a38997c730dcF3158",
};
const MARGIN_VAULT = "0xe6D13e4bdC46b0DAcB238FAAd8118d9a8033032b";
const MOCK_FEED = "0xFBf1D7d9B1F94254aE1426B154eda465cFEabB19";
const OLD_ORACLE = "0x96c7879c149c7A1Ad18c5bb905ee297B1e79AAf0";

const PRICE_SCALE = 10n ** 8n;
const SIZE_SCALE = 10n ** 18n;

async function main() {
  const [deployer] = await ethers.getSigners();

  // ============================================================
  // 1. Add 2 more keepers for demo (3 registered, 1 posts)
  // ============================================================
  console.log("1️⃣  Adding keepers to registry...");
  const KeeperRegistry = await ethers.getContractFactory("KeeperRegistry");
  const registry = KeeperRegistry.attach(REGISTRY);

  const keeper2 = "0x0000000000000000000000000000000000000002";
  const keeper3 = "0x0000000000000000000000000000000000000003";

  try {
    await (await registry.addKeeper(keeper2, { value: ethers.parseEther("0.1") })).wait();
    console.log(`   Keeper 2: ${keeper2}`);
  } catch { console.log("   Keeper 2 already exists"); }
  try {
    await (await registry.addKeeper(keeper3, { value: ethers.parseEther("0.1") })).wait();
    console.log(`   Keeper 3: ${keeper3}`);
  } catch { console.log("   Keeper 3 already exists"); }

  const keeperCount = await registry.activeKeeperCount();
  console.log(`   Total active keepers: ${keeperCount}`);

  // ============================================================
  // 2. Fetch real prices, post all 3 pairs
  // ============================================================
  console.log("\n2️⃣  Fetching real prices from CoinGecko...");

  const [btcResp, ethResp, solResp] = await Promise.all([
    fetch("https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd"),
    fetch("https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd"),
    fetch("https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd"),
  ]);

  const btcData = (await btcResp.json()) as { bitcoin: { usd: number } };
  const ethData = (await ethResp.json()) as { ethereum: { usd: number } };
  const solData = (await solResp.json()) as { solana: { usd: number } };

  const prices: Record<string, { usd: number; wei: bigint; wei18: bigint }> = {
    "BTC-USD": {
      usd: btcData.bitcoin.usd,
      wei: BigInt(Math.floor(btcData.bitcoin.usd * 1e8)),
      wei18: BigInt(Math.floor(btcData.bitcoin.usd * 1e18)),
    },
    "ETH-USD": {
      usd: ethData.ethereum.usd,
      wei: BigInt(Math.floor(ethData.ethereum.usd * 1e8)),
      wei18: BigInt(Math.floor(ethData.ethereum.usd * 1e18)),
    },
    "SOL-USD": {
      usd: solData.solana.usd,
      wei: BigInt(Math.floor(solData.solana.usd * 1e8)),
      wei18: BigInt(Math.floor(solData.solana.usd * 1e18)),
    },
  };

  const SomniaPriceOracle = await ethers.getContractFactory("SomniaPriceOracle");
  const oracle = SomniaPriceOracle.attach(ORACLE);

  const CompositeOracle = await ethers.getContractFactory("CompositeOracle");
  const composite = CompositeOracle.attach(COMPOSITE);

  // Post keeper prices for all 3 pairs
  for (const [pair, data] of Object.entries(prices)) {
    const assetId = ethers.keccak256(ethers.toUtf8Bytes(pair));
    const tx = await oracle.connect(deployer).postPrice(assetId, data.wei18);
    await tx.wait();
    console.log(`   ${pair}: $${data.usd.toLocaleString()} → posted as keeper`);
  }

  // ============================================================
  // 3. Update MockPriceFeed for backward compat
  // ============================================================
  console.log("\n3️⃣  Updating MockPriceFeed...");
  const MockPriceFeed = await ethers.getContractFactory("MockPriceFeed");
  const feed = MockPriceFeed.attach(MOCK_FEED);
  await (await feed.updatePrice(prices["BTC-USD"].wei)).wait();

  const OracleAdapter = await ethers.getContractFactory("OracleAdapter");
  const oa = OracleAdapter.attach(OLD_ORACLE);
  await (await oa.updatePriceDirect(prices["BTC-USD"].wei)).wait();
  console.log("   ✅ OracleAdapter also updated");

  // ============================================================
  // 4. Reseed order books at current prices
  // ============================================================
  console.log("\n4️⃣  Reseeding order books at current prices...");
  const OrderBook = await ethers.getContractFactory("OrderBook");
  const MarginVault = await ethers.getContractFactory("MarginVault");
  const vault = MarginVault.attach(MARGIN_VAULT);

  for (const [pairName, obAddr] of Object.entries(ORDER_BOOKS)) {
    const pd = prices[pairName];
    const midPrice = pd.wei;  // 8-decimal price
    const ob = OrderBook.attach(obAddr);
    const lev = 10n;
    const size = 1n * SIZE_SCALE;

    // Check if already seeded at current price
    const bestBid = await ob.bestBid();
    const bestAsk = await ob.bestAsk();
    const bidUsd = Number(bestBid) / 1e8;
    const targetUsd = pd.usd;
    const diffPct = Math.abs(bidUsd - targetUsd) / targetUsd * 100;

    if (bestBid > 0n && diffPct < 5) {
      console.log(`   ${pairName}: within 5% of target, skipping (bid: $${bidUsd.toLocaleString()})`);
      continue;
    }

    // Deposit margin
    const notional = (size * midPrice) / (10n ** 18n);
    const margPerOrder = notional / lev;
    await (await vault.connect(deployer).deposit(margPerOrder * 22n)).wait();

    const step = midPrice / 1000n; // 0.1% steps
    for (let i = 1; i <= 10; i++) {
      const offset = step * BigInt(i) * 10n;
      try {
        await (await ob.connect(deployer).placeOrder(true, midPrice - offset, size, lev)).wait();
      } catch {}
    }
    for (let i = 1; i <= 10; i++) {
      const offset = step * BigInt(i) * 10n;
      try {
        await (await ob.connect(deployer).placeOrder(false, midPrice + offset, size, lev)).wait();
      } catch {}
    }
    const newBid = Number(await ob.bestBid()) / 1e8;
    const newAsk = Number(await ob.bestAsk()) / 1e8;
    console.log(`   ${pairName}: seeded — Best bid: $${newBid.toLocaleString()} | Best ask: $${newAsk.toLocaleString()}`);
  }

  console.log("\n✅ All improvements applied!");
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });