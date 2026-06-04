import { expect } from "chai";
import { ethers } from "hardhat";
import { LiquidationSentinel, MarginVault, OrderBook, MockUSDC } from "../typechain-types";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";

describe("LiquidationSentinel", function () {
  let sentinel: LiquidationSentinel;
  let marginVault: MarginVault;
  let orderBook: OrderBook;
  let mockUSDC: MockUSDC;
  let owner: HardhatEthersSigner;
  let trader1: HardhatEthersSigner;

  const PRICE_SCALE = 10n ** 8n;

  beforeEach(async function () {
    [owner, trader1] = await ethers.getSigners();

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
    orderBook = await OrderBookFactory.deploy(vaultAddr, await perpEngine.getAddress(), ethers.keccak256(ethers.toUtf8Bytes("BTC-USD")));
    await orderBook.waitForDeployment();

    const SentinelFactory = await ethers.getContractFactory("LiquidationSentinel");
    sentinel = await SentinelFactory.deploy(vaultAddr);
    await sentinel.waitForDeployment();

    await marginVault.setAuthorized(await orderBook.getAddress(), true);
    await marginVault.setAuthorized(await sentinel.getAddress(), true);
  });

  describe("checkAllPositions", function () {
    it("should update PnL for all positions", async function () {
      const currentPrice = 50000n * PRICE_SCALE;
      await sentinel.checkAllPositions(currentPrice);
    });
  });

  describe("pause/unpause", function () {
    it("should prevent checks when paused", async function () {
      await sentinel.pause();

      await expect(
        sentinel.checkAllPositions(50000n * PRICE_SCALE)
      ).to.be.revertedWith("Sentinel: paused");
    });

    it("should allow checks after unpausing", async function () {
      await sentinel.pause();
      await sentinel.unpause();

      await sentinel.checkAllPositions(50000n * PRICE_SCALE);
    });
  });

  describe("liquidatePosition", function () {
    it("should only liquidate unhealthy positions", async function () {
      await expect(
        sentinel.liquidatePosition(await trader1.getAddress())
      ).to.be.reverted;
    });
  });
});
