import { ethers } from "hardhat";

async function main() {
  console.log("🚀 Deploying Sentient Finance contracts...\n");

  const [deployer] = await ethers.getSigners();
  console.log(`Deploying with: ${deployer.address}\n`);

  // 1. Deploy MockPriceFeed (initial BTC price: $50,000)
  const PRICE_SCALE = 10n ** 8n;
  const initialPrice = 50000n * PRICE_SCALE;

  const MockPriceFeed = await ethers.getContractFactory("MockPriceFeed");
  const mockPriceFeed = await MockPriceFeed.deploy(initialPrice);
  await mockPriceFeed.waitForDeployment();
  console.log(`✅ MockPriceFeed: ${await mockPriceFeed.getAddress()}`);

  // 2. Deploy OracleAdapter
  const assetId = ethers.keccak256(ethers.toUtf8Bytes("BTC-USD"));
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

  // 4. Deploy OrderBook
  const OrderBook = await ethers.getContractFactory("OrderBook");
  const orderBook = await OrderBook.deploy(await marginVault.getAddress());
  await orderBook.waitForDeployment();
  console.log(`✅ OrderBook: ${await orderBook.getAddress()}`);

  // 5. Deploy PerpEngine
  const PerpEngine = await ethers.getContractFactory("PerpEngine");
  const perpEngine = await PerpEngine.deploy(
    await orderBook.getAddress(),
    await marginVault.getAddress()
  );
  await perpEngine.waitForDeployment();
  console.log(`✅ PerpEngine: ${await perpEngine.getAddress()}`);

  // 6. Deploy AgentInterface
  // (Deploy sentinel and LP agent first, then wire)

  // 7. Deploy LiquidationSentinel
  const LiquidationSentinel = await ethers.getContractFactory("LiquidationSentinel");
  const sentinel = await LiquidationSentinel.deploy(await marginVault.getAddress());
  await sentinel.waitForDeployment();
  console.log(`✅ LiquidationSentinel: ${await sentinel.getAddress()}`);

  // 8. Deploy LiquidityProviderAgent
  const LiquidityProviderAgent = await ethers.getContractFactory("LiquidityProviderAgent");
  const lpAgent = await LiquidityProviderAgent.deploy(
    await orderBook.getAddress(),
    await marginVault.getAddress()
  );
  await lpAgent.waitForDeployment();
  console.log(`✅ LiquidityProviderAgent: ${await lpAgent.getAddress()}`);

  // 6. Deploy AgentInterface (now that we have all addresses)
  const AgentInterface = await ethers.getContractFactory("AgentInterface");
  const agentInterface = await AgentInterface.deploy(
    await orderBook.getAddress(),
    await marginVault.getAddress(),
    await sentinel.getAddress(),
    await lpAgent.getAddress(),
    await oracleAdapter.getAddress()
  );
  await agentInterface.waitForDeployment();
  console.log(`✅ AgentInterface: ${await agentInterface.getAddress()}`);

  // 9. Wire permissions
  console.log("\n🔌 Wiring permissions...");
  await marginVault.setAuthorized(await orderBook.getAddress(), true);
  console.log("  → OrderBook authorized on MarginVault");
  await marginVault.setAuthorized(await sentinel.getAddress(), true);
  console.log("  → Sentinel authorized on MarginVault");

  // 10. Subscribe reactive hooks
  console.log("\n📡 Subscribing reactive hooks...");
  const ORDER_PLACED_TOPIC = await agentInterface.ORDER_PLACED_TOPIC();
  const PRICE_UPDATED_TOPIC = await agentInterface.PRICE_UPDATED_TOPIC();

  await agentInterface.subscribe(await orderBook.getAddress(), ORDER_PLACED_TOPIC);
  console.log("  → Subscribed to OrderPlaced events");
  await agentInterface.subscribe(await oracleAdapter.getAddress(), PRICE_UPDATED_TOPIC);
  console.log("  → Subscribed to PriceUpdated events");

  // 11. Fund LP Agent and initialize
  console.log("\n💰 Funding LP Agent...");
  const spreadBps = 20; // 0.20%
  const orderSize = 1n * (10n ** 18n); // 1 BTC notional
  const midPrice = initialPrice;

  // Deposit collateral for LP agent
  await marginVault.connect(deployer).deposit(orderSize * 2n);
  console.log("  → Deposited collateral for LP Agent");

  // Initialize LP Agent (needs to be done by owner)
  await lpAgent.initialize(spreadBps, orderSize, midPrice);
  console.log("  → LP Agent initialized with spread and orders");

  console.log("\n✅ All contracts deployed and configured!");
  console.log("\n📋 Contract Addresses:");
  console.log("=".repeat(60));
  console.log(`MockPriceFeed:        ${await mockPriceFeed.getAddress()}`);
  console.log(`OracleAdapter:        ${await oracleAdapter.getAddress()}`);
  console.log(`MarginVault:          ${await marginVault.getAddress()}`);
  console.log(`OrderBook:            ${await orderBook.getAddress()}`);
  console.log(`PerpEngine:           ${await perpEngine.getAddress()}`);
  console.log(`LiquidationSentinel:  ${await sentinel.getAddress()}`);
  console.log(`LiquidityProviderAgent: ${await lpAgent.getAddress()}`);
  console.log(`AgentInterface:       ${await agentInterface.getAddress()}`);
  console.log("=".repeat(60));
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
