import { ethers } from "hardhat";

async function main() {
  console.log("🚀 Deploying Sentient Finance contracts (multi-pair)...\n");

  const [deployer] = await ethers.getSigners();
  console.log(`Deploying with: ${deployer.address}\n`);

  const PRICE_SCALE = 10n ** 8n;
  const initialPrice = 50000n * PRICE_SCALE;
  const assetId = ethers.keccak256(ethers.toUtf8Bytes("BTC-USD"));

  // 1. Deploy MockPriceFeed
  const MockPriceFeed = await ethers.getContractFactory("MockPriceFeed");
  const mockPriceFeed = await MockPriceFeed.deploy(initialPrice);
  await mockPriceFeed.waitForDeployment();
  console.log(`✅ MockPriceFeed: ${await mockPriceFeed.getAddress()}`);

  // 2. Deploy OracleAdapter
  const OracleAdapter = await ethers.getContractFactory("OracleAdapter");
  const oracleAdapter = await OracleAdapter.deploy(
    await mockPriceFeed.getAddress(),
    assetId
  );
  await oracleAdapter.waitForDeployment();
  console.log(`✅ OracleAdapter: ${await oracleAdapter.getAddress()}`);

  // 3. Deploy MarginVault
  const MarginVault = await ethers.getContractFactory("MarginVault");
  const marginVault = await MarginVault.deploy();
  await marginVault.waitForDeployment();
  console.log(`✅ MarginVault: ${await marginVault.getAddress()}`);

  // 4. Deploy PerpEngine (before factory so factory can reference it)
  const PerpEngine = await ethers.getContractFactory("PerpEngine");
  const perpEngine = await PerpEngine.deploy(await marginVault.getAddress());
  await perpEngine.waitForDeployment();
  console.log(`✅ PerpEngine: ${await perpEngine.getAddress()}`);

  // 5. Deploy OrderBookFactory (needs perpEngine address)
  const OrderBookFactory = await ethers.getContractFactory("OrderBookFactory");
  const orderBookFactory = await OrderBookFactory.deploy(
    await marginVault.getAddress(),
    await perpEngine.getAddress()
  );
  await orderBookFactory.waitForDeployment();
  console.log(`✅ OrderBookFactory: ${await orderBookFactory.getAddress()}`);

  // 4b. Create OrderBooks for each trading pair
  const pairs = [
    { name: "BTC-USD", price: 50000n * PRICE_SCALE },
    { name: "ETH-USD", price: 3000n * PRICE_SCALE },
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

  // Register all pairs in PerpEngine
  for (const pair of pairs) {
    const pairId = ethers.keccak256(ethers.toUtf8Bytes(pair.name));
    await perpEngine.registerPair(pairId, pairAddresses[pair.name]);
    console.log(`  → Registered ${pair.name} in PerpEngine`);
  }

  // 6. Deploy LiquidationSentinel
  const LiquidationSentinel = await ethers.getContractFactory("LiquidationSentinel");
  const sentinel = await LiquidationSentinel.deploy(await marginVault.getAddress());
  await sentinel.waitForDeployment();
  console.log(`✅ LiquidationSentinel: ${await sentinel.getAddress()}`);

  // 7. Deploy LiquidityProviderAgent (for BTC-USD)
  const LiquidityProviderAgent = await ethers.getContractFactory("LiquidityProviderAgent");
  const lpAgent = await LiquidityProviderAgent.deploy(
    pairAddresses["BTC-USD"],
    await marginVault.getAddress()
  );
  await lpAgent.waitForDeployment();
  console.log(`✅ LiquidityProviderAgent: ${await lpAgent.getAddress()}`);

  // 8. Deploy AgentInterface (using BTC-USD OrderBook)
  const AgentInterface = await ethers.getContractFactory("AgentInterface");
  const agentInterface = await AgentInterface.deploy(
    pairAddresses["BTC-USD"],
    await marginVault.getAddress(),
    await sentinel.getAddress(),
    await lpAgent.getAddress(),
    await oracleAdapter.getAddress()
  );
  await agentInterface.waitForDeployment();
  console.log(`✅ AgentInterface: ${await agentInterface.getAddress()}`);

  // 9. Deploy AgentOracle (optional)
  const SOMNIA_AGENTS_PLATFORM = process.env.SOMNIA_AGENTS_PLATFORM_ADDRESS;
  let agentOracle: any = null;
  if (SOMNIA_AGENTS_PLATFORM) {
    const AgentOracle = await ethers.getContractFactory("AgentOracle");
    agentOracle = await AgentOracle.deploy(SOMNIA_AGENTS_PLATFORM, assetId);
    await agentOracle.waitForDeployment();
    console.log(`✅ AgentOracle: ${await agentOracle.getAddress()}`);
  } else {
    console.log("⏭️  AgentOracle: Skipping (set SOMNIA_AGENTS_PLATFORM_ADDRESS in .env)");
  }

  // 10. Wire permissions
  console.log("\n🔌 Wiring permissions...");
  for (const pair of pairs) {
    await marginVault.setAuthorized(pairAddresses[pair.name], true);
    console.log(`  → ${pair.name} OrderBook authorized on MarginVault`);
  }
  await marginVault.setAuthorized(await sentinel.getAddress(), true);
  console.log("  → Sentinel authorized on MarginVault");

  // 11. Subscribe reactive hooks
  console.log("\n📡 Subscribing reactive hooks...");
  const ORDER_PLACED_TOPIC = await agentInterface.ORDER_PLACED_TOPIC();
  const PRICE_UPDATED_TOPIC = await agentInterface.PRICE_UPDATED_TOPIC();
  await agentInterface.subscribe(pairAddresses["BTC-USD"], ORDER_PLACED_TOPIC);
  console.log("  → Subscribed to BTC-USD OrderPlaced events");
  await agentInterface.subscribe(await oracleAdapter.getAddress(), PRICE_UPDATED_TOPIC);
  console.log("  → Subscribed to PriceUpdated events (OracleAdapter)");
  if (agentOracle) {
    await agentInterface.subscribe(await agentOracle.getAddress(), PRICE_UPDATED_TOPIC);
    console.log("  → Subscribed to PriceUpdated events (AgentOracle)");
  }

  // 12. Fund + initialize LP Agent
  console.log("\n💰 Funding LP Agent...");
  const spreadBps = 20;
  const orderSize = 1n * (10n ** 18n);
  await marginVault.connect(deployer).deposit(orderSize * 2n);
  await lpAgent.initialize(spreadBps, orderSize, initialPrice);
  console.log("  → LP Agent initialized");

  // Summary
  console.log("\n✅ All contracts deployed and configured!");
  console.log("\n📋 Contract Addresses:");
  console.log("=".repeat(60));
  console.log(`MockPriceFeed:          ${await mockPriceFeed.getAddress()}`);
  console.log(`OracleAdapter:          ${await oracleAdapter.getAddress()}`);
  console.log(`MarginVault:            ${await marginVault.getAddress()}`);
  console.log(`OrderBookFactory:       ${await orderBookFactory.getAddress()}`);
  for (const pair of pairs) {
    console.log(`  ${pair.name}:           ${pairAddresses[pair.name]}`);
  }
  console.log(`PerpEngine:             ${await perpEngine.getAddress()}`);
  console.log(`LiquidationSentinel:    ${await sentinel.getAddress()}`);
  console.log(`LiquidityProviderAgent: ${await lpAgent.getAddress()}`);
  console.log(`AgentInterface:         ${await agentInterface.getAddress()}`);
  if (agentOracle) {
    console.log(`AgentOracle:            ${await agentOracle.getAddress()}`);
  }
  console.log("=".repeat(60));
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
