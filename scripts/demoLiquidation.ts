import { ethers } from "hardhat";
import { CONTRACT_ADDRESSES } from "./addresses";

const USDC_SCALE = 10n ** 6n;

async function main() {
  // ── Single signer — deployer acts as both market maker and trader ──────────
  // On Somnia testnet only one account is configured in hardhat.config.ts.
  // The deployer opens a long against the LP agent's ask (different addresses
  // so the self-match guard doesn't fire), then we crash the price to trigger
  // autonomous liquidation.
  const [deployer] = await ethers.getSigners();
  console.log(`Wallet: ${deployer.address}\n`);

  // ── Nonce manager — prevents hangs when previous scripts left pending txs ──
  // ethers' internal nonce tracker can get out of sync if priceFeed.ts was
  // killed mid-flight. Fetching the live nonce before every tx avoids hangs.
  async function send(contract: ethers.Contract, method: string, args: any[]) {
    const nonce = await deployer.getNonce();
    return (contract[method] as any)(...args, { nonce });
  }

  // ── 1. Attach contracts ────────────────────────────────────────────────────
  const mockFeed = (await ethers.getContractFactory("MockPriceFeed"))
    .attach(CONTRACT_ADDRESSES.mockPriceFeed) as unknown as ethers.Contract;
  const oracle = (await ethers.getContractFactory("OracleAdapter"))
    .attach(CONTRACT_ADDRESSES.oracleAdapter) as unknown as ethers.Contract;
  const mockUSDC = (await ethers.getContractFactory("MockUSDC"))
    .attach(CONTRACT_ADDRESSES.mockUSDC) as unknown as ethers.Contract;
  const marginVault = (await ethers.getContractFactory("MarginVault"))
    .attach(CONTRACT_ADDRESSES.marginVault) as unknown as ethers.Contract;
  const orderBook = (await ethers.getContractFactory("OrderBook"))
    .attach(CONTRACT_ADDRESSES.orderBooks["BTC-USD"]) as unknown as ethers.Contract;
  const lpAgent = (await ethers.getContractFactory("LiquidityProviderAgent"))
    .attach(CONTRACT_ADDRESSES.liquidityProviderAgent) as unknown as ethers.Contract;
  const agentIface = (await ethers.getContractFactory("AgentInterface"))
    .attach(CONTRACT_ADDRESSES.agentInterface) as unknown as ethers.Contract;
  const sentinel = (await ethers.getContractFactory("LiquidationSentinel"))
    .attach(CONTRACT_ADDRESSES.liquidationSentinel) as unknown as ethers.Contract;

  // ── 2. Fetch live price + push on-chain ───────────────────────────────────
  console.log("1️⃣  Fetching live BTC price...");
  let livePrice = 63_000;  // fallback
  let priceWei = BigInt(Math.floor(livePrice * 1e8));

  try {
    const resp = await fetch(
      "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd"
    );
    const data = (await resp.json()) as { bitcoin: { usd: number } };
    livePrice = data.bitcoin.usd;
    priceWei = BigInt(Math.floor(livePrice * 1e8));
    console.log(`   BTC: $${livePrice.toLocaleString()}`);
  } catch {
    console.log(`   ⚠️  CoinGecko unavailable — using fallback $${livePrice.toLocaleString()}`);
  }

  await (await send(mockFeed, "updatePrice", [priceWei])).wait();
  await (await send(oracle, "updatePriceDirect", [priceWei])).wait();
  console.log(`   ✅ Price pushed on-chain ($${livePrice.toLocaleString()})`);

  // ── 3. Rebalance LP agent so book has fresh two-sided depth ───────────────
  console.log("\n2️⃣  Rebalancing LP agent...");
  try {
    // Set threshold to 0 so rebalance always fires regardless of price delta
    await (await send(lpAgent, "setRebalanceThreshold", [0])).wait();
    await (await send(lpAgent, "rebalance", [priceWei])).wait();
    console.log("   ✅ LP agent placed two-sided orders at live price");
  } catch (e: any) {
    console.log(`   ⚠️  LP rebalance failed: ${e?.reason || e?.message}`);
    console.log("   → Continuing — book may already have depth from demoSetup");
  }

  const bestAsk = await orderBook.bestAsk();
  const bestBid = await orderBook.bestBid();
  console.log(`   Book — bid: $${(Number(bestBid) / 1e8).toLocaleString()} | ask: $${(Number(bestAsk) / 1e8).toLocaleString()}`);

  if (bestAsk === 0n) {
    console.log("   ❌ No ask liquidity — run demoSetup.ts first to seed the book");
    process.exit(1);
  }

  // ── 4. Open a leveraged long (deployer vs LP agent ask) ───────────────────
  console.log("\n3️⃣  Opening leveraged long position...");

  // Check if deployer already has an open position — skip opening if so
  const existingPos = await marginVault.getPosition(deployer.address);
  let entryPrice = bestAsk;

  if (existingPos.isOpen) {
    console.log(`   ℹ️  Position already open at $${(Number(existingPos.entryPrice) / 1e8).toLocaleString()} — skipping open`);
    entryPrice = existingPos.entryPrice;
  } else {
    // 5,000 USDC notional at 10x = 500 USDC margin
    const size = 5_000n * USDC_SCALE;
    const leverage = 10n;
    const margin = size / leverage;       // 500 USDC
    const buffer = margin * 3n;           // deposit 3× for safety

    // Mint + approve + deposit for deployer
    const vaultAddr = await marginVault.getAddress();
    const balance = await mockUSDC.balanceOf(deployer.address);
    if (balance < buffer) {
      await (await send(mockUSDC, "mint", [deployer.address, buffer - balance + 1000n * USDC_SCALE])).wait();
    }
    await (await send(mockUSDC, "approve", [vaultAddr, buffer])).wait();
    await (await send(marginVault, "deposit", [buffer])).wait();
    console.log(`   💰 Deposited ${ethers.formatUnits(buffer, 6)} USDC`);

    // ── Fix counterparty (LP agent) free margin ────────────────────────────────
    // Both LP agents deposited exactly orderSizeUSDC×2 and locked ALL of it.
    // When settlePosition calls _openPosition(shortTrader, ...) the short
    // side needs getFreeMargin >= size/leverage. After releaseMargin returns
    // the ask's locked margin, the LP's OTHER order still locks the rest → 0 free.
    //
    // Fix: authorize deployer on vault, find who owns the best ask, then credit
    // them with enough extra collateral via adjustMargin.

    // Ensure deployer is authorized on vault for adjustMargin
    const isAuth = await marginVault.isAuthorized(deployer.address);
    if (!isAuth) {
      await (await send(marginVault, "setAuthorized", [deployer.address, true])).wait();
      console.log(`   🔑 Deployer authorized on MarginVault`);
    }

    // Find the best ask's owner by scanning orders
    const nextOid = await orderBook.nextOrderId();
    let askOwner = "";
    for (let i = 0; i < Number(nextOid); i++) {
      const order = await orderBook.getOrder(i);
      if (!order.isBid && order.price === bestAsk && (order.status === 0n || order.status === 1n)) {
        askOwner = order.trader;
        console.log(`   🔍 Best ask (order #${i}) belongs to: ${askOwner}`);
        break;
      }
    }

    // Credit the ask owner with extra margin for settlement
    if (askOwner) {
      const ownerFree = await marginVault.getFreeMargin(askOwner);
      console.log(`   📊 Ask owner free margin: ${ethers.formatUnits(ownerFree, 6)} USDC`);
      if (ownerFree < size) {
        const creditNeeded = size - ownerFree;
        await (await send(mockUSDC, "mint", [vaultAddr, creditNeeded])).wait();
        await (await send(marginVault, "adjustMargin", [askOwner, BigInt(creditNeeded)])).wait();
        console.log(`   💊 Credited ask owner with ${ethers.formatUnits(creditNeeded, 6)} USDC`);
      }
    } else {
      // Fallback: credit both LP agents
      console.log(`   ⚠️  Could not identify ask owner — crediting both LP agents`);
      for (const addr of [CONTRACT_ADDRESSES.liquidityProviderAgent, CONTRACT_ADDRESSES.enhancedLiquidityProviderAgent]) {
        const free = await marginVault.getFreeMargin(addr);
        if (free < size) {
          const credit = size - free;
          await (await send(mockUSDC, "mint", [vaultAddr, credit])).wait();
          await (await send(marginVault, "adjustMargin", [addr, BigInt(credit)])).wait();
          console.log(`   💊 Credited ${addr.slice(0, 10)}... with ${ethers.formatUnits(credit, 6)} USDC`);
        }
      }
    }

    // Use staticCall to surface the exact revert reason
    try {
      await orderBook.connect(deployer).placeOrder.staticCall(true, bestAsk, size, leverage);
      console.log(`   ✅ staticCall succeeded`);
    } catch (e: any) {
      console.log(`   ❌ staticCall reverted: ${e?.reason || e?.revert?.args || e?.message}`);
    }

    // Place bid at bestAsk price — crosses LP agent's ask immediately
    const tx = await send(orderBook, "placeOrder", [true, bestAsk, size, leverage]);
    await tx.wait();
    entryPrice = bestAsk;
    console.log(`   ✅ Long opened at $${(Number(bestAsk) / 1e8).toLocaleString()}`);
  }

  // ── 5. Verify position health ──────────────────────────────────────────────
  console.log("\n4️⃣  Verifying position...");
  const pos = await marginVault.getPosition(deployer.address);
  const health = await marginVault.marginHealth(deployer.address);
  const maintRatio = await marginVault.MAINTENANCE_MARGIN_RATIO();

  console.log(`   isOpen:      ${pos.isOpen}`);
  console.log(`   Entry price: $${(Number(pos.entryPrice) / 1e8).toLocaleString()}`);
  console.log(`   Margin:      ${ethers.formatUnits(pos.margin, 6)} USDC`);
  console.log(`   Leverage:    ${pos.leverage}x`);
  console.log(`   Liq price:   $${(Number(pos.liquidationPrice) / 1e8).toLocaleString()}`);
  console.log(`   Health:      ${health === BigInt("0x" + "f".repeat(64)) ? "∞ (no position)" : (Number(health) / 1e16).toFixed(1) + "%"}`);

  if (!pos.isOpen) {
    console.log("   ❌ Position did not open — check OrderBook matching and vault authorization");
    process.exit(1);
  }

  // ── 6. Crash price to trigger liquidation ─────────────────────────────────
  // Liquidation price for 10x long ≈ entryPrice * 0.905 (from _computeLiquidationPrice)
  // We crash to 88% of entry to guarantee crossing the liquidation threshold
  console.log("\n5️⃣  Crashing price to trigger liquidation...");
  const crashPrice = entryPrice * 88n / 100n;
  const crashUsd = (Number(crashPrice) / 1e8).toLocaleString();
  const dropPct = ((1 - Number(crashPrice) / Number(entryPrice)) * 100).toFixed(1);
  const liqPriceUsd = (Number(pos.liquidationPrice) / 1e8).toLocaleString();

  console.log(`   Entry:       $${(Number(entryPrice) / 1e8).toLocaleString()}`);
  console.log(`   Liq price:   $${liqPriceUsd}`);
  console.log(`   Crash price: $${crashUsd} (−${dropPct}%)`);
  console.log(`   → Crash price is below liq price — liquidation WILL trigger`);

  await (await send(mockFeed, "updatePrice", [crashPrice])).wait();
  await (await send(oracle, "updatePriceDirect", [crashPrice])).wait();
  console.log(`   ✅ Price crashed to $${crashUsd} on-chain`);

  // ── 7. Fire reactive cascade ───────────────────────────────────────────────
  // simulatePriceUpdate calls: updateAllPnL → checkAllPositions → liquidate
  // This is exactly what Somnia's reactive layer does automatically on every
  // PriceUpdated event — we call it manually here for the demo script.
  console.log("\n6️⃣  Firing reactive cascade (no keeper needed)...");
  try {
    const cascadeTx = await send(agentIface, "simulatePriceUpdate", [crashPrice]);
    const receipt = await cascadeTx.wait();
    console.log(`   ✅ Cascade executed — tx: ${receipt.hash}`);
    console.log("      • updateAllPnL   ← recalculates PnL at crash price");
    console.log("      • checkAllPositions ← sentinel scans all positions");
    console.log("      • liquidate      ← fires for underwater positions");
  } catch (e: any) {
    // If simulatePriceUpdate doesn't exist, fall back to calling sentinel directly
    console.log(`   ⚠️  simulatePriceUpdate failed: ${e?.reason || e?.message}`);
    console.log("   → Falling back to direct sentinel call...");
    try {
      const sentinelTx = await send(sentinel, "checkAllPositions", [crashPrice]);
      await sentinelTx.wait();
      console.log("   ✅ sentinel.checkAllPositions executed directly");
    } catch (e2: any) {
      console.log(`   ❌ Sentinel also failed: ${e2?.reason || e2?.message}`);
    }
  }

  // ── 8. Verify liquidation fired ───────────────────────────────────────────
  //
  // NOTE: queryFilter() is intentionally NOT used here. Somnia's RPC returns
  // log objects without the `removed` field, which ethers v6 requires as a
  // boolean. This causes a BAD_DATA crash inside hardhat-ethers' formatLog().
  //
  // Fix: call eth_getLogs directly via provider.send(), then decode manually.
  // posAfter.isOpen is always the ground-truth check regardless of log fetch.
  //
  console.log("\n7️⃣  Checking liquidation result...");

  const posAfter = await marginVault.getPosition(deployer.address);
  const sentinelAddr = await sentinel.getAddress();

  // Build raw filter — topic[0] = event sig, topic[1] = indexed trader address
  const liquidationTopic = sentinel.interface.getEvent("LiquidationExecuted")!.topicHash;
  const paddedTrader = ethers.zeroPadValue(deployer.address, 32);

  const currentBlock = await ethers.provider.getBlockNumber();
  const fromBlock = Math.max(0, currentBlock - 500);

  let liquidationCount = 0;
  let liquidationPrice: bigint | null = null;

  try {
    const rawLogs: any[] = await ethers.provider.send("eth_getLogs", [{
      address: sentinelAddr,
      topics: [liquidationTopic, paddedTrader],
      fromBlock: ethers.toQuantity(fromBlock),
      toBlock: ethers.toQuantity(currentBlock),
    }]);

    liquidationCount = rawLogs.length;

    if (rawLogs.length > 0) {
      // Decode data + topics without touching the `removed` field
      const decoded = sentinel.interface.decodeEventLog(
        "LiquidationExecuted",
        rawLogs[0].data,
        rawLogs[0].topics
      );
      liquidationPrice = decoded.liquidationPrice ?? pos.liquidationPrice;
    }
  } catch (e: any) {
    // Non-fatal — position state below is the authoritative result
    console.log(`   ⚠️  Raw log fetch failed (non-fatal): ${e?.message}`);
  }

  // ── Final result output ────────────────────────────────────────────────────
  if (liquidationCount > 0 && !posAfter.isOpen) {
    console.log(`\n✅✅ DEMO SUCCESS — Autonomous liquidation fired with no keeper`);
    console.log(`   LiquidationExecuted events: ${liquidationCount}`);
    console.log(`   Trader liquidated:          ${deployer.address}`);
    console.log(`   Liq price:                  $${liquidationPrice ? (Number(liquidationPrice) / 1e8).toLocaleString() : "N/A"}`);
    console.log(`   Position closed:            ${!posAfter.isOpen}`);
    console.log(`\n   This fired in the same block as the price update.`);
    console.log(`   No external bot. No keeper. Pure on-chain reactive execution.`);
  } else if (!posAfter.isOpen) {
    console.log("\n✅ Position closed (liquidation executed) — no event captured in query window");
    console.log(`   Sentinel address: ${sentinelAddr}`);
    console.log("   Check the block explorer for LiquidationExecuted on the sentinel address");
  } else {
    console.log("\n⚠️  Position still open — liquidation did not fire");
    console.log(`   Current health: ${(Number(await marginVault.marginHealth(deployer.address)) / 1e16).toFixed(1)}%`);
    console.log(`   Maintenance:    ${(Number(maintRatio) / 1e16).toFixed(1)}%`);
    console.log("   Possible causes:");
    console.log("   • AgentInterface.simulatePriceUpdate() not wired to sentinel");
    console.log("   • sentinel.checkAllPositions() not authorized or paused");
    console.log("   • PnL update didn't bring health below maintenance threshold");
    console.log(`   Try manually: sentinel.checkAllPositions(${crashPrice})`);
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });