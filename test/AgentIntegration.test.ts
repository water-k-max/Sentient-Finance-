import { expect } from "chai";
import { ethers } from "hardhat";
import {
  AgentInterface,
  OrderBook,
  MarginVault,
  LiquidationSentinel,
  LiquidityProviderAgent,
  OracleAdapter,
} from "../typechain-types";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";

describe("AgentIntegration", function () {
  let agentInterface: AgentInterface;
  let orderBook: OrderBook;
  let marginVault: MarginVault;
  let sentinel: LiquidationSentinel;
  let lpAgent: LiquidityProviderAgent;
  let oracleAdapter: OracleAdapter;
  let owner: HardhatEthersSigner;
  let trader1: HardhatEthersSigner;
  let trader2: HardhatEthersSigner;

  const PRICE_SCALE = 10n ** 8n;
  const SIZE_SCALE = 10n ** 18n;

  beforeEach(async function () {
    [owner, trader1, trader2] = await ethers.getSigners();

    // Deploy MarginVault
    const MarginVaultFactory = await ethers.getContractFactory("MarginVault");
    marginVault = await MarginVaultFactory.deploy();
    await marginVault.waitForDeployment();

    // Deploy OrderBook
    const OrderBookFactory = await ethers.getContractFactory("OrderBook");
    orderBook = await OrderBookFactory.deploy(await marginVault.getAddress(), ethers.ZeroAddress, ethers.keccak256(ethers.toUtf8Bytes("BTC-USD")));
    await orderBook.waitForDeployment();

    // Deploy OracleAdapter
    const OracleAdapterFactory = await ethers.getContractFactory("OracleAdapter");
    oracleAdapter = await OracleAdapterFactory.deploy(
      await owner.getAddress(), // mock price feed = owner for demo
      ethers.keccak256(ethers.toUtf8Bytes("BTC-USD"))
    );
    await oracleAdapter.waitForDeployment();

    // Deploy Sentinel
    const SentinelFactory = await ethers.getContractFactory("LiquidationSentinel");
    sentinel = await SentinelFactory.deploy(await marginVault.getAddress());
    await sentinel.waitForDeployment();

    // Deploy LP Agent
    const LPFactory = await ethers.getContractFactory("LiquidityProviderAgent");
    lpAgent = await LPFactory.deploy(
      await orderBook.getAddress(),
      await marginVault.getAddress()
    );
    await lpAgent.waitForDeployment();

    // Deploy AgentInterface
    const AgentInterfaceFactory = await ethers.getContractFactory("AgentInterface");
    agentInterface = await AgentInterfaceFactory.deploy(
      await orderBook.getAddress(),
      await marginVault.getAddress(),
      await sentinel.getAddress(),
      await lpAgent.getAddress(),
      await oracleAdapter.getAddress()
    );
    await agentInterface.waitForDeployment();

    // Wire permissions
    await marginVault.setAuthorized(await orderBook.getAddress(), true);
    await marginVault.setAuthorized(await sentinel.getAddress(), true);

    // Subscribe events
    const ORDER_PLACED_TOPIC = await agentInterface.ORDER_PLACED_TOPIC();
    const PRICE_UPDATED_TOPIC = await agentInterface.PRICE_UPDATED_TOPIC();
    await agentInterface.subscribe(await orderBook.getAddress(), ORDER_PLACED_TOPIC);
    await agentInterface.subscribe(await oracleAdapter.getAddress(), PRICE_UPDATED_TOPIC);
  });

  describe("reactive order flow", function () {
    it("should attempt match on simulated order placed", async function () {
      const price = 50000n * PRICE_SCALE;
      const size = 1n * SIZE_SCALE;
      const leverage = 10n;

      // Deposit and place two crossing orders
      const notional = (size * price) / SIZE_SCALE;
      const margin = notional / leverage;
      await marginVault.connect(trader1).deposit(margin * 4n);

      // Place ask
      await orderBook.connect(trader1).placeOrder(false, price, size, leverage);

      // Place crossing bid
      await orderBook.connect(trader1).placeOrder(true, price + 1n * PRICE_SCALE, size, leverage);

      // Simulate reactive matching
      await agentInterface.simulateOrderPlaced();

      // Both orders should be matched
      const bestBid = await orderBook.bestBid();
      const bestAsk = await orderBook.bestAsk();

      // After matching both at same price, both should be cleared
      expect(bestBid).to.equal(0);
      expect(bestAsk).to.equal(0);
    });
  });

  describe("reactive price update flow", function () {
    it("should trigger PnL update on simulated price update", async function () {
      const newPrice = 48000n * PRICE_SCALE;

      // Initialize LP Agent first so rebalance doesn't fail
      await marginVault.connect(owner).deposit(2n * SIZE_SCALE);
      await lpAgent.initialize(20n, 1n * SIZE_SCALE, 50000n * PRICE_SCALE);

      // Should not revert
      await agentInterface.simulatePriceUpdate(newPrice);
    });
  });

  describe("LP Agent reactive flow", function () {
    it("should place orders on initialize", async function () {
      const spreadBps = 20n; // 0.20%
      const orderSize = 1n * SIZE_SCALE;
      const midPrice = 50000n * PRICE_SCALE;

      // Fund LP agent
      await marginVault.connect(owner).deposit(orderSize * 2n);

      await lpAgent.initialize(spreadBps, orderSize, midPrice);

      expect(await orderBook.bestBid()).to.be.gt(0);
      expect(await orderBook.bestAsk()).to.be.gt(0);
    });

    it("should rebalance after price moves beyond threshold", async function () {
      const spreadBps = 20n;
      const orderSize = 1n * SIZE_SCALE;
      const midPrice = 50000n * PRICE_SCALE;

      await marginVault.connect(owner).deposit(orderSize * 4n);
      await lpAgent.initialize(spreadBps, orderSize, midPrice);

      const oldBid = await orderBook.bestBid();
      const oldAsk = await orderBook.bestAsk();

      // Price moves 2% (> 1% threshold)
      const newPrice = 51000n * PRICE_SCALE;
      await lpAgent.rebalance(newPrice);

      // Orders should have been cancelled and replaced
      // New bid should be higher (following price)
      const newBid = await orderBook.bestBid();
      expect(newBid).to.be.gt(oldBid);
    });
  });

  describe("full reactive cascade — Sentinel liquidation", function () {
    it("should liquidate position when price drops below liquidation threshold via simulatePriceUpdate", async function () {
      const entryPrice = 50000n * PRICE_SCALE;
      const size = 1n * SIZE_SCALE;
      const leverage = 10n;

      // Deposit for both traders
      const notional = (size * entryPrice) / SIZE_SCALE;
      const marginPerOrder = notional / leverage;
      await marginVault.connect(trader1).deposit(marginPerOrder * 2n);
      await marginVault.connect(trader2).deposit(marginPerOrder * 2n);

      // trader1 places ask (short)
      await orderBook.connect(trader1).placeOrder(false, entryPrice, size, leverage);

      // trader2 places crossing bid (long) → triggers match
      const tx0 = await orderBook.connect(trader2).placeOrder(true, entryPrice + 1n * PRICE_SCALE, size, leverage);
      await tx0.wait();

      // Verify matching happened
      const askOrder = await orderBook.getOrder(0);
      const bidOrder = await orderBook.getOrder(1);

      // Verify positions were opened (both traders tracked)
      const trackedCount = await marginVault.trackedTradersCount();
      expect(trackedCount).to.be.gte(2);

      // Check trader2's long position is healthy
      const healthBefore = await marginVault.marginHealth(await trader2.getAddress());
      const maintRatio = await marginVault.MAINTENANCE_MARGIN_RATIO();
      expect(healthBefore).to.be.gt(maintRatio);

      // Drop price sharply (below liq price ~47500 for 10x long)
      const crashPrice = 45000n * PRICE_SCALE;

      // Initialize LP Agent so rebalance doesn't fail when triggered
      await marginVault.connect(owner).deposit(4n * SIZE_SCALE);
      await lpAgent.initialize(20n, 1n * SIZE_SCALE, entryPrice);

      // Simulate the full reactive cascade
      const tx = await agentInterface.simulatePriceUpdate(crashPrice);
      const receipt = await tx.wait();

      // Check for LiquidationExecuted via Sentinel's event query
      const sentinelEvents = await sentinel.queryFilter(sentinel.filters.LiquidationExecuted());
      console.log("  Sentinel events:", sentinelEvents.length);
      expect(sentinelEvents.length).to.be.gt(0);

      // Trader2's long position should now be closed
      const position = await marginVault.getPosition(await trader2.getAddress());
      expect(position.isOpen).to.be.false;
    });
  });
});
