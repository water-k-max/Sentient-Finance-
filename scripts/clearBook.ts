import { ethers } from "hardhat";
import { CONTRACT_ADDRESSES } from "./addresses";

/// @notice Clears stale LP Agent orders from the BTC-USD order book.
/// The LP Agent placed orders during deploy.ts at a hardcoded $50,000 price.
/// These stale orders cause new bids to immediately cross (self-match prevention
/// fails since LP agent and deployer are different addresses, so matches DO fire
/// but consume deposited margin instead of sitting in the book as depth).
///
/// Strategy: iterate all order IDs from 0 → nextOrderId, cancel any that are
/// still OPEN or PARTIALLY_FILLED. cancelOrder requires msg.sender == order.trader.
/// LP Agent orders have trader = lpAgent address, so we call lpAgent.cancelOrder()
/// which must exist on the LP Agent, OR we call orderBook.cancelOrder() as the
/// deployer for orders where trader == deployer.
///
/// Since LP Agent doesn't expose cancelOrder, we use the owner's ability to call
/// lpAgent directly — but the cleanest path is: deployer calls
/// orderBook.cancelOrder for deployer-owned orders, and calls
/// lpAgent.rebalance(0) to force the LP agent to cancel its own orders.

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Clearing book with:", deployer.address);

  const OrderBook           = await ethers.getContractFactory("OrderBook");
  const LiquidityProviderAgent = await ethers.getContractFactory("LiquidityProviderAgent");

  const btcBook = OrderBook.attach(CONTRACT_ADDRESSES.orderBooks["BTC-USD"]);
  const lpAgent = LiquidityProviderAgent.attach(CONTRACT_ADDRESSES.liquidityProviderAgent);

  // ── Step 1: Check current book state ───────────────────────────────────────
  const bestBid = await btcBook.bestBid();
  const bestAsk = await btcBook.bestAsk();
  const nextId  = await btcBook.nextOrderId();

  console.log(`\nBook state:`);
  console.log(`  bestBid:     $${(Number(bestBid) / 1e8).toLocaleString()}`);
  console.log(`  bestAsk:     $${(Number(bestAsk) / 1e8).toLocaleString()}`);
  console.log(`  nextOrderId: ${nextId} (orders 0 → ${Number(nextId) - 1} exist)`);

  if (bestBid === 0n && bestAsk === 0n) {
    console.log("\n✅ Book is already empty — nothing to clear");
    return;
  }

  // ── Step 2: Force LP Agent to cancel its own orders via rebalance(0) ───────
  // Calling rebalance() with price=0 will trigger the cancel-old-orders path
  // inside the LP agent (it cancels activeBid and activeAsk before placing new ones).
  // We pass price=1 to avoid divide-by-zero in spread calc, but below any bid
  // so new orders won't be placed at a sensible price — we just want the cancels.
  console.log("\n🤖 Forcing LP Agent to cancel its orders via rebalance...");
  try {
    // Set rebalanceThreshold to 0 so any price move triggers rebalance
    await (await lpAgent.setRebalanceThreshold(0)).wait();
    console.log("  → Threshold set to 0");

    // Call rebalance with price=1 — forces cancel of active bid/ask
    // LP agent will try to place new orders at price=1 which will fail (too low)
    // but the cancels happen before the new order placement
    await (await lpAgent.rebalance(1n)).wait();
    console.log("  → rebalance(1) called — LP agent cancelled its orders");
  } catch (e: any) {
    console.log(`  ⚠️  LP Agent rebalance failed: ${e?.reason || e?.message}`);
    console.log("  → Falling back to manual order cancellation...");
  }

  // ── Step 3: Cancel any remaining deployer-owned orders ────────────────────
  // Iterate all order IDs and cancel any still-open orders owned by deployer
  console.log("\n🔍 Scanning for deployer-owned open orders...");
  const ORDER_STATUS_OPEN             = 0n;
  const ORDER_STATUS_PARTIALLY_FILLED = 1n;
  let cancelled = 0;

  for (let id = 0n; id < nextId; id++) {
    try {
      const order = await btcBook.getOrder(id);
      const isOpen = order.status === ORDER_STATUS_OPEN ||
                     order.status === ORDER_STATUS_PARTIALLY_FILLED;

      if (!isOpen) continue;

      if (order.trader.toLowerCase() === deployer.address.toLowerCase()) {
        console.log(`  → Cancelling order #${id} (deployer, ${order.isBid ? "bid" : "ask"} @ $${(Number(order.price) / 1e8).toFixed(2)})`);
        await (await btcBook.cancelOrder(id)).wait();
        cancelled++;
      } else {
        console.log(`  ℹ️  Order #${id} belongs to ${order.trader} — skipping (not deployer)`);
      }
    } catch (e: any) {
      console.log(`  ⚠️  Error processing order #${id}: ${e?.message}`);
    }
  }
  console.log(`  → Cancelled ${cancelled} deployer-owned orders`);

  // ── Step 4: Verify book is now clear ───────────────────────────────────────
  const finalBid = await btcBook.bestBid();
  const finalAsk = await btcBook.bestAsk();

  console.log(`\nFinal book state:`);
  console.log(`  bestBid: $${(Number(finalBid) / 1e8).toLocaleString()}`);
  console.log(`  bestAsk: $${(Number(finalAsk) / 1e8).toLocaleString()}`);

  if (finalBid === 0n && finalAsk === 0n) {
    console.log("\n✅ Book cleared — run demoSetup.ts to reseed");
  } else {
    console.log("\n⚠️  Book still has orders. Remaining orders belong to:");
    const remainingNextId = await btcBook.nextOrderId();
    for (let id = 0n; id < remainingNextId; id++) {
      try {
        const order = await btcBook.getOrder(id);
        const isOpen = order.status === 0n || order.status === 1n;
        if (isOpen) {
          console.log(`    Order #${id}: trader=${order.trader} ${order.isBid ? "bid" : "ask"} @ $${(Number(order.price) / 1e8).toFixed(2)}`);
        }
      } catch {}
    }
    console.log("\n  These orders can only be cancelled by their respective traders.");
    console.log("  If they belong to the LP Agent, the LP Agent contract needs an owner-callable cancelAllOrders() function.");
    console.log("  Alternatively, redeploy the contracts fresh — this is the cleanest path.");
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
