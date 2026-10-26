import { ethers } from "hardhat";

async function main() {
  console.log("🚀 Deploying Sentient Finance contracts (3-agent integration)...\n");

  const [deployer] = await ethers.getSigners();
  console.log(`Deploying with: ${deployer.address}\n`);

  const PRICE_SCALE = 10n ** 8n;
  const assetId = ethers.keccak256(ethers.toUtf8Bytes("BTC-USD"));

  // Fetch live BTC price from CoinGecko for LP agent initialization
  console.log("💹 Fetching live BTC price...");
  let initialPrice = 50_000n * PRICE_SCALE;
  try {
    const resp = await fetch("https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd");
    const data = (await resp.json()) as { bitcoin: { usd: number } };
    initialPrice = BigInt(Math.floor(data.bitcoin.usd * 1e8));
    console.log(`   BTC: $${data.bitcoin.usd.toLocaleString()}`);
  } catch (e) {
    console.log(`   ⚠️  CoinGecko fetch failed — using fallback $50,000`);
  }

  // ── 1. MockPriceFeed ────────────────────────────────────────────────────────
  const MockPriceFeed = await ethers.getContractFactory("MockPriceFeed");
  const mockPriceFeed = await MockPriceFeed.deploy(initialPrice);
  await mockPriceFeed.waitForDeployment();
  console.log(`✅ MockPriceFeed:       ${await mockPriceFeed.getAddress()}`);

  // ── 2. MockUSDC ─────────────────────────────────────────────────────────────
  // Must be deployed BEFORE MarginVault — vault constructor requires the token address.
  const MockUSDC = await ethers.getContractFactory("MockUSDC");
  const mockUSDC = await MockUSDC.deploy();
  await mockUSDC.waitForDeployment();
  const mockUSDCAddr = await mockUSDC.getAddress();
  console.log(`✅ MockUSDC:            ${mockUSDCAddr}`);

  // ── 3. OracleAdapter ────────────────────────────────────────────────────────
  const OracleAdapter = await ethers.getContractFactory("OracleAdapter");
  const oracleAdapter = await OracleAdapter.deploy(
    await mockPriceFeed.getAddress(),
    assetId
  );
  await oracleAdapter.waitForDeployment();
  console.log(`✅ OracleAdapter:       ${await oracleAdapter.getAddress()}`);

  // ── 4. MarginVault ──────────────────────────────────────────────────────────
  // Constructor now requires the ERC-20 collateral token address (MockUSDC).
  const MarginVault = await ethers.getContractFactory("MarginVault");
  const marginVault = await MarginVault.deploy(mockUSDCAddr);
  await marginVault.waitForDeployment();
  const marginVaultAddr = await marginVault.getAddress();
  console.log(`✅ MarginVault:         ${marginVaultAddr}`);

  // ── 5. PerpEngine ───────────────────────────────────────────────────────────
  const PerpEngine = await ethers.getContractFactory("PerpEngine");
  const perpEngine = await PerpEngine.deploy(marginVaultAddr);
  await perpEngine.waitForDeployment();
  console.log(`✅ PerpEngine:          ${await perpEngine.getAddress()}`);

  // ── 6. OrderBookFactory + per-pair OrderBooks ───────────────────────────────
  const OrderBookFactory = await ethers.getContractFactory("OrderBookFactory");
  const orderBookFactory = await OrderBookFactory.deploy(
    marginVaultAddr,
    await perpEngine.getAddress()
  );
  await orderBookFactory.waitForDeployment();
  console.log(`✅ OrderBookFactory:    ${await orderBookFactory.getAddress()}`);

  const pairs = [
    { name: "BTC-USD", price: 50_000n * PRICE_SCALE },
    { name: "ETH-USD", price: 3_000n * PRICE_SCALE },
    { name: "SOL-USD", price: 150n * PRICE_SCALE },
  ];
  const pairAddresses: Record<string, string> = {};

  for (const pair of pairs) {
    const pairId = ethers.keccak256(ethers.toUtf8Bytes(pair.name));
    const tx = await orderBookFactory.createOrderBook(pairId);
    await tx.wait();
    const obAddr = await orderBookFactory.pairOrderBooks(pairId);
    pairAddresses[pair.name] = obAddr;
    console.log(`  ✅ ${pair.name} OrderBook: ${obAddr}`);
  }

  for (const pair of pairs) {
    const pairId = ethers.keccak256(ethers.toUtf8Bytes(pair.name));
    await perpEngine.registerPair(pairId, pairAddresses[pair.name]);
    // F-02: authorize each order book on PerpEngine so matched fills can be
    // recorded (recordFill is no longer permissionless).
    await perpEngine.setAuthorized(pairAddresses[pair.name], true);
    console.log(`  → Registered + authorized ${pair.name} in PerpEngine`);
  }

  // ── 7. LiquidationSentinel ──────────────────────────────────────────────────
  const LiquidationSentinel = await ethers.getContractFactory("LiquidationSentinel");
  const sentinel = await LiquidationSentinel.deploy(marginVaultAddr);
  await sentinel.waitForDeployment();
  console.log(`✅ LiquidationSentinel: ${await sentinel.getAddress()}`);

  // ── 8. SentimentOracle (optional — requires SOMNIA_AGENTS_PLATFORM_ADDRESS) ─
  const SOMNIA_AGENTS_PLATFORM = process.env.SOMNIA_AGENTS_PLATFORM_ADDRESS;
  let sentimentOracle: any = null;
  let enhancedLpAgent: any = null;
  let agentOracle: any = null;

  if (SOMNIA_AGENTS_PLATFORM) {
    const SentimentOracle = await ethers.getContractFactory("SentimentOracle");
    sentimentOracle = await SentimentOracle.deploy(SOMNIA_AGENTS_PLATFORM);
    await sentimentOracle.waitForDeployment();
    console.log(`✅ SentimentOracle:     ${await sentimentOracle.getAddress()}`);
    console.log("  → Integrates JSON API Agent + LLM Inference + LLM Parse Website");
  } else {
    console.log("⏭️  SentimentOracle:    Skipping (set SOMNIA_AGENTS_PLATFORM_ADDRESS in .env)");
  }

  // ── 9. LiquidityProviderAgent (base, BTC-USD) ───────────────────────────────
  const LiquidityProviderAgent = await ethers.getContractFactory("LiquidityProviderAgent");
  const lpAgent = await LiquidityProviderAgent.deploy(
    pairAddresses["BTC-USD"],
    marginVaultAddr,
    mockUSDCAddr          // ← new: collateralToken for approve-before-deposit
  );
  await lpAgent.waitForDeployment();
  const lpAgentAddr = await lpAgent.getAddress();
  console.log(`✅ LiquidityProviderAgent: ${lpAgentAddr}`);

  // ── 10. EnhancedLiquidityProviderAgent (optional) ──────────────────────────
  if (sentimentOracle) {
    const EnhancedLPAgent = await ethers.getContractFactory("EnhancedLiquidityProviderAgent");
    enhancedLpAgent = await EnhancedLPAgent.deploy(
      pairAddresses["BTC-USD"],
      marginVaultAddr,
      await sentimentOracle.getAddress(),
      mockUSDCAddr          // ← new: collateralToken for approve-before-deposit
    );
    await enhancedLpAgent.waitForDeployment();
    console.log(`✅ EnhancedLPAgent:     ${await enhancedLpAgent.getAddress()}`);
  } else {
    console.log("⏭️  EnhancedLPAgent:    Skipping (requires SentimentOracle)");
  }

  // ── 11. AgentOracle (optional) ──────────────────────────────────────────────
  if (SOMNIA_AGENTS_PLATFORM) {
    const AgentOracle = await ethers.getContractFactory("AgentOracle");
    agentOracle = await AgentOracle.deploy(SOMNIA_AGENTS_PLATFORM, assetId);
    await agentOracle.waitForDeployment();
    console.log(`✅ AgentOracle:         ${await agentOracle.getAddress()}`);
  }

  // ── 12. AgentInterface ──────────────────────────────────────────────────────
  const AgentInterface = await ethers.getContractFactory("AgentInterface");
  const agentInterface = await AgentInterface.deploy(
    pairAddresses["BTC-USD"],
    marginVaultAddr,
    await sentinel.getAddress(),
    lpAgentAddr,
    await oracleAdapter.getAddress()
  );
  await agentInterface.waitForDeployment();
  console.log(`✅ AgentInterface:      ${await agentInterface.getAddress()}`);

  if (sentimentOracle && enhancedLpAgent) {
    await agentInterface.setSentimentContracts(
      await sentimentOracle.getAddress(),
      await enhancedLpAgent.getAddress()
    );
    console.log("  → SentimentOracle + EnhancedLPAgent wired into AgentInterface");
  }

  // ── 13. Wire permissions ────────────────────────────────────────────────────
  console.log("\n🔌 Wiring permissions...");

  // All OrderBooks need to call settlePosition / lockMargin / releaseMargin
  for (const pair of pairs) {
    await marginVault.setAuthorized(pairAddresses[pair.name], true);
    console.log(`  → ${pair.name} OrderBook authorized on MarginVault`);
  }

  // Sentinel calls liquidate()
  await marginVault.setAuthorized(await sentinel.getAddress(), true);
  console.log("  → LiquidationSentinel authorized on MarginVault");

  // PerpEngine calls adjustMargin() for applyFunding()
  await marginVault.setAuthorized(await perpEngine.getAddress(), true);
  console.log("  → PerpEngine authorized on MarginVault (applyFunding)");

  // F-02: authorize the oracle relayer + reactive gateway to push index prices.
  // setIndexPrice is no longer permissionless, so the legitimate feed must be granted.
  await perpEngine.setAuthorized(await oracleAdapter.getAddress(), true);
  await perpEngine.setAuthorized(await agentInterface.getAddress(), true);
  console.log("  → OracleAdapter + AgentInterface authorized on PerpEngine (setIndexPrice)");

  // LP Agents call lockMargin / placeOrder indirectly — authorize both
  await marginVault.setAuthorized(lpAgentAddr, true);
  console.log("  → LiquidityProviderAgent authorized on MarginVault");

  if (enhancedLpAgent) {
    await marginVault.setAuthorized(await enhancedLpAgent.getAddress(), true);
    console.log("  → EnhancedLPAgent authorized on MarginVault");
  }

  // ── 14. Subscribe reactive hooks ────────────────────────────────────────────
  console.log("\n📡 Subscribing reactive hooks...");
  const ORDER_PLACED_TOPIC = await agentInterface.ORDER_PLACED_TOPIC();
  const PRICE_UPDATED_TOPIC = await agentInterface.PRICE_UPDATED_TOPIC();

  await agentInterface.subscribe(pairAddresses["BTC-USD"], ORDER_PLACED_TOPIC);
  console.log("  → Subscribed: BTC-USD OrderPlaced events");

  await agentInterface.subscribe(await oracleAdapter.getAddress(), PRICE_UPDATED_TOPIC);
  console.log("  → Subscribed: PriceUpdated events (OracleAdapter)");

  if (agentOracle) {
    await agentInterface.subscribe(await agentOracle.getAddress(), PRICE_UPDATED_TOPIC);
    console.log("  → Subscribed: PriceUpdated events (AgentOracle)");
  }

  if (SOMNIA_AGENTS_PLATFORM) {
    await agentInterface.setSomniaReactiveAddress(SOMNIA_AGENTS_PLATFORM);
    console.log("  → Somnia reactive address wired into AgentInterface");
  } else {
    console.log("  ⚠️  SOMNIA_AGENTS_PLATFORM_ADDRESS not set — onEvent() restricted to owner only");
  }

  // ── 15. Fund LP Agents ──────────────────────────────────────────────────────
  // MarginVault.deposit() now does transferFrom — agents need USDC minted TO
  // them first, then they approve the vault, then call deposit themselves.
  // Since scripts run as deployer, we: mint → transfer to agent → agent approves
  // vault → agent deposits. For testnet simplicity we do it all as deployer
  // acting on behalf of the agent addresses using the mint() function.
  console.log("\n💰 Funding LP Agents...");

  const spreadBps = 20;
  const USDC_SCALE = 10n ** 6n;
  // orderSizeUSDC passed to initialize() — agents deposit (orderSize * 2) internally.
  // 5,000 USDC per side × 2 sides = 10,000 USDC needed per agent.
  const ORDER_SIZE_USDC = 5_000n * USDC_SCALE;   // 5,000 USDC per order side (6 decimals)
  const LP_FUND_USDC = ORDER_SIZE_USDC * 10n;  // 50,000 USDC total per agent

  // Mint USDC directly to each agent contract address.
  // initialize() now calls: collateralToken.safeApprove(vault, amount) → vault.deposit(amount)
  // so the agent handles the full approve+deposit flow itself — no deployer workarounds needed.

  await mockUSDC.mint(lpAgentAddr, LP_FUND_USDC);
  console.log(`  → Minted ${ethers.formatUnits(LP_FUND_USDC, 6)} USDC to LiquidityProviderAgent`);
  await lpAgent.initialize(spreadBps, ORDER_SIZE_USDC, initialPrice);
  console.log("  → Base LP Agent initialized (approved vault + deposited + placed orders)");

  if (enhancedLpAgent) {
    const enhancedAddr = await enhancedLpAgent.getAddress();
    await mockUSDC.mint(enhancedAddr, LP_FUND_USDC);
    console.log(`  → Minted ${ethers.formatUnits(LP_FUND_USDC, 6)} USDC to EnhancedLPAgent`);
    await enhancedLpAgent.initialize(spreadBps, ORDER_SIZE_USDC, initialPrice);
    console.log("  → Enhanced LP Agent initialized (approved vault + deposited + placed orders)");
  }

  // ── 16. Print summary ───────────────────────────────────────────────────────
  console.log("\n✅ All contracts deployed and configured!");
  console.log("\n📋 Contract Addresses:");
  console.log("=".repeat(62));
  console.log(`MockUSDC:                   ${mockUSDCAddr}`);
  console.log(`MockPriceFeed:              ${await mockPriceFeed.getAddress()}`);
  console.log(`OracleAdapter:              ${await oracleAdapter.getAddress()}`);
  console.log(`MarginVault:                ${marginVaultAddr}`);
  console.log(`OrderBookFactory:           ${await orderBookFactory.getAddress()}`);
  for (const pair of pairs) {
    console.log(`  ${pair.name}:             ${pairAddresses[pair.name]}`);
  }
  console.log(`PerpEngine:                 ${await perpEngine.getAddress()}`);
  console.log(`LiquidationSentinel:        ${await sentinel.getAddress()}`);
  console.log(`LiquidityProviderAgent:     ${lpAgentAddr}`);
  console.log(`AgentInterface:             ${await agentInterface.getAddress()}`);
  if (sentimentOracle) console.log(`SentimentOracle:            ${await sentimentOracle.getAddress()}`);
  if (enhancedLpAgent) console.log(`EnhancedLPAgent:            ${await enhancedLpAgent.getAddress()}`);
  if (agentOracle) console.log(`AgentOracle:                ${await agentOracle.getAddress()}`);
  console.log("=".repeat(62));

  if (SOMNIA_AGENTS_PLATFORM) {
    console.log("\n🤖 All 3 Somnia Agents Integrated:");
    console.log("  1. JSON API Agent    (CoinGecko) → AgentOracle + SentimentOracle");
    console.log("  2. LLM Inference     (sentiment + volatility) → SentimentOracle");
    console.log("  3. LLM Parse Website (CoinDesk) → SentimentOracle");
    console.log("  → Enhanced LP Agent adjusts spread based on AI sentiment + volatility");
  }

  // ── 17. Write deployed-addresses.json ──────────────────────────────────────
  const fs = require("fs");
  const path = require("path");

  const deployed: Record<string, any> = {
    mockUSDC: mockUSDCAddr,
    mockPriceFeed: await mockPriceFeed.getAddress(),
    oracleAdapter: await oracleAdapter.getAddress(),
    marginVault: marginVaultAddr,
    perpEngine: await perpEngine.getAddress(),
    orderBookFactory: await orderBookFactory.getAddress(),
    orderBooks: {} as Record<string, string>,
    liquidationSentinel: await sentinel.getAddress(),
    liquidityProviderAgent: lpAgentAddr,
    agentInterface: await agentInterface.getAddress(),
  };

  for (const pair of pairs) {
    deployed.orderBooks[pair.name] = pairAddresses[pair.name];
  }

  if (enhancedLpAgent) deployed.enhancedLiquidityProviderAgent = await enhancedLpAgent.getAddress();
  if (sentimentOracle) deployed.sentimentOracle = await sentimentOracle.getAddress();
  if (agentOracle) deployed.agentOracle = await agentOracle.getAddress();

  const outPath = path.join(__dirname, "../deployed-addresses.json");
  fs.writeFileSync(outPath, JSON.stringify(deployed, null, 2));
  console.log(`\n📄 Addresses written to deployed-addresses.json`);
  console.log("   → Copy these into frontend/src/lib/addresses.ts before running the app");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });