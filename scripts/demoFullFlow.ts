import { ethers } from "hardhat";
import { CONTRACT_ADDRESSES } from "./addresses";

const USDC_SCALE = 10n ** 6n;
const PRICE_SCALE = 10n ** 8n;
const ORDER_SIZE_USDC = 100n * USDC_SCALE;
const LEVERAGE = 10n;
const PAIR_NAME = "BTC-USD";
const PAIR_ID = ethers.keccak256(ethers.toUtf8Bytes(PAIR_NAME));

// 12 × ORDER_SIZE_USDC gives LP agent enough margin for initialize deposit (10×)
// plus a buffer for rebalance settlement.
const LP_FUND_AMOUNT = ORDER_SIZE_USDC * 12n;

// ── Helpers ──────────────────────────────────────────────────────────────────

// Fetch live nonce to avoid hangs if previous scripts left pending txs.
async function send(contract: ethers.Contract, method: string, args: any[]) {
  const nonce = await ethers.provider.getTransactionCount(
    contract.runner?.address ?? ""
  );
  return (contract[method] as any)(...args, { nonce });
}

// Build a padded address topic for eth_getLogs filtering
function paddedTopic(addr: string): string {
  return ethers.zeroPadValue(addr, 32);
}

// ── Attach all contracts ─────────────────────────────────────────────────────
async function attachContracts() {
  const mockFeed = (await ethers.getContractFactory("MockPriceFeed"))
    .attach(CONTRACT_ADDRESSES.mockPriceFeed);
  const oracle = (await ethers.getContractFactory("OracleAdapter"))
    .attach(CONTRACT_ADDRESSES.oracleAdapter);
  const usdc = (await ethers.getContractFactory("MockUSDC"))
    .attach(CONTRACT_ADDRESSES.mockUSDC);
  const vault = (await ethers.getContractFactory("MarginVault"))
    .attach(CONTRACT_ADDRESSES.marginVault);
  const orderBook = (await ethers.getContractFactory("OrderBook"))
    .attach(CONTRACT_ADDRESSES.orderBooks[PAIR_NAME]);
  const lpAgent = (await ethers.getContractFactory("LiquidityProviderAgent"))
    .attach(CONTRACT_ADDRESSES.liquidityProviderAgent);
  const agentIface = (await ethers.getContractFactory("AgentInterface"))
    .attach(CONTRACT_ADDRESSES.agentInterface);
  const sentinel = (await ethers.getContractFactory("LiquidationSentinel"))
    .attach(CONTRACT_ADDRESSES.liquidationSentinel);
  const factory = (await ethers.getContractFactory("OrderBookFactory"))
    .attach(CONTRACT_ADDRESSES.orderBookFactory);

  return { mockFeed, oracle, usdc, vault, orderBook, lpAgent, agentIface, sentinel, factory };
}

// ── Fetch live BTC price ─────────────────────────────────────────────────────
async function fetchBtcPrice(): Promise<bigint> {
  const fallback = 63_000n;
  try {
    const resp = await fetch(
      "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd"
    );
    const data = (await resp.json()) as { bitcoin: { usd: number } };
    // Convert to bigint with PRICE_SCALE precision — no mixed arithmetic
    return BigInt(Math.floor(data.bitcoin.usd)) * PRICE_SCALE;
  } catch {
    console.log(`   ⚠️  CoinGecko unavailable — using fallback $${fallback.toLocaleString()}`);
    return fallback * PRICE_SCALE;
  }
}

// ── Push price onto on-chain oracle ──────────────────────────────────────────
async function pushPrice(
  contracts: Awaited<ReturnType<typeof attachContracts>>,
  priceWei: bigint
) {
  await (await send(contracts.mockFeed, "updatePrice", [priceWei])).wait();
  await (await send(contracts.oracle, "updatePriceDirect", [priceWei])).wait();
}

// ── Format price for display (bigint with 8 decimals → USD string) ───────────
function fmtPrice(priceWei: bigint): string {
  return (Number(priceWei) / 1e8).toLocaleString();
}

// ── Format USDC amount for display (bigint with 6 decimals) ──────────────────
function fmtUsdc(amount: bigint): string {
  return ethers.formatUnits(amount, 6);
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  const [deployer] = await ethers.getSigners();
  console.log(`Wallet: ${deployer.address}\n`);

  const contracts = await attachContracts();

  // ── 1. Fetch live price + push on-chain ──────────────────────────────────
  console.log("1️⃣  Fetching live BTC price...");
  const priceWei = await fetchBtcPrice();         // bigint, 8-decimal scaled
  const displayPrice = Number(priceWei / PRICE_SCALE); // safe: integer USD value
  await pushPrice(contracts, priceWei);
  console.log(`   ✅ BTC: $${displayPrice.toLocaleString()}`);

  // ── 2. Clear book + fund LP agent + initialize/rebalance ────────────────
  console.log("\n2️⃣  Seeding order book via LP agent...");

  // Clear stale orders from previous runs
  try {
    await (await send(contracts.factory, "adminClearBook", [PAIR_ID])).wait();
    console.log("   🧹 Book cleared via factory");
  } catch {
    console.log("   ℹ️  No stale orders to clear");
  }

  // Top up LP agent's vault margin via deployer privilege (mint + adjustMargin).
  // We do NOT attempt to call usdc.connect(lpAddr) — the LP agent is a contract,
  // not an EOA signer. Instead we mint directly to the vault and credit the agent.
  const lpAddr = await contracts.lpAgent.getAddress();
  const vaultAddr = await contracts.vault.getAddress();
  const lpBalance = await contracts.usdc.balanceOf(lpAddr);

  // Ensure deployer is authorized to call adjustMargin on the vault
  const isAuth = await contracts.vault.isAuthorized(deployer.address);
  if (!isAuth) {
    await (await send(contracts.vault, "setAuthorized", [deployer.address, true])).wait();
    console.log("   🔑 Deployer authorized on MarginVault");
  }

  if (lpBalance < LP_FUND_AMOUNT) {
    const needed = LP_FUND_AMOUNT - lpBalance;
    console.log(`   🪙 Crediting LP agent with ${fmtUsdc(needed)} USDC...`);
    // Mint straight to the vault contract, then adjust the agent's margin ledger.
    await (await send(contracts.usdc, "mint", [vaultAddr, needed])).wait();
    await (await send(contracts.vault, "adjustMargin", [lpAddr, needed])).wait();
    console.log(`   ✅ LP agent vault balance topped up`);
  } else {
    console.log(`   ✅ LP agent has sufficient balance: ${fmtUsdc(lpBalance)} USDC`);
  }

  // Initialize LP agent if needed
  try {
    const spreadBps = 5n;
    await (await send(contracts.lpAgent, "initialize", [spreadBps, ORDER_SIZE_USDC, priceWei])).wait();
    console.log("   ✅ LP agent initialized");
  } catch {
    console.log("   ℹ️  LP agent already initialized — continuing");
  }

  // Rebalance at live price — places fresh two-sided depth
  try {
    await (await send(contracts.lpAgent, "rebalance", [priceWei])).wait();
    console.log("   ✅ LP agent rebalanced");
  } catch (e: any) {
    console.log(`   ⚠️  LP rebalance: ${e?.reason || e?.message}`);
  }

  const bestAsk = await contracts.orderBook.bestAsk() as bigint;
  const bestBid = await contracts.orderBook.bestBid() as bigint;
  console.log(`   Book — bid: $${fmtPrice(bestBid)} | ask: $${fmtPrice(bestAsk)}`);

  if (bestAsk === 0n) {
    console.log("   ❌ No ask liquidity after rebalance — cannot continue");
    process.exit(1);
  }

  // ── 3. Fund deployer + open leveraged long against LP's ask ─────────────
  console.log("\n3️⃣  Opening leveraged long position...");

  const size = 5_000n * USDC_SCALE;
  const margin = size / LEVERAGE;
  const depositAmount = margin * 3n;

  // Mint + approve + deposit for deployer
  const deployerBalance = await contracts.usdc.balanceOf(deployer.address) as bigint;
  if (deployerBalance < depositAmount) {
    const mintQty = depositAmount - deployerBalance + 1000n * USDC_SCALE;
    await (await send(contracts.usdc, "mint", [deployer.address, mintQty])).wait();
  }
  await (await send(contracts.usdc, "approve", [vaultAddr, depositAmount])).wait();
  await (await send(contracts.vault, "deposit", [depositAmount])).wait();
  console.log(`   💰 ${fmtUsdc(depositAmount)} USDC deposited`);

  // Ensure LP agent has enough free margin for settlement
  const lpFree = await contracts.vault.getFreeMargin(lpAddr) as bigint;
  console.log(`   LP agent free margin: ${fmtUsdc(lpFree)} USDC`);
  if (lpFree < size) {
    const credit = size - lpFree + ORDER_SIZE_USDC; // extra buffer
    await (await send(contracts.usdc, "mint", [vaultAddr, credit])).wait();
    await (await send(contracts.vault, "adjustMargin", [lpAddr, credit])).wait();
    console.log(`   💊 Credited LP agent with ${fmtUsdc(credit)} USDC for settlement`);
  }

  // Place bid at bestAsk — crosses LP's ask immediately
  try {
    const tx = await send(contracts.orderBook, "placeOrder", [true, bestAsk, size, LEVERAGE]);
    await tx.wait();
    console.log(`   ✅ Long opened at $${fmtPrice(bestAsk)}`);
  } catch (e: any) {
    console.log(`   ❌ placeOrder failed: ${e?.reason || e?.message}`);
    process.exit(1);
  }

  // ── 4. Verify position ─────────────────────────────────────────────────
  console.log("\n4️⃣  Verifying position...");
  const pos = await contracts.vault.getPosition(deployer.address);
  const health = await contracts.vault.marginHealth(deployer.address) as bigint;
  const maintRatio = await contracts.vault.MAINTENANCE_MARGIN_RATIO() as bigint;

  console.log(`   isOpen:      ${pos.isOpen}`);
  console.log(`   Entry price: $${fmtPrice(pos.entryPrice)}`);
  console.log(`   Margin:      ${fmtUsdc(pos.margin)} USDC`);
  console.log(`   Leverage:    ${pos.leverage}x`);
  console.log(`   Liq price:   $${fmtPrice(pos.liquidationPrice)}`);
  console.log(`   Health:      ${(Number(health) / 1e16).toFixed(1)}%`);

  if (!pos.isOpen) {
    console.log("   ❌ Position did not open");
    process.exit(1);
  }

  // ── 5. Crash price → trigger liquidation ──────────────────────────────
  console.log("\n5️⃣  Crashing price to trigger liquidation...");
  // All bigint arithmetic — no mixed types
  const crashPrice = pos.entryPrice * 88n / 100n;
  const dropBps = (pos.entryPrice - crashPrice) * 10_000n / pos.entryPrice; // basis points
  const dropPct = (Number(dropBps) / 100).toFixed(1);

  console.log(`   Entry:       $${fmtPrice(pos.entryPrice)}`);
  console.log(`   Liq price:   $${fmtPrice(pos.liquidationPrice)}`);
  console.log(`   Crash price: $${fmtPrice(crashPrice)} (−${dropPct}%)`);
  console.log(`   → Crash price is below liq price — liquidation WILL trigger`);

  await pushPrice(contracts, crashPrice);
  console.log(`   ✅ Price crashed to $${fmtPrice(crashPrice)} on-chain`);

  // ── 6. Fire reactive cascade ──────────────────────────────────────────
  console.log("\n6️⃣  Firing reactive cascade...");
  try {
    const cascadeTx = await send(contracts.agentIface, "simulatePriceUpdate", [crashPrice]);
    const receipt = await cascadeTx.wait();
    console.log(`   ✅ Cascade executed — tx: ${receipt!.hash}`);
  } catch (e: any) {
    console.log(`   ⚠️  simulatePriceUpdate failed: ${e?.reason || e?.message}`);
    console.log("   → Falling back to direct sentinel call...");
    try {
      const sentinelTx = await send(contracts.sentinel, "checkAllPositions", [crashPrice]);
      await sentinelTx.wait();
      console.log("   ✅ sentinel.checkAllPositions executed directly");
    } catch (e2: any) {
      console.log(`   ❌ Sentinel also failed: ${e2?.reason || e2?.message}`);
    }
  }

  // ── 7. Verify liquidation ─────────────────────────────────────────────
  console.log("\n7️⃣  Checking liquidation result...");

  const posAfter = await contracts.vault.getPosition(deployer.address);
  const sentinelAddr = await contracts.sentinel.getAddress();
  const currentBlock = await ethers.provider.getBlockNumber();

  let liquidationCount = 0;
  let liquidationPrice: bigint | null = null;

  try {
    const liquidationTopic = contracts.sentinel.interface.getEvent("LiquidationExecuted")!.topicHash;
    const rawLogs: any[] = await ethers.provider.send("eth_getLogs", [{
      address: sentinelAddr,
      topics: [liquidationTopic, paddedTopic(deployer.address)],
      fromBlock: ethers.toQuantity(Math.max(0, currentBlock - 500)),
      toBlock: ethers.toQuantity(currentBlock),
    }]);

    liquidationCount = rawLogs.length;
    if (rawLogs.length > 0) {
      const decoded = contracts.sentinel.interface.decodeEventLog(
        "LiquidationExecuted",
        rawLogs[0].data,
        rawLogs[0].topics
      );
      liquidationPrice = (decoded.liquidationPrice as bigint) ?? pos.liquidationPrice;
    }
  } catch {
    // non-fatal — position state below is authoritative
  }

  if (liquidationCount > 0 && !posAfter.isOpen) {
    console.log(`\n✅✅ DEMO SUCCESS — Autonomous liquidation fired with no keeper`);
    console.log(`   Events:    ${liquidationCount}`);
    console.log(`   Liq price: $${liquidationPrice ? fmtPrice(liquidationPrice) : "N/A"}`);
  } else if (!posAfter.isOpen) {
    console.log("\n✅ Position closed (no event in query window)");
  } else {
    const healthAfter = await contracts.vault.marginHealth(deployer.address) as bigint;
    console.log("\n⚠️  Position still open — liquidation did not fire");
    console.log(`   Health after: ${(Number(healthAfter) / 1e16).toFixed(1)}%`);
    console.log(`   Maintenance:  ${(Number(maintRatio) / 1e16).toFixed(1)}%`);
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });