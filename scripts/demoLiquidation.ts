import { ethers } from "hardhat";
import { CONTRACT_ADDRESSES } from "./addresses";

const PRICE_SCALE = 10n ** 8n;
const USDC_SCALE = 10n ** 6n;

async function main() {
  const [deployer, trader] = await ethers.getSigners();
  console.log(`Deployer: ${deployer.address}`);
  console.log(`Trader:   ${trader.address}`);

  // ── 1. Fetch live BTC price ────────────────────────────────────────────────
  console.log("\n1️⃣  Fetching live BTC price from CoinGecko...");
  const resp = await fetch(
    "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd"
  );
  const data = (await resp.json()) as { bitcoin: { usd: number } };
  const livePrice = data.bitcoin.usd;
  const priceWei = BigInt(Math.floor(livePrice * 1e8));
  console.log(`   BTC: $${livePrice.toLocaleString()}`);

  // ── 2. Attach to deployed contracts ────────────────────────────────────────
  const MockPriceFeed = await ethers.getContractFactory("MockPriceFeed");
  const mockFeed = MockPriceFeed.attach(CONTRACT_ADDRESSES.mockPriceFeed);

  const OracleAdapter = await ethers.getContractFactory("OracleAdapter");
  const oracle = OracleAdapter.attach(CONTRACT_ADDRESSES.oracleAdapter);

  const MockUSDC = await ethers.getContractFactory("MockUSDC");
  const mockUSDC = MockUSDC.attach(CONTRACT_ADDRESSES.mockUSDC);

  const MarginVault = await ethers.getContractFactory("MarginVault");
  const marginVault = MarginVault.attach(CONTRACT_ADDRESSES.marginVault);

  const OrderBook = await ethers.getContractFactory("OrderBook");
  const orderBook = OrderBook.attach(CONTRACT_ADDRESSES.orderBooks["BTC-USD"]);

  const LiquidityProviderAgent = await ethers.getContractFactory("LiquidityProviderAgent");
  const lpAgent = LiquidityProviderAgent.attach(CONTRACT_ADDRESSES.liquidityProviderAgent);

  const AgentInterface = await ethers.getContractFactory("AgentInterface");
  const agentInterface = AgentInterface.attach(CONTRACT_ADDRESSES.agentInterface);

  const LiquidationSentinel = await ethers.getContractFactory("LiquidationSentinel");
  const sentinel = LiquidationSentinel.attach(CONTRACT_ADDRESSES.liquidationSentinel);

  // ── 3. Push live price on-chain + rebalance LP agent ───────────────────────
  console.log("\n2️⃣  Pushing live price on-chain...");
  await (await mockFeed.updatePrice(priceWei)).wait();
  await (await oracle.updatePriceDirect(priceWei)).wait();
  console.log(`   ✅ Price pushed ($${livePrice.toLocaleString()})`);

  console.log("   🔄 Rebalancing LP agent...");
  await lpAgent.rebalance(priceWei);
  console.log("   ✅ LP agent placed two-sided orders");

  // Read the order book to get current prices for trade
  const bestAsk = await orderBook.bestAsk();
  const bestBid = await orderBook.bestBid();
  console.log(`   Best bid: $${(Number(bestBid) / 1e8).toLocaleString()}`);
  console.log(`   Best ask: $${(Number(bestAsk) / 1e8).toLocaleString()}`);

  if (bestAsk === 0n) {
    console.log("   ❌ No ask liquidity — cannot open long. Exiting.");
    return;
  }

  // ── 4. Fund trader + open a leveraged LONG position ────────────────────────
  console.log("\n3️⃣  Opening leveraged position...");
  const size = 5_000n * USDC_SCALE;     // 5,000 USDC notional
  const leverage = 10n;
  const margin = size / leverage;       // 500 USDC margin required
  const vaultAddr = await marginVault.getAddress();

  // Mint USDC to trader, approve vault, deposit
  await mockUSDC.mint(trader.address, margin * 2n);
  await mockUSDC.connect(trader).approve(vaultAddr, margin * 2n);
  await marginVault.connect(trader).deposit(margin * 2n);
  console.log(`   💰 Trader deposited ${ethers.formatUnits(margin * 2n, 6)} USDC as margin`);

  // Place a bid (long) at bestAsk, matching against the LP agent's ask order
  const fillPrice = bestAsk;
  const tx = await orderBook.connect(trader).placeOrder(true, fillPrice, size, leverage);
  await tx.wait();
  console.log(`   ✅ Long position opened at $${(Number(fillPrice) / 1e8).toLocaleString()}`);

  // ── 5. Verify position ─────────────────────────────────────────────────────
  console.log("\n4️⃣  Verifying position...");
  const pos = await marginVault.getPosition(trader.address);
  const health = await marginVault.marginHealth(trader.address);
  const maintRatio = await marginVault.MAINTENANCE_MARGIN_RATIO();

  console.log(`   Position open: ${pos.isOpen}`);
  console.log(`   Size: ${ethers.formatUnits(pos.size, 6)} USDC`);
  console.log(`   Margin: ${ethers.formatUnits(pos.margin, 6)} USDC`);
  console.log(`   Leverage: ${pos.leverage}x`);
  console.log(`   Entry price: $${(Number(pos.entryPrice) / 1e8).toLocaleString()}`);
  console.log(`   Margin health: ${(Number(health) / 1e16).toFixed(1)}%`);
  console.log(`   Liquidation threshold: ${(Number(maintRatio) / 1e16).toFixed(1)}%`);

  if (!pos.isOpen || health < maintRatio) {
    console.log("   ❌ Position not healthy — cannot demonstrate liquidation. Exiting.");
    return;
  }

  // ── 6. Crash price −15% ────────────────────────────────────────────────────
  console.log("\n5️⃣  Crashing price by 15%...");
  const crashPrice = priceWei * 85n / 100n;
  const crashUsd = Number(crashPrice) / 1e8;
  console.log(`   New price: $${crashUsd.toLocaleString()} (${livePrice > crashUsd ? "-" : "+"}${Math.abs((1 - Number(crashPrice) / Number(priceWei)) * 100).toFixed(1)}%)`);

  await (await mockFeed.updatePrice(crashPrice)).wait();
  await (await oracle.updatePriceDirect(crashPrice)).wait();

  // ── 7. Trigger full reactive cascade (no keeper needed) ────────────────────
  console.log("\n6️⃣  Triggering reactive cascade...");
  const cascadeTx = await agentInterface.simulatePriceUpdate(crashPrice);
  await cascadeTx.wait();
  console.log("   ✅ simulatePriceUpdate executed — cascade includes:");
  console.log("      • updateAllPnL (recalc PnL at crash price)");
  console.log("      • sentinel.checkAllPositions (iterate traders, liquidate unhealthy)");
  console.log("      • LP agent rebalance (place orders at new price)");

  // ── 8. Verify liquidation ──────────────────────────────────────────────────
  console.log("\n7️⃣  Verifying liquidation...");
  const events = await sentinel.queryFilter(
    sentinel.filters.LiquidationExecuted()
  );

  if (events.length > 0) {
    console.log(`   ✅ LiquidationExecuted event fired — ${events.length} liquidation(s)`);
    for (const ev of events) {
      console.log(`      Trader: ${ev.args.trader}  |  Timestamp: ${ev.args.timestamp}`);
    }
  } else {
    console.log("   ❌ No LiquidationExecuted events found");
  }

  const posAfter = await marginVault.getPosition(trader.address);
  console.log(`   Position open after attempt: ${posAfter.isOpen}`);

  if (!posAfter.isOpen && events.length > 0) {
    console.log("\n✅ Demo liquidation successful — reactive cascade fired without keeper");
  } else {
    console.log("\n⚠️  Liquidation did not trigger as expected");
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
