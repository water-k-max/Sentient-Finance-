import { ethers } from "hardhat";
import { CONTRACT_ADDRESSES } from "./addresses";

/**
 * priceFeed.ts -- Background price pusher (the ONLY off-chain component)
 *
 * Fetches live BTC price from CoinGecko every 3s and pushes on-chain.
 * Each push triggers the full reactive cascade via AgentInterface.onEvent():
 *   updateAllPnL -> sentinel.checkAllPositions -> lpAgent.rebalance
 *
 * Also explicitly calls lpAgent.rebalance() after each push to keep the
 * order book populated with fresh two-sided depth at the current price.
 *
 * Run in a separate terminal:
 *   npx hardhat run scripts/priceFeed.ts --network somnia
 */

const INTERVAL_MS = 3_000;
const JITTER_MS = 300;

let lastKnownPrice = 0;

function applyMicroJitter(base: number): number {
  const bps = (Math.random() - 0.5) * 20; // +/- 10 bps random walk
  return Math.round(base * (1 + bps / 10000));
}

async function fetchBTCPrice(): Promise<number | null> {
  try {
    const resp = await fetch(
      "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd",
      { signal: AbortSignal.timeout(4000) }
    );
    if (!resp.ok) return null;
    const data = (await resp.json()) as { bitcoin: { usd: number } };
    return data?.bitcoin?.usd ?? null;
  } catch {
    return null;
  }
}

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Price feeder wallet: " + deployer.address);
  console.log("Interval: " + INTERVAL_MS + "ms | Press Ctrl+C to stop\n");

  const mockFeed = (await ethers.getContractFactory("MockPriceFeed"))
    .attach(CONTRACT_ADDRESSES.mockPriceFeed);
  const oracle = (await ethers.getContractFactory("OracleAdapter"))
    .attach(CONTRACT_ADDRESSES.oracleAdapter);
  const lpAgent = (await ethers.getContractFactory("LiquidityProviderAgent"))
    .attach(CONTRACT_ADDRESSES.liquidityProviderAgent);
  const enhancedLp = CONTRACT_ADDRESSES.enhancedLiquidityProviderAgent !== ethers.ZeroAddress
    ? (await ethers.getContractFactory("EnhancedLiquidityProviderAgent"))
        .attach(CONTRACT_ADDRESSES.enhancedLiquidityProviderAgent)
    : null;

  // Set LP agent rebalance threshold to 0 so it always rebalances on every push
  // regardless of how small the price move is
  try {
    await (await lpAgent.setRebalanceThreshold(0)).wait();
    console.log("Base LP agent rebalance threshold set to 0 (rebalances on every push)");
  } catch (e: any) {
    console.log("Could not set base LP threshold: " + (e?.message || ""));
  }
  if (enhancedLp) {
    try {
      await (await enhancedLp.setRebalanceThreshold(0)).wait();
      console.log("Enhanced LP agent rebalance threshold set to 0");
    } catch (e: any) {
      console.log("Could not set enhanced LP threshold: " + (e?.message || ""));
    }
  }

  // Warm-up price
  const warmup = await fetchBTCPrice();
  if (warmup) {
    lastKnownPrice = warmup;
    console.log("Initial price: $" + warmup.toLocaleString() + "\n");
  }

  let pushCount = 0;
  let failCount = 0;
  let lastPushWei = 0n;

  while (true) {
    const loopStart = Date.now();

    try {
      let btcUsd = await fetchBTCPrice();
      let source = "CoinGecko";

      if (!btcUsd) {
        if (lastKnownPrice > 0) {
          btcUsd = applyMicroJitter(lastKnownPrice);
          source = "jitter";
        } else {
          console.log("[" + new Date().toLocaleTimeString() + "] No price — skipping");
          await sleep(INTERVAL_MS);
          continue;
        }
      } else {
        lastKnownPrice = btcUsd;
      }

      const priceWei = BigInt(Math.floor(btcUsd * 1e8));

      // Skip if price unchanged (saves STT gas)
      if (priceWei === lastPushWei) {
        process.stdout.write("[" + new Date().toLocaleTimeString() + "] = $" + btcUsd.toLocaleString() + " (unchanged)\r");
        await sleep(INTERVAL_MS);
        continue;
      }

      // 1. Push price on-chain
      await (await mockFeed.updatePrice(priceWei)).wait();
      await (await oracle.updatePriceDirect(priceWei)).wait();

      // 2. Explicitly rebalance LP agents so order book always has depth
      // The reactive cascade via AgentInterface.onEvent also triggers rebalance
      // but calling it here guarantees the book is populated even if onEvent
      // isn't firing autonomously yet on testnet.
      try {
        await lpAgent.rebalance(priceWei);
      } catch { /* silent */ }
      if (enhancedLp) {
        try {
          await enhancedLp.rebalance(priceWei);
        } catch { /* silent */ }
      }

      const prevWei = lastPushWei;
      lastPushWei = priceWei;
      pushCount++;

      const dir = priceWei > prevWei ? "^" : priceWei < prevWei ? "v" : "=";
      process.stdout.write(
        "[" + new Date().toLocaleTimeString() + "] " + dir + " $" +
        btcUsd.toLocaleString() + " (" + source + ") -- push #" + pushCount + "\n"
      );

    } catch (e: any) {
      failCount++;
      const msg = (e?.reason || e?.message || String(e)).slice(0, 100);
      if (!msg.includes("nonce")) {
        console.log("[" + new Date().toLocaleTimeString() + "] WARN push failed (" + failCount + "): " + msg);
      }
    }

    const elapsed = Date.now() - loopStart;
    const jitter = Math.random() * JITTER_MS;
    await sleep(Math.max(0, INTERVAL_MS - elapsed + jitter));
  }
}

main().catch((e) => { console.error(e); process.exit(1); });