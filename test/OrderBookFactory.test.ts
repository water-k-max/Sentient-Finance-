import { expect } from "chai";
import { ethers } from "hardhat";
import {
  OrderBook, OrderBookFactory, MarginVault, MockUSDC, PerpEngine,
} from "../typechain-types";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";

describe("OrderBookFactory", function () {
  let factory: OrderBookFactory;
  let orderBook: OrderBook;
  let marginVault: MarginVault;
  let mockUSDC: MockUSDC;
  let perpEngine: PerpEngine;
  let owner: HardhatEthersSigner;
  let trader: HardhatEthersSigner;

  const PRICE_SCALE = 10n ** 8n;
  const USDC_SCALE = 10n ** 6n;
  const ORDER_SIZE = 100n * USDC_SCALE;
  const LEVERAGE = 10n;
  const PAIR_ID = ethers.keccak256(ethers.toUtf8Bytes("BTC-USD"));

  beforeEach(async function () {
    [owner, trader] = await ethers.getSigners();

    const MockUSDC = await ethers.getContractFactory("MockUSDC");
    mockUSDC = await MockUSDC.deploy();
    await mockUSDC.waitForDeployment();
    const usdcAddr = await mockUSDC.getAddress();

    const VaultFactory = await ethers.getContractFactory("MarginVault");
    marginVault = await VaultFactory.deploy(usdcAddr);
    await marginVault.waitForDeployment();
    const vaultAddr = await marginVault.getAddress();

    const PerpFactory = await ethers.getContractFactory("PerpEngine");
    perpEngine = await PerpFactory.deploy(vaultAddr);
    await perpEngine.waitForDeployment();
    const perpAddr = await perpEngine.getAddress();

    const FactoryFactory = await ethers.getContractFactory("OrderBookFactory");
    factory = await FactoryFactory.deploy(vaultAddr, perpAddr);
    await factory.waitForDeployment();
  });

  describe("deployment", function () {
    it("should set owner correctly", async function () {
      expect(await factory.owner()).to.equal(owner.address);
    });

    it("should set marginVault correctly", async function () {
      expect(await factory.marginVault()).to.equal(await marginVault.getAddress());
    });

    it("should start with no pairs", async function () {
      expect(await factory.getPairCount()).to.equal(0n);
    });
  });

  describe("createOrderBook", function () {
    it("should create a new OrderBook and emit event", async function () {
      const tx = await factory.createOrderBook(PAIR_ID);
      const receipt = await tx.wait();

      const event = receipt?.logs.find(
        (l) => factory.interface.parseLog(l)?.name === "OrderBookCreated"
      );
      expect(event).to.not.be.undefined;

      const addr = await factory.pairOrderBooks(PAIR_ID);
      expect(addr).to.not.equal(ethers.ZeroAddress);
      expect(await factory.pairExists(PAIR_ID)).to.be.true;
      expect(await factory.getPairCount()).to.equal(1n);
    });

    it("should revert if pair already exists", async function () {
      await factory.createOrderBook(PAIR_ID);
      await expect(factory.createOrderBook(PAIR_ID)).to.be.revertedWith(
        "Factory: pair already exists"
      );
    });

    it("should revert if called by non-owner", async function () {
      await expect(factory.connect(trader).createOrderBook(PAIR_ID)).to.be.revertedWith(
        "Factory: not owner"
      );
    });
  });

  describe("adminClearBook passthrough", function () {
    beforeEach(async function () {
      await factory.createOrderBook(PAIR_ID);
      const obAddr = await factory.pairOrderBooks(PAIR_ID);
      orderBook = (await ethers.getContractFactory("OrderBook")).attach(obAddr) as OrderBook;
      await marginVault.setAuthorized(obAddr, true);

      // Fund + deposit margin for trader
      const vaultAddr = await marginVault.getAddress();
      const margin = ORDER_SIZE / LEVERAGE;
      await mockUSDC.mint(trader.address, margin * 4n);
      await mockUSDC.connect(trader).approve(vaultAddr, margin * 4n);
      await marginVault.connect(trader).deposit(margin * 4n);
    });

    it("should clear all orders via factory passthrough", async function () {
      // Place orders
      await orderBook.connect(trader).placeOrder(true, 50000n * PRICE_SCALE, ORDER_SIZE, LEVERAGE);
      await orderBook.connect(trader).placeOrder(false, 50100n * PRICE_SCALE, ORDER_SIZE, LEVERAGE);

      expect(await orderBook.bestBid()).to.be.gt(0);
      expect(await orderBook.bestAsk()).to.be.gt(0);

      // Clear via factory
      await factory.connect(owner).adminClearBook(PAIR_ID);

      expect(await orderBook.bestBid()).to.equal(0n);
      expect(await orderBook.bestAsk()).to.equal(0n);
    });

    it("should revert if pair not found", async function () {
      const fakePair = ethers.keccak256(ethers.toUtf8Bytes("FAKE-USD"));
      await expect(factory.connect(owner).adminClearBook(fakePair)).to.be.revertedWith(
        "Factory: pair not found"
      );
    });

    it("should revert if called by non-owner", async function () {
      await expect(factory.connect(trader).adminClearBook(PAIR_ID)).to.be.revertedWith(
        "Factory: not owner"
      );
    });

    it("should release locked margin on clear", async function () {
      const margin = ORDER_SIZE / LEVERAGE;
      await orderBook.connect(trader).placeOrder(true, 50000n * PRICE_SCALE, ORDER_SIZE, LEVERAGE);
      const freeBefore = await marginVault.getFreeMargin(trader.address);

      await factory.connect(owner).adminClearBook(PAIR_ID);

      const freeAfter = await marginVault.getFreeMargin(trader.address);
      expect(freeAfter).to.be.gt(freeBefore);
    });

    it("should not revert if book is already empty", async function () {
      await expect(factory.connect(owner).adminClearBook(PAIR_ID)).to.not.be.reverted;
    });
  });
});
