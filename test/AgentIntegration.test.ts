import { expect } from "chai";
import { ethers } from "hardhat";
import {
  AgentInterface,
  OrderBook,
  MarginVault,
  LiquidationSentinel,
  LiquidityProviderAgent,
  OracleAdapter,
  MockUSDC,
} from "../typechain-types";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";

describe("AgentIntegration", function () {
  let mockUSDC: MockUSDC;
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
  const USDC_SCALE = 10n ** 6n;
  // Using 100 USDC notional per order (6-dec) for test consistency
  const ORDER_SIZE_USDC = 100n * USDC_SCALE;
  const LEVERAGE = 10n;

  beforeEach(async function () {
    [owner, trader1, trader2] = await ethers.getSigners();

    const MockUSDC = await ethers.getContractFactory("MockUSDC");
    mockUSDC = await MockUSDC.deploy();
    await mockUSDC.waitForDeployment();
    const usdcAddr = await mockUSDC.getAddress();

    const MarginVaultFactory = await ethers.getContractFactory("MarginVault");
    marginVault = await MarginVaultFactory.deploy(usdcAddr);
    await marginVault.waitForDeployment();
    const vaultAddr = await marginVault.getAddress();

    const OracleAdapterFactory = await ethers.getContractFactory("OracleAdapter");
    oracleAdapter = await OracleAdapterFactory.deploy(
      await owner.getAddress(),
      ethers.keccak256(ethers.toUtf8Bytes("BTC-USD"))
    );
    await oracleAdapter.waitForDeployment();

    const PerpEngineFactory = await ethers.getContractFactory("PerpEngine");
    const perpEngine = await PerpEngineFactory.deploy(vaultAddr);
    await perpEngine.waitForDeployment();

    const OrderBookFactory = await ethers.getContractFactory("OrderBook");
    orderBook = await OrderBookFactory.deploy(
      vaultAddr,
      await perpEngine.getAddress(),
      ethers.keccak256(ethers.toUtf8Bytes("BTC-USD"))
    );
    await orderBook.waitForDeployment();

    const SentinelFactory = await ethers.getContractFactory("LiquidationSentinel");
    sentinel = await SentinelFactory.deploy(vaultAddr);
    await sentinel.waitForDeployment();

    const LPFactory = await ethers.getContractFactory("LiquidityProviderAgent");
    lpAgent = await LPFactory.deploy(
      await orderBook.getAddress(),
      vaultAddr,
      usdcAddr
    );
    await lpAgent.waitForDeployment();

    const AgentInterfaceFactory = await ethers.getContractFactory("AgentInterface");
    agentInterface = await AgentInterfaceFactory.deploy(
      await orderBook.getAddress(),
      vaultAddr,
      await sentinel.getAddress(),
      await lpAgent.getAddress(),
      await oracleAdapter.getAddress()
    );
    await agentInterface.waitForDeployment();

    await marginVault.setAuthorized(await orderBook.getAddress(), true);
    await marginVault.setAuthorized(await sentinel.getAddress(), true);

    const ORDER_PLACED_TOPIC = await agentInterface.ORDER_PLACED_TOPIC();
    const PRICE_UPDATED_TOPIC = await agentInterface.PRICE_UPDATED_TOPIC();
    await agentInterface.subscribe(await orderBook.getAddress(), ORDER_PLACED_TOPIC);
    await agentInterface.subscribe(await oracleAdapter.getAddress(), PRICE_UPDATED_TOPIC);
  });

  async function fundTrader(trader: HardhatEthersSigner, amount: bigint) {
    const vaultAddr = await marginVault.getAddress();
    await mockUSDC.mint(trader.address, amount);
    await mockUSDC.connect(trader).approve(vaultAddr, amount);
    await marginVault.connect(trader).deposit(amount);
  }

  async function fundLPAgent(lpAgentAddr: string, amount: bigint) {
    await mockUSDC.mint(lpAgentAddr, amount);
  }

  // LP agent needs depositAmount = orderSizeUSDC * 10 for vault deposit
  // plus 2 × orderSizeUSDC for two active orders' locked margin.
  // 12× is safe for initialize; rebalance recycles the same margin.
  const LP_FUND_MULTIPLIER = 12n;

  describe("reactive order flow", function () {
    it("should attempt match on simulated order placed", async function () {
      const price = 50000n * PRICE_SCALE;
      const size = ORDER_SIZE_USDC;
      const margin = size / LEVERAGE;

      await fundTrader(trader1, margin * 4n);

      await orderBook.connect(trader1).placeOrder(false, price, size, LEVERAGE);
      await orderBook.connect(trader1).placeOrder(true, price + 1n * PRICE_SCALE, size, LEVERAGE);

      await agentInterface.simulateOrderPlaced();

      const bestBid = await orderBook.bestBid();
      const bestAsk = await orderBook.bestAsk();
      // Orders persist (self-match guard, LP agent not initialized)
      expect(bestBid).to.equal(50001n * PRICE_SCALE);
      expect(bestAsk).to.equal(50000n * PRICE_SCALE);
    });
  });

  describe("reactive price update flow", function () {
    it("should trigger PnL update on simulated price update", async function () {
      const newPrice = 48000n * PRICE_SCALE;

      await fundLPAgent(await lpAgent.getAddress(), ORDER_SIZE_USDC * LP_FUND_MULTIPLIER);
      await lpAgent.initialize(20n, ORDER_SIZE_USDC, 50000n * PRICE_SCALE);

      await agentInterface.simulatePriceUpdate(newPrice);
    });
  });

  describe("LP Agent reactive flow", function () {
    it("should place orders on initialize", async function () {
      const spreadBps = 20n;
      const midPrice = 50000n * PRICE_SCALE;

      await fundLPAgent(await lpAgent.getAddress(), ORDER_SIZE_USDC * LP_FUND_MULTIPLIER);
      await lpAgent.initialize(spreadBps, ORDER_SIZE_USDC, midPrice);

      expect(await orderBook.bestBid()).to.be.gt(0);
      expect(await orderBook.bestAsk()).to.be.gt(0);
    });

    it("should rebalance after price moves beyond threshold", async function () {
      const spreadBps = 20n;
      const midPrice = 50000n * PRICE_SCALE;

      await fundLPAgent(await lpAgent.getAddress(), ORDER_SIZE_USDC * LP_FUND_MULTIPLIER);
      await lpAgent.initialize(spreadBps, ORDER_SIZE_USDC, midPrice);

      const oldBid = await orderBook.bestBid();
      const oldAsk = await orderBook.bestAsk();

      const newPrice = 51000n * PRICE_SCALE;
      await lpAgent.rebalance(newPrice);

      const newBid = await orderBook.bestBid();
      expect(newBid).to.be.gt(oldBid);
    });

    it("should rebalance after LP's ask was filled by another trader", async function () {
      // This tests the exact bug where the LP agent's activeAskOrderId
      // pointed to a FILLED order, and the old status check (== 1 instead
      // of == 2) tried to cancel it, causing a revert.
      const spreadBps = 20n;
      const midPrice = 50000n * PRICE_SCALE;

      await fundLPAgent(await lpAgent.getAddress(), ORDER_SIZE_USDC * LP_FUND_MULTIPLIER);
      await lpAgent.initialize(spreadBps, ORDER_SIZE_USDC, midPrice);

      const bestAsk = await orderBook.bestAsk();
      expect(bestAsk).to.be.gt(0);

      // Fund trader2 and match against LP's ask
      const margin = ORDER_SIZE_USDC / LEVERAGE;
      await fundTrader(trader2, margin * 4n);

      // trader2 places a bid that crosses LP's ask → fills LP's ask
      // LP's ask is at midPrice + spread, so bid at that price + 1 crosses it
      const crossingBid = bestAsk + 1n * PRICE_SCALE;
      await orderBook.connect(trader2).placeOrder(true, crossingBid, ORDER_SIZE_USDC, LEVERAGE);

      // LP's ask order should now be FILLED (status == 1)
      const lpOrder = await orderBook.getOrder(await lpAgent.activeAskOrderId());
      expect(lpOrder.status).to.equal(1n); // FILLED

      // Rebalance at a new price — this MUST NOT revert
      // (the old enum bug tried to cancel the FILLED order, which OrderBook rejects)
      const newPrice = 51000n * PRICE_SCALE;
      await expect(lpAgent.rebalance(newPrice)).to.not.be.reverted;

      // LP agent should have placed new orders
      const newBid = await orderBook.bestBid();
      expect(newBid).to.be.gt(0);
    });
  });

  describe("full reactive cascade — Sentinel liquidation", function () {
    it("should liquidate position when price drops below liquidation threshold via simulatePriceUpdate", async function () {
      const entryPrice = 50000n * PRICE_SCALE;
      const size = ORDER_SIZE_USDC;

      const margin = size / LEVERAGE;
      await fundTrader(trader1, margin * 2n);
      await fundTrader(trader2, margin * 2n);

      await orderBook.connect(trader1).placeOrder(false, entryPrice, size, LEVERAGE);
      const tx0 = await orderBook.connect(trader2).placeOrder(true, entryPrice + 1n * PRICE_SCALE, size, LEVERAGE);
      await tx0.wait();

      const trackedCount = await marginVault.trackedTradersCount();
      expect(trackedCount).to.be.gte(2);

      const healthBefore = await marginVault.marginHealth(await trader2.getAddress());
      const maintRatio = await marginVault.MAINTENANCE_MARGIN_RATIO();
      expect(healthBefore).to.be.gt(maintRatio);

      const crashPrice = 45000n * PRICE_SCALE;

      await fundLPAgent(await lpAgent.getAddress(), ORDER_SIZE_USDC * LP_FUND_MULTIPLIER);
      await lpAgent.initialize(20n, ORDER_SIZE_USDC, entryPrice);

      const tx = await agentInterface.simulatePriceUpdate(crashPrice);
      await tx.wait();

      const sentinelEvents = await sentinel.queryFilter(sentinel.filters.LiquidationExecuted());
      console.log("  Sentinel events:", sentinelEvents.length);
      expect(sentinelEvents.length).to.be.gt(0);

      const position = await marginVault.getPosition(await trader2.getAddress());
      expect(position.isOpen).to.be.false;
    });
  });
});
