import { expect } from "chai";
import { ethers } from "hardhat";
import { OrderBook, MarginVault, MockUSDC } from "../typechain-types";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";

describe("OrderBook", function () {
  let orderBook: OrderBook;
  let marginVault: MarginVault;
  let mockUSDC: MockUSDC;
  let owner: HardhatEthersSigner;
  let trader1: HardhatEthersSigner;
  let trader2: HardhatEthersSigner;

  const PRICE_SCALE = 10n ** 8n;
  const USDC_SCALE = 10n ** 6n;
  // 100 USDC notional per order — aligns with new MarginVault._openPosition formula
  const ORDER_SIZE_USDC = 100n * USDC_SCALE;

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

    await marginVault.setAuthorized(await orderBook.getAddress(), true);
    // F-02: the order book must be authorized on PerpEngine to record fills.
    await perpEngine.setAuthorized(await orderBook.getAddress(), true);
  });

  async function fundTrader(trader: HardhatEthersSigner, amount: bigint) {
    const vaultAddr = await marginVault.getAddress();
    await mockUSDC.mint(trader.address, amount);
    await mockUSDC.connect(trader).approve(vaultAddr, amount);
    await marginVault.connect(trader).deposit(amount);
  }

  describe("placeOrder", function () {
    it("should place a bid order and emit OrderPlaced", async function () {
      const price = 50000n * PRICE_SCALE;
      const size = ORDER_SIZE_USDC;
      const leverage = 10n;
      const margin = size / leverage;

      await fundTrader(trader1, margin * 2n);

      const tx = await orderBook.connect(trader1).placeOrder(true, price, size, leverage);
      const receipt = await tx.wait();
      const event = receipt?.logs.find(
        (l: any) => l.fragment?.name === "OrderPlaced"
      );
      expect(event).to.not.be.undefined;
    });

    it("should place an ask order and emit OrderPlaced", async function () {
      const price = 50000n * PRICE_SCALE;
      const size = ORDER_SIZE_USDC;
      const leverage = 10n;
      const margin = size / leverage;

      await fundTrader(trader1, margin * 2n);

      const tx = await orderBook.connect(trader1).placeOrder(false, price, size, leverage);
      const receipt = await tx.wait();
      const event = receipt?.logs.find(
        (l: any) => l.fragment?.name === "OrderPlaced"
      );
      expect(event).to.not.be.undefined;
    });

    it("should revert if price is 0", async function () {
      await expect(
        orderBook.connect(trader1).placeOrder(true, 0, ORDER_SIZE_USDC, 10n)
      ).to.be.revertedWith("OrderBook: price must be > 0");
    });

    it("should revert if size is 0", async function () {
      await expect(
        orderBook.connect(trader1).placeOrder(true, 50000n * PRICE_SCALE, 0, 10n)
      ).to.be.revertedWith("OrderBook: size must be > 0");
    });

    it("should revert if leverage is out of range", async function () {
      await expect(
        orderBook.connect(trader1).placeOrder(true, 50000n * PRICE_SCALE, ORDER_SIZE_USDC, 0n)
      ).to.be.revertedWith("OrderBook: invalid leverage");

      await expect(
        orderBook.connect(trader1).placeOrder(true, 50000n * PRICE_SCALE, ORDER_SIZE_USDC, 101n)
      ).to.be.revertedWith("OrderBook: invalid leverage");
    });
  });

  describe("order matching", function () {
    it("should match crossing orders and emit OrderMatched", async function () {
      const bidPrice = 50000n * PRICE_SCALE;
      const askPrice = 49999n * PRICE_SCALE;
      const size = ORDER_SIZE_USDC;
      const leverage = 10n;
      const margin = size / leverage;

      await fundTrader(trader1, margin * 2n);
      await fundTrader(trader2, margin * 2n);

      await orderBook.connect(trader1).placeOrder(false, askPrice, size, leverage);

      const tx = await orderBook.connect(trader2).placeOrder(true, bidPrice, size, leverage);
      const receipt = await tx.wait();
      const matchedEvent = receipt?.logs.find(
        (l: any) => l.fragment?.name === "OrderMatched"
      );
      expect(matchedEvent).to.not.be.undefined;
    });

    it("should partially fill when bid size > ask size", async function () {
      const price = 50000n * PRICE_SCALE;
      const bidSize = ORDER_SIZE_USDC * 2n;
      const askSize = ORDER_SIZE_USDC;
      const leverage = 10n;

      const askMargin = askSize / leverage;
      const bidMargin = bidSize / leverage;
      await fundTrader(trader1, askMargin * 3n);
      await fundTrader(trader2, bidMargin * 3n);

      await orderBook.connect(trader1).placeOrder(false, price, askSize, leverage);

      await orderBook.connect(trader2).placeOrder(true, price, bidSize, leverage);

      const bidDepth = await orderBook.getOrderBookDepth(10);
      // Bid should have remaining size = bidSize - askSize
      expect(bidDepth.bidSizes[0]).to.equal(bidSize - askSize);
    });
  });

  describe("cancelOrder", function () {
    it("should remove order from heap and release margin", async function () {
      const price = 50000n * PRICE_SCALE;
      const size = ORDER_SIZE_USDC;
      const leverage = 10n;
      const margin = size / leverage;

      await fundTrader(trader1, margin * 2n);

      const tx = await orderBook.connect(trader1).placeOrder(true, price, size, leverage);
      const receipt = await tx.wait();
      const orderId = (receipt?.logs.find(
        (l: any) => l.fragment?.name === "OrderPlaced"
      ) as any)?.args[0];

      await orderBook.connect(trader1).cancelOrder(orderId);

      const order = await orderBook.getOrder(orderId);
      expect(order.status).to.equal(3n); // CANCELLED
    });

    it("should revert if cancelling someone else's order", async function () {
      const price = 50000n * PRICE_SCALE;
      const size = ORDER_SIZE_USDC;
      const leverage = 10n;
      const margin = size / leverage;

      await fundTrader(trader1, margin * 2n);

      const tx = await orderBook.connect(trader1).placeOrder(true, price, size, leverage);
      const receipt = await tx.wait();
      const orderId = (receipt?.logs.find(
        (l: any) => l.fragment?.name === "OrderPlaced"
      ) as any)?.args[0];

      await expect(
        orderBook.connect(trader2).cancelOrder(orderId)
      ).to.be.revertedWith("OrderBook: not your order");
    });
  });

  describe("getOrderBookDepth", function () {
    it("should return correct bid/ask arrays", async function () {
      const leverage = 10n;
      const size = ORDER_SIZE_USDC;
      const margin = size / leverage;

      await fundTrader(trader1, margin * 10n);

      await orderBook.connect(trader1).placeOrder(true, 49000n * PRICE_SCALE, size, leverage);
      await orderBook.connect(trader1).placeOrder(true, 50000n * PRICE_SCALE, size, leverage);
      await orderBook.connect(trader1).placeOrder(false, 51000n * PRICE_SCALE, size, leverage);
      await orderBook.connect(trader1).placeOrder(false, 52000n * PRICE_SCALE, size, leverage);

      const depth = await orderBook.getOrderBookDepth(5);
      expect(depth.bidPrices.length).to.equal(2);
      expect(depth.askPrices.length).to.equal(2);
    });
  });
});
