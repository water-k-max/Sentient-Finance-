import { ethers } from "hardhat";
import { CONTRACT_ADDRESSES } from "./addresses";

// ── Scaling constants ────────────────────────────────────────────────────────
const PRICE_SCALE = 10n ** 8n;   // prices: 8 decimals on-chain
const USDC_SCALE = 10n ** 6n;   // USDC: 6 decimals

// ORDER_SIZE_USDC: notional value of each seed order in USDC terms (6 dec).
// Using 100 USDC notional per order at 10x leverage = 10 USDC margin each.
// This keeps margin requirements small and avoids the SIZE_SCALE unit mismatch
// where 1e18 * price overflows the vault's USDC-denominated collateral balance.
const ORDER_SIZE_USDC = 100n * USDC_SCALE;   // 100 USDC notional (6 dec)
const LEVERAGE = 10n;                  // 10x → 10 USDC margin per order

// ── Demo: only seed BTC-USD ──────────────────────────────────────────────────
// ETH-USD and SOL-USD are skipped — demo focuses on BTC-USD only.
// Seeding all three wastes STT gas and produces confusing reverts in output.
const DEMO_PAIRS = ["BTC-USD"];

// ── Fallback prices ──────────────────────────────────────────────────────────
const FALLBACK_PRICES: Record<string, number> = {
  "BTC-USD": 65000,
  "ETH-USD": 3100,
  "SOL-USD": 145,
};

// ── CoinGecko IDs ────────────────────────────────────────────────────────────
const COINGECKO_IDS: Record<string, string> = {
  "BTC-USD": "bitcoin",
  "ETH-USD": "ethereum",
  "SOL-USD": "solana",
};

// ── Seeding config per pair ──────────────────────────────────────────────────
const PAIR_SEED_CONFIG: Record<string, {
  spreadBps: number;
  levels: number;
  jitterBps: number;
  tickSize: number;
}> = {
  "BTC-USD": { spreadBps: 5, levels: 10, jitterBps: 3, tickSize: 1 },
  "ETH-USD": { spreadBps: 8, levels: 10, jitterBps: 5, tickSize: 0.1 },
  "SOL-USD": { spreadBps: 10, levels: 10, jitterBps: 8, tickSize: 0.01 },
};

// ── Deterministic jitter ─────────────────────────────────────────────────────
function seededJitter(mid: number, bps: number, salt: number): number {
  const raw = Math.sin(mid * 9301 + salt * 49297 + 233280) * 0.5 + 0.5;
  return raw * (mid * bps) / 10000;
}

// ── Build price ladder ───────────────────────────────────────────────────────
function buildOrderLadder(
  mid: number,
  cfg: typeof PAIR_SEED_CONFIG[string]
): { bids: bigint[]; asks: bigint[] } {
  const bids: bigint[] = [];
  const asks: bigint[] = [];

  for (let i = 1; i <= cfg.levels; i++) {
    const stepBps = cfg.spreadBps * i;
    const jitter = seededJitter(mid, cfg.jitterBps, i);

    const bidRaw = mid * (1 - stepBps / 10000) - jitter;
    const askRaw = mid * (1 + stepBps / 10000) + jitter;
    const bidSnapped = Math.round(bidRaw / cfg.tickSize) * cfg.tickSize;
    const askSnapped = Math.round(askRaw / cfg.tickSize) * cfg.tickSize;

    bids.push(BigInt(Math.floor(bidSnapped * 1e8)));
    asks.push(BigInt(Math.floor(askSnapped * 1e8)));
  }

  return { bids, asks };
}

// ── Live price fetch ─────────────────────────────────────────────────────────
async function fetchLivePrices(): Promise<Record<string, number>> {
  const ids = Object.values(COINGECKO_IDS).join(",");
  const resp = await fetch(
    `https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd`
  );
  const data = (await resp.json()) as Record<string, { usd: number }>;
  const prices: Record<string, number> = {};
  for (const [pair, geckoId] of Object.entries(COINGECKO_IDS)) {
    prices[pair] = data[geckoId]?.usd ?? FALLBACK_PRICES[pair];
  }
  return prices;
}

// ── Timeout helper ────────────────────────────────────────────────────────────
const AGENT_TIMEOUT_MS = 60_000;
async function withTimeout<T>(label: string, promise: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`[${label}] Timed out after ${AGENT_TIMEOUT_MS / 1000}s`)),
      AGENT_TIMEOUT_MS
    );
  });
  try {
    const result = await Promise.race([promise, timeout]);
    clearTimeout(timer!);
    return result;
  } catch (e) {
    clearTimeout(timer!);
    throw e;
  }
}

// ── Verify OrderBook is authorized on MarginVault ────────────────────────────
// Catches the case where addresses.ts is out of sync with deployed-addresses.json.
// If the book isn't authorized, every placeOrder will silently revert at lockMargin.
async function verifyAuthorization(
  vault: any,
  obAddr: string,
  pairName: string
): Promise<boolean> {
  try {
    const isAuth = await vault.isAuthorized(obAddr);
    if (!isAuth) {
      console.log(
        `   ❌ ${pairName} OrderBook (${obAddr}) is NOT authorized on MarginVault.\n` +
        `      This means addresses.ts is out of sync with deployed-addresses.json.\n` +
        `      Fix: copy deployed-addresses.json values into scripts/addresses.ts then re-run.`
      );
      return false;
    }
    return true;
  } catch (e: any) {
    console.log(`   ⚠️  Auth check failed for ${pairName}: ${e?.message}`);
    return false;
  }
}

// ─────────────────────────────────────────────────────────────────────────────

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Seeder:", deployer.address);

  // ── 1. Fetch live prices ─────────────────────────────────────────────────────
  console.log("\n💰 Fetching live prices...");
  let livePrices: Record<string, number> = { ...FALLBACK_PRICES };

  try {
    livePrices = await fetchLivePrices();
    for (const [pair, price] of Object.entries(livePrices)) {
      console.log(`   ${pair}: $${price.toLocaleString()}`);
    }
  } catch (e: any) {
    console.log("   ⚠️  CoinGecko fetch failed — using fallback prices");
    for (const [pair, price] of Object.entries(livePrices)) {
      console.log(`   ${pair}: $${price.toLocaleString()} (fallback)`);
    }
  }

  // ── 2. Seed order books FIRST ──────────────────────────────────────────────────
  // Seed before pushing price so orders are placed at a clean starting price level.
  // Then the price push below triggers reactive rebalance + natural matching.
  console.log("\n📊 Seeding order books (BTC-USD only)...");

  const MockUSDC = await ethers.getContractFactory("MockUSDC");
  const OrderBook = await ethers.getContractFactory("OrderBook");
  const MarginVault = await ethers.getContractFactory("MarginVault");

  const usdc = MockUSDC.attach(CONTRACT_ADDRESSES.mockUSDC);
  const vault = MarginVault.attach(CONTRACT_ADDRESSES.marginVault);

  for (const [pairName, obAddr] of Object.entries(CONTRACT_ADDRESSES.orderBooks)) {

    // ── Skip non-demo pairs ────────────────────────────────────────────────────
    if (!DEMO_PAIRS.includes(pairName)) {
      console.log(`   ⏭️  Skipping ${pairName} (demo: BTC-USD only)`);
      continue;
    }

    // ── Authorization check ────────────────────────────────────────────────────
    // If this fails, addresses.ts is out of sync — stop immediately with clear message.
    const isAuthorized = await verifyAuthorization(vault, obAddr, pairName);
    if (!isAuthorized) {
      console.log(`\n   ⛔ Aborting seed — fix addresses.ts first, then re-run.`);
      process.exit(1);
    }

    const livePrice = livePrices[pairName] ?? FALLBACK_PRICES[pairName];
    const cfg = PAIR_SEED_CONFIG[pairName];
    const orderBook = OrderBook.attach(obAddr);

    // ── Stale check + clear ────────────────────────────────────────────────────
    // If any orders exist, check if price is fresh (within 5% of live).
    // Fresh + both sides present → skip (already seeded).
    // Stale or one-sided → clear the book via the factory (which is the owner),
    // then fall through to re-seed.
    const bestBid = await orderBook.bestBid();
    const bestAsk = await orderBook.bestAsk();

    if (bestBid > 0n || bestAsk > 0n) {
      const existingMid = Number(bestBid) / 1e8;
      const priceDiff = Math.abs(existingMid - livePrice);
      const stale = priceDiff > livePrice * 0.05;

      if (!stale && bestBid > 0n && bestAsk > 0n) {
        console.log(`   ✅ ${pairName}: already seeded at fresh price (bid: $${existingMid.toLocaleString()}) — skipping`);
        continue;
      }

      // Stale or partially seeded — clear heaps via factory (which is OrderBook owner)
      console.log(`   🧹 ${pairName}: clearing stale orders (existing bid: $${existingMid.toLocaleString()}, live: $${livePrice.toLocaleString()})...`);
      try {
        const OrderBookFactory = await ethers.getContractFactory("OrderBookFactory");
        const factory = OrderBookFactory.attach(CONTRACT_ADDRESSES.orderBookFactory);
        const pairId = ethers.keccak256(ethers.toUtf8Bytes(pairName));
        await (await factory.connect(deployer).adminClearBook(pairId)).wait();
        console.log(`      ✅ Book cleared via factory`);
      } catch (e: any) {
        console.log(`      ⚠️  adminClearBook failed: ${e?.reason || e?.message}`);
        console.log(`         Proceeding anyway — new bids may cross stale asks`);
      }
    }

    console.log(`\n   📐 ${pairName} — live mid: $${livePrice.toLocaleString()}`);

    // ── Build price ladder ─────────────────────────────────────────────────────
    const { bids, asks } = buildOrderLadder(livePrice, cfg);
    console.log(
      `      Ladder: ${cfg.levels} bids [$${(Number(bids[0]) / 1e8).toFixed(2)}` +
      ` → $${(Number(bids[cfg.levels - 1]) / 1e8).toFixed(2)}]` +
      ` | ${cfg.levels} asks [$${(Number(asks[0]) / 1e8).toFixed(2)}` +
      ` → $${(Number(asks[cfg.levels - 1]) / 1e8).toFixed(2)}]`
    );

    // ── Margin calculation (fixed) ─────────────────────────────────────────────
    // ORDER_SIZE_USDC = 100 USDC notional (6 dec)
    // margin per order = notional / leverage = 100 USDC / 10 = 10 USDC
    // total = 10 USDC × (levels × 2 sides) = 10 × 20 = 200 USDC for 10 levels
    const marginPerOrderUsdc = ORDER_SIZE_USDC / LEVERAGE;
    const totalMarginUsdc = marginPerOrderUsdc * BigInt(cfg.levels * 2);

    console.log(
      `      Margin: ${ethers.formatUnits(totalMarginUsdc, 6)} USDC` +
      ` (${cfg.levels * 2} orders × ${ethers.formatUnits(marginPerOrderUsdc, 6)} USDC each)`
    );

    // ── Mint USDC if deployer balance is insufficient ──────────────────────────
    const deployerBalance = await usdc.balanceOf(deployer.address);
    if (deployerBalance < totalMarginUsdc) {
      const mintAmount = totalMarginUsdc - deployerBalance + 1000n * USDC_SCALE; // +1000 buffer
      console.log(`      🪙 Minting ${ethers.formatUnits(mintAmount, 6)} USDC to deployer...`);
      await (await usdc.mint(deployer.address, mintAmount)).wait();
    }

    // ── Approve + deposit ──────────────────────────────────────────────────────
    try {
      console.log(`      💳 Approving ${ethers.formatUnits(totalMarginUsdc, 6)} USDC...`);
      await (await usdc.connect(deployer).approve(CONTRACT_ADDRESSES.marginVault, totalMarginUsdc)).wait();

      console.log(`      💵 Depositing into MarginVault...`);
      await (await vault.connect(deployer).deposit(totalMarginUsdc)).wait();
      console.log(`      ✅ Deposited ${ethers.formatUnits(totalMarginUsdc, 6)} USDC`);
    } catch (e: any) {
      console.log(`      ⚠️  Deposit failed: ${e?.reason || e?.message}`);
      console.log(`         Attempting orders anyway (vault may already be funded)...`);
    }

    // ── Place bid orders ───────────────────────────────────────────────────────
    console.log(`      📥 Placing ${cfg.levels} bid orders...`);
    let bidSuccess = 0;
    for (let i = 0; i < bids.length; i++) {
      try {
        await (await orderBook.connect(deployer).placeOrder(
          true, bids[i], ORDER_SIZE_USDC, LEVERAGE
        )).wait();
        bidSuccess++;
      } catch (e: any) {
        console.log(`         ⚠️  Bid[${i}] @ $${(Number(bids[i]) / 1e8).toFixed(2)} failed: ${e?.reason || e?.message}`);
      }
    }
    console.log(`         → ${bidSuccess}/${cfg.levels} bids placed`);

    // ── Place ask orders ───────────────────────────────────────────────────────
    console.log(`      📤 Placing ${cfg.levels} ask orders...`);
    let askSuccess = 0;
    for (let i = 0; i < asks.length; i++) {
      try {
        await (await orderBook.connect(deployer).placeOrder(
          false, asks[i], ORDER_SIZE_USDC, LEVERAGE
        )).wait();
        askSuccess++;
      } catch (e: any) {
        console.log(`         ⚠️  Ask[${i}] @ $${(Number(asks[i]) / 1e8).toFixed(2)} failed: ${e?.reason || e?.message}`);
      }
    }
    console.log(`         → ${askSuccess}/${cfg.levels} asks placed`);

    // ── Verify final state ─────────────────────────────────────────────────────
    const finalBid = await orderBook.bestBid();
    const finalAsk = await orderBook.bestAsk();

    if (finalBid === 0n || finalAsk === 0n) {
      console.log(
        `   ❌ ${pairName}: seeding failed — bestBid=$${(Number(finalBid) / 1e8).toLocaleString()}` +
        ` bestAsk=$${(Number(finalAsk) / 1e8).toLocaleString()}\n` +
        `      All orders reverted. Check OrderBook.placeOrder() requires and MarginVault authorization.`
      );
    } else {
      const spread = ((Number(finalAsk) - Number(finalBid)) / 1e8).toFixed(2);
      console.log(
        `   ✅ ${pairName} seeded — best bid: $${(Number(finalBid) / 1e8).toLocaleString()}` +
        ` | best ask: $${(Number(finalAsk) / 1e8).toLocaleString()}` +
        ` | spread: $${spread}`
      );
    }
  }

  // ── 3. Push BTC price on-chain ───────────────────────────────────────────────
  // After seeding, push the live price to trigger reactive cascade:
  // PriceUpdated → AgentInterface → LP agent rebalance → Sentinel checks → matching
  console.log("\n📡 Pushing BTC price on-chain...");
  try {
    const btcWei = BigInt(Math.floor(livePrices["BTC-USD"] * 1e8));

    const MockPriceFeed = await ethers.getContractFactory("MockPriceFeed");
    const feed = MockPriceFeed.attach(CONTRACT_ADDRESSES.mockPriceFeed);
    await (await feed.updatePrice(btcWei)).wait();

    const OracleAdapter = await ethers.getContractFactory("OracleAdapter");
    const oracle = OracleAdapter.attach(CONTRACT_ADDRESSES.oracleAdapter);
    await (await oracle.updatePriceDirect(btcWei)).wait();

    console.log(`   ✅ PriceUpdate emitted ($${livePrices["BTC-USD"].toLocaleString()}) → reactive cascade fires`);
  } catch (e: any) {
    console.log("   ⚠️  Oracle push failed:", e?.reason || e?.message);
  }

  // ── 4. Somnia agents ─────────────────────────────────────────────────────────
  console.log("\n🤖 Calling Somnia agents (Threshold 3/4)...");

  try {
    const SentimentOracle = await ethers.getContractFactory("SentimentOracle");
    const sentimentOracle = SentimentOracle.attach(CONTRACT_ADDRESSES.sentimentOracle);

    console.log("   🔍 Querying deposit requirements from contract...");
    const depositResult = await sentimentOracle.getDepositRequired();
    const jsonApi = depositResult[0] as bigint;
    const llmInference = depositResult[1] as bigint;
    const llmParseWebsite = depositResult[2] as bigint;

    if (!jsonApi || !llmInference || !llmParseWebsite) {
      throw new Error(
        `getDepositRequired() returned zero — ` +
        `jsonApi=${jsonApi}, llmInference=${llmInference}, llmParseWebsite=${llmParseWebsite}`
      );
    }
    console.log(
      `   💰 Deposits — JSON API: ${ethers.formatEther(jsonApi)} STT` +
      ` | LLM Inference: ${ethers.formatEther(llmInference)} STT` +
      ` | LLM Parse Website: ${ethers.formatEther(llmParseWebsite)} STT`
    );

    let headline = "";
    try {
      const newsResp = await fetch(
        "https://cryptopanic.com/api/free/v1/posts/?auth_token=pub_free&currencies=BTC&kind=news"
      );
      const newsData = (await newsResp.json()) as { results: { title: string }[] };
      headline = newsData.results?.[0]?.title ?? "";
      if (headline) console.log(`   📰 Live headline: "${headline}"`);
    } catch { /* fall through */ }

    if (!headline) {
      const btc = livePrices["BTC-USD"];
      const dir = btc > FALLBACK_PRICES["BTC-USD"] ? "surges above" : "dips below";
      headline = `Bitcoin ${dir} $${btc.toLocaleString()} amid rising institutional interest`;
      console.log(`   📰 Derived headline: "${headline}"`);
    }

    const btcBase = livePrices["BTC-USD"];
    const volatilityPrices = Array.from({ length: 8 }, (_, i) =>
      Math.floor(btcBase * (1 + (Math.sin(i * 137.5) * 0.5 + 0.5 - 0.5) * 0.004))
    ).join(",");
    console.log(`   📈 Volatility input: ${volatilityPrices}`);

    const baseNonce = await deployer.getNonce();
    console.log(`   🔢 Base nonce: ${baseNonce}`);

    const agentCalls = [
      {
        label: "JSON API Agent        (requestApiPrice)",
        call: async () => {
          console.log("   📡 [1/4] Submitting requestApiPrice...");
          const tx = await withTimeout("requestApiPrice submit",
            sentimentOracle.requestApiPrice({ value: jsonApi, nonce: baseNonce }));
          console.log("   ⏳ [1/4] Waiting for receipt...", tx.hash);
          const r = await withTimeout("requestApiPrice receipt", tx.wait());
          console.log("   ✅ [1/4] JSON API Agent confirmed — tx:", r.hash);
        },
      },
      {
        label: "LLM Parse Website     (requestWebsitePrice)",
        call: async () => {
          console.log("   📡 [2/4] Submitting requestWebsitePrice...");
          const tx = await withTimeout("requestWebsitePrice submit",
            sentimentOracle.requestWebsitePrice({ value: llmParseWebsite, nonce: baseNonce + 1 }));
          console.log("   ⏳ [2/4] Waiting for receipt...", tx.hash);
          const r = await withTimeout("requestWebsitePrice receipt", tx.wait());
          console.log("   ✅ [2/4] Website Price Agent confirmed — tx:", r.hash);
        },
      },
      {
        label: "LLM Sentiment Agent   (analyzeSentiment)",
        call: async () => {
          console.log("   📡 [3/4] Submitting analyzeSentiment...");
          const tx = await withTimeout("analyzeSentiment submit",
            sentimentOracle.analyzeSentiment(headline, { value: llmInference, nonce: baseNonce + 2 }));
          console.log("   ⏳ [3/4] Waiting for receipt...", tx.hash);
          const r = await withTimeout("analyzeSentiment receipt", tx.wait());
          console.log("   ✅ [3/4] Sentiment Agent confirmed — tx:", r.hash);
        },
      },
      {
        label: "LLM Volatility Agent  (computeVolatilityScore)",
        call: async () => {
          console.log("   📡 [4/4] Submitting computeVolatilityScore...");
          const tx = await withTimeout("computeVolatilityScore submit",
            sentimentOracle.computeVolatilityScore(volatilityPrices, { value: llmInference, nonce: baseNonce + 3 }));
          console.log("   ⏳ [4/4] Waiting for receipt...", tx.hash);
          const r = await withTimeout("computeVolatilityScore receipt", tx.wait());
          console.log("   ✅ [4/4] Volatility Agent confirmed — tx:", r.hash);
        },
      },
    ];

    const results = await Promise.allSettled(agentCalls.map((a) => a.call()));

    results.forEach((r, i) => {
      if (r.status === "rejected") {
        const reason = (r as PromiseRejectedResult).reason;
        console.log(`   ❌ ${agentCalls[i].label}`);
        console.log(`      Reason: ${reason?.message ?? String(reason)}`);
      }
    });

    const succeeded = results.filter((r) => r.status === "fulfilled").length;

    if (succeeded >= 3) {
      console.log(`\n   ✅ Threshold met (${succeeded}/4 agents confirmed) — proceeding`);
      console.log("   ⏳ AgentDashboard + divergence check fires in ~30-120s");
    } else {
      console.log(`   ⚠️  Agent threshold NOT met (${succeeded}/4). Booking seeding is higher priority — continuing.`);
    }
  } catch (e: any) {
    console.log("   ⚠️  Agent section failed (non-fatal):", e?.reason || e?.message);
    console.log("   Continuing with book seeding...");
  }

  console.log("\n✅ Done — start the frontend with:  npm run dev --prefix frontend");
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });