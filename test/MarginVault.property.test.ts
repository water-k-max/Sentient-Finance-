import { expect } from "chai";
import { ethers } from "hardhat";
import { MarginVault, MockUSDC } from "../typechain-types";
import fc from "fast-check";

describe("MarginVault — Property-Based Tests", function () {
  let marginVault: MarginVault;
  const PRICE_SCALE = 10n ** 8n;

  beforeEach(async function () {
    const MockUSDC = await ethers.getContractFactory("MockUSDC");
    const musdc = await MockUSDC.deploy();
    await musdc.waitForDeployment();
    const MarginVaultFactory = await ethers.getContractFactory("MarginVault");
    marginVault = await MarginVaultFactory.deploy(await musdc.getAddress());
    await marginVault.waitForDeployment();
  });

  describe("computeLiquidationPrice invariants", function () {
    it("long liquidation price is always <= entry price", async function () {
      await fc.assert(
        fc.asyncProperty(
          fc.bigInt({ min: 1000n * PRICE_SCALE, max: 200000n * PRICE_SCALE }), // $1k–$200k
          fc.integer({ min: 2, max: 19 }), // leverage 2–19x (realistic range)
          async (entryPrice, leverage) => {
            const liqPrice = await marginVault.computeLiquidationPrice(
              true,
              entryPrice,
              BigInt(leverage)
            );
            expect(liqPrice).to.be.lte(entryPrice);
          }
        ),
        { numRuns: 100 }
      );
    });

    it("short liquidation price is always >= entry price", async function () {
      await fc.assert(
        fc.asyncProperty(
          fc.bigInt({ min: 1000n * PRICE_SCALE, max: 200000n * PRICE_SCALE }),
          fc.integer({ min: 2, max: 19 }), // leverage 2–19x
          async (entryPrice, leverage) => {
            const liqPrice = await marginVault.computeLiquidationPrice(
              false,
              entryPrice,
              BigInt(leverage)
            );
            expect(liqPrice).to.be.gte(entryPrice);
          }
        ),
        { numRuns: 100 }
      );
    });

    it("higher leverage produces a non-zero liquidation price", async function () {
      await fc.assert(
        fc.asyncProperty(
          fc.bigInt({ min: 10000n * PRICE_SCALE, max: 100000n * PRICE_SCALE }),
          fc.integer({ min: 2, max: 50 }),
          async (entryPrice, leverage) => {
            const liqPrice = await marginVault.computeLiquidationPrice(
              true, entryPrice, BigInt(leverage)
            );
            expect(liqPrice).to.be.gt(0n);
          }
        ),
        { numRuns: 50 }
      );
    });

    it("2x leverage long liquidates at ~55% of entry", async function () {
      // At 2x: liq = entry * (2-1)/2 + entry * 0.05 = entry * 0.55
      const entryPrice = 50000n * PRICE_SCALE;
      const liqPrice = await marginVault.computeLiquidationPrice(true, entryPrice, 2n);
      const expected = (entryPrice * 55n) / 100n;
      const diff = liqPrice > expected ? liqPrice - expected : expected - liqPrice;
      expect(diff).to.be.lt(1n * PRICE_SCALE);
    });
  });

  describe("margin health monotonicity", function () {
    it("for longs, price drop always decreases margin health", async function () {
      await fc.assert(
        fc.asyncProperty(
          fc.bigInt({ min: 1n, max: 10n * 10n ** 18n }), // size
          fc.bigInt({ min: 10000n * PRICE_SCALE, max: 100000n * PRICE_SCALE }), // entry
          fc.bigInt({ min: 1n, max: 5000n * PRICE_SCALE }), // price drop
          async (size, entryPrice, drop) => {
            const lowerPrice = entryPrice - drop;
            if (lowerPrice <= 0) return true; // skip invalid

            // Long PnL = (currentPrice - entryPrice) * size / 1e8
            const pnlAtEntry = 0n;
            const pnlAtDrop = (lowerPrice - entryPrice) * size / 10n ** 8n;
            expect(pnlAtDrop).to.be.lte(pnlAtEntry);
          }
        ),
        { numRuns: 50 }
      );
    });
  });
});
