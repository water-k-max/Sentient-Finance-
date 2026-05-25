import { expect } from "chai";
import { ethers } from "hardhat";
import { LiquidationSentinel, MarginVault, OrderBook } from "../typechain-types";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";

describe("LiquidationSentinel", function () {
  let sentinel: LiquidationSentinel;
  let marginVault: MarginVault;
  let orderBook: OrderBook;
  let owner: HardhatEthersSigner;
  let trader1: HardhatEthersSigner;

  const PRICE_SCALE = 10n ** 8n;
  const SIZE_SCALE = 10n ** 18n;

  beforeEach(async function () {
    [owner, trader1] = await ethers.getSigners();

    const MarginVaultFactory = await ethers.getContractFactory("MarginVault");
    marginVault = await MarginVaultFactory.deploy();
    await marginVault.waitForDeployment();

    const OrderBookFactory = await ethers.getContractFactory("OrderBook");
    orderBook = await OrderBookFactory.deploy(await marginVault.getAddress());
    await orderBook.waitForDeployment();

    const SentinelFactory = await ethers.getContractFactory("LiquidationSentinel");
    sentinel = await SentinelFactory.deploy(await marginVault.getAddress());
    await sentinel.waitForDeployment();

    // Wire permissions
    await marginVault.setAuthorized(await orderBook.getAddress(), true);
    await marginVault.setAuthorized(await sentinel.getAddress(), true);
  });

  describe("checkAllPositions", function () {
    it("should update PnL for all positions", async function () {
      // This test verifies the sentinel can call updateAllPnL
      // Full liquidation test requires a position to be opened first
      const currentPrice = 50000n * PRICE_SCALE;

      // Should not revert
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
      // Without an open position, marginHealth returns type(uint256).max
      // which is > MAINTENANCE_MARGIN_RATIO, so should revert
      await expect(
        sentinel.liquidatePosition(await trader1.getAddress())
      ).to.be.reverted;
    });
  });
});
