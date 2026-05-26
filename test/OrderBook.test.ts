import { expect } from "chai";
import { ethers } from "hardhat";
import { OrderBook, MarginVault } from "../typechain-types";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";

describe("OrderBook", function () {
  let orderBook: OrderBook;
  let marginVault: MarginVault;
  let owner: HardhatEthersSigner;
  let trader1: HardhatEthersSigner;
  let trader2: HardhatEthersSigner;

  const PRICE_SCALE = 10n ** 8n; // 8 decimal places
  const SIZE_SCALE = 10n ** 18n; // 18 decimal places

  beforeEach(async function () {
    [owner, trader1, trader2] = await ethers.getSigners();

    const MarginVaultFactory = await ethers.getContractFactory("MarginVault");
    marginVault = await MarginVaultFactory.deploy();
    await marginVault.waitForDeployment();

    const OrderBookFactory = await ethers.getContractFactory("OrderBook");
    orderBook = await OrderBookFactory.deploy(await marginVault.getAddress(), ethers.ZeroAddress, ethers.keccak256(ethers.toUtf8Bytes("BTC-USD")));
    await orderBook.waitForDeployment();

    // Authorize OrderBook on MarginVault
    await marginVault.setAuthorized(await orderBook.getAddress(), true);
  });

  describe("placeOrder", function () {
    it("should place a bid order and emit OrderPlaced", async function () {
      const price = 50000n * PRICE_SCALE; // $50,000
      const size = 1n * SIZE_SCALE; // 1 BTC
      const leverage = 10n;

      // Deposit collateral
      const notional = (size * price) / SIZE_SCALE;
      const margin = notional / leverage;
      await marginVault.connect(trader1).deposit(margin * 2n);

      const tx = await orderBook.connect(trader1).placeOrder(true, price, size, leverage);
      const receipt = await tx.wait();

      // Check event
      const event = receipt?.logs.find((l: any) => l.fragment?.name === "OrderPlaced");
      expect(event).to.not.be.undefined;

      // Check order book state
      expect(await orderBook.nextOrderId()).to.equal(1);
      expect(await orderBook.bestBid()).to.equal(price);
      expect(await orderBook.bestAsk()).to.equal(0);
    });

    it("should place an ask order and emit OrderPlaced", async function () {
      const price = 50000n * PRICE_SCALE;
      const size = 1n * SIZE_SCALE;
      const leverage = 10n;

      const notional = (size * price) / SIZE_SCALE;
      const margin = notional / leverage;
      await marginVault.connect(trader1).deposit(margin * 2n);

      await orderBook.connect(trader1).placeOrder(false, price, size, leverage);

      expect(await orderBook.bestAsk()).to.equal(price);
      expect(await orderBook.bestBid()).to.equal(0);
    });

    it("should revert if price is 0", async function () {
      await expect(
        orderBook.connect(trader1).placeOrder(true, 0, 1n * SIZE_SCALE, 10n)
      ).to.be.revertedWith("OrderBook: price must be > 0");
    });

    it("should revert if size is 0", async function () {
      await expect(
        orderBook.connect(trader1).placeOrder(true, 50000n * PRICE_SCALE, 0, 10n)
      ).to.be.revertedWith("OrderBook: size must be > 0");
    });

    it("should revert if leverage is out of range", async function () {
      await expect(
        orderBook.connect(trader1).placeOrder(true, 50000n * PRICE_SCALE, 1n * SIZE_SCALE, 0n)
      ).to.be.reverted;
      await expect(
        orderBook.connect(trader1).placeOrder(true, 50000n * PRICE_SCALE, 1n * SIZE_SCALE, 101n)
      ).to.be.reverted;
    });
  });

  describe("order matching", function () {
    it("should match crossing orders and emit OrderMatched", async function () {
      const bidPrice = 50001n * PRICE_SCALE;
      const askPrice = 50000n * PRICE_SCALE;
      const size = 1n * SIZE_SCALE;
      const leverage = 10n;

      // Both traders deposit
      const notional = (size * bidPrice) / SIZE_SCALE;
      const margin = notional / leverage;
      await marginVault.connect(trader1).deposit(margin * 2n);
      await marginVault.connect(trader2).deposit(margin * 2n);

      // Place ask first
      await orderBook.connect(trader1).placeOrder(false, askPrice, size, leverage);

      // Place bid at crossing price
      const tx = await orderBook.connect(trader2).placeOrder(true, bidPrice, size, leverage);
      const receipt = await tx.wait();

      // Check OrderMatched event
      const matchEvent = receipt?.logs.find(
        (l: any) => l.fragment?.name === "OrderMatched"
      );
      expect(matchEvent).to.not.be.undefined;

      // Orders should be filled
      const askOrder = await orderBook.getOrder(0);
      const bidOrder = await orderBook.getOrder(1);
      expect(askOrder.status).to.equal(1); // FILLED
      expect(bidOrder.status).to.equal(1); // FILLED
    });

    it("should partially fill when bid size > ask size", async function () {
      const bidSize = 2n * SIZE_SCALE;
      const askSize = 1n * SIZE_SCALE;
      const price = 50000n * PRICE_SCALE;
      const leverage = 10n;

      const notional = (bidSize * price) / SIZE_SCALE;
      const margin = notional / leverage;
      await marginVault.connect(trader1).deposit(margin * 3n);
      await marginVault.connect(trader2).deposit(margin * 3n);

      // Place ask
      await orderBook.connect(trader1).placeOrder(false, price, askSize, leverage);

      // Place larger bid
      await orderBook.connect(trader2).placeOrder(true, price, bidSize, leverage);

      const askOrder = await orderBook.getOrder(0);
      expect(askOrder.status).to.equal(1); // FILLED

      const bidOrder = await orderBook.getOrder(1);
      expect(bidOrder.status).to.equal(2); // PARTIALLY_FILLED
    });
  });

  describe("heap ordering", function () {
    it("should always return highest price as bestBid", async function () {
      const leverage = 10n;
      const size = 1n * SIZE_SCALE;

      // Deposit enough for all orders
      await marginVault.connect(trader1).deposit(1000000n * SIZE_SCALE);

      // Place bids at different prices
      const prices = [49000n, 50000n, 51000n, 48000n, 52000n];
      for (const p of prices) {
        await orderBook.connect(trader1).placeOrder(true, p * PRICE_SCALE, size, leverage);
      }

      expect(await orderBook.bestBid()).to.equal(52000n * PRICE_SCALE);
    });

    it("should always return lowest price as bestAsk", async function () {
      const leverage = 10n;
      const size = 1n * SIZE_SCALE;

      await marginVault.connect(trader1).deposit(1000000n * SIZE_SCALE);

      const prices = [51000n, 50000n, 49000n, 52000n, 48000n];
      for (const p of prices) {
        await orderBook.connect(trader1).placeOrder(false, p * PRICE_SCALE, size, leverage);
      }

      expect(await orderBook.bestAsk()).to.equal(48000n * PRICE_SCALE);
    });
  });

  describe("cancelOrder", function () {
    it("should remove order from heap and release margin", async function () {
      const price = 50000n * PRICE_SCALE;
      const size = 1n * SIZE_SCALE;
      const leverage = 10n;

      const notional = (size * price) / SIZE_SCALE;
      const margin = notional / leverage;
      await marginVault.connect(trader1).deposit(margin * 2n);

      const tx = await orderBook.connect(trader1).placeOrder(true, price, size, leverage);
      const receipt = await tx.wait();

      // Get orderId from event
      const event = receipt?.logs.find((l: any) => l.fragment?.name === "OrderPlaced");
      const orderId = (event as any).args[0];

      // Cancel
      const cancelTx = await orderBook.connect(trader1).cancelOrder(orderId);
      const cancelReceipt = await cancelTx.wait();

      const cancelEvent = cancelReceipt?.logs.find(
        (l: any) => l.fragment?.name === "OrderCancelled"
      );
      expect(cancelEvent).to.not.be.undefined;

      // Best bid should be 0 now
      expect(await orderBook.bestBid()).to.equal(0);
    });

    it("should revert if cancelling someone else's order", async function () {
      const price = 50000n * PRICE_SCALE;
      const size = 1n * SIZE_SCALE;
      const leverage = 10n;

      const notional = (size * price) / SIZE_SCALE;
      const margin = notional / leverage;
      await marginVault.connect(trader1).deposit(margin * 2n);

      await orderBook.connect(trader1).placeOrder(true, price, size, leverage);

      await expect(
        orderBook.connect(trader2).cancelOrder(0)
      ).to.be.revertedWith("OrderBook: not your order");
    });
  });

  describe("getOrderBookDepth", function () {
    it("should return correct bid/ask arrays", async function () {
      const leverage = 10n;
      const size = 1n * SIZE_SCALE;
      await marginVault.connect(trader1).deposit(1000000n * SIZE_SCALE);

      await orderBook.connect(trader1).placeOrder(true, 49000n * PRICE_SCALE, size, leverage);
      await orderBook.connect(trader1).placeOrder(true, 50000n * PRICE_SCALE, size, leverage);
      await orderBook.connect(trader1).placeOrder(false, 51000n * PRICE_SCALE, size, leverage);
      await orderBook.connect(trader1).placeOrder(false, 52000n * PRICE_SCALE, size, leverage);

      const [bidPrices, bidSizes, askPrices, askSizes] =
        await orderBook.getOrderBookDepth(10);

      // Bids in descending order (max-heap)
      expect(bidPrices[0]).to.equal(50000n * PRICE_SCALE);
      expect(bidPrices[1]).to.equal(49000n * PRICE_SCALE);

      // Asks in ascending order (min-heap)
      expect(askPrices[0]).to.equal(51000n * PRICE_SCALE);
      expect(askPrices[1]).to.equal(52000n * PRICE_SCALE);
    });
  });
});
