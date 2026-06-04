import { ethers } from "hardhat";
import { CONTRACT_ADDRESSES } from "./addresses";

const PRICE_SCALE = 10n ** 8n;
const SIZE_SCALE = 10n ** 18n;

async function main() {
  const [deployer] = await ethers.getSigners();

  // ============================================================
  // 1. Add 2 more keepers for demo (3 registered, 1 posts)
  // ============================================================
  console.log("1️⃣  Adding keepers to registry...");
  const KeeperRegistry = await ethers.getContractFactory("KeeperRegistry");
  const registry = KeeperRegistry.attach(CONTRACT_ADDRESSES.keeperRegistry);

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
  const oracle = SomniaPriceOracle.attach(CONTRACT_ADDRESSES.somniaPriceOracle);

  const CompositeOracle = await ethers.getContractFactory("CompositeOracle");
  const composite = CompositeOracle.attach(CONTRACT_ADDRESSES.compositeOracle);

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
  const feed = MockPriceFeed.attach(CONTRACT_ADDRESSES.mockPriceFeed);
  await (await feed.updatePrice(prices["BTC-USD"].wei)).wait();

  const OracleAdapter = await ethers.getContractFactory("OracleAdapter");
  const oa = OracleAdapter.attach(CONTRACT_ADDRESSES.oracleAdapter);
  await (await oa.updatePriceDirect(prices["BTC-USD"].wei)).wait();
  console.log("   ✅ OracleAdapter also updated");

  // ============================================================
  // 4. Reseed order books at current prices
  // ============================================================
  console.log("\n4️⃣  Reseeding order books at current prices...");
  const OrderBook = await ethers.getContractFactory("OrderBook");
  const MarginVault = await ethers.getContractFactory("MarginVault");
  const vault = MarginVault.attach(CONTRACT_ADDRESSES.marginVault);

  for (const [pairName, obAddr] of Object.entries(CONTRACT_ADDRESSES.orderBooks)) {
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