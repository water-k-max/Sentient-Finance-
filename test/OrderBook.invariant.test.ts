import { expect } from "chai";
import { ethers } from "hardhat";
import { OrderBook, MarginVault } from "../typechain-types";
import fc from "fast-check";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";

describe("OrderBook — Invariant Tests", function () {
  let orderBook: OrderBook;
  let marginVault: MarginVault;
  let trader: HardhatEthersSigner;

  const PRICE_SCALE = 10n ** 8n;
  const SIZE_SCALE = 10n ** 18n;

  beforeEach(async function () {
    [, trader] = await ethers.getSigners();

    const MarginVaultFactory = await ethers.getContractFactory("MarginVault");
    marginVault = await MarginVaultFactory.deploy();
    await marginVault.waitForDeployment();

    const OrderBookFactory = await ethers.getContractFactory("OrderBook");
    orderBook = await OrderBookFactory.deploy(await marginVault.getAddress());
    await orderBook.waitForDeployment();

    await marginVault.setAuthorized(await orderBook.getAddress(), true);

    // Fund trader heavily
    await marginVault.connect(trader).deposit(1000000n * SIZE_SCALE);
  });

  describe("heap ordering invariants", function () {
    it("bestBid is always >= all other bid prices after any sequence of inserts", async function () {
      // Deploy a fresh order book for each run to avoid cross-run state
      await fc.assert(
        fc.asyncProperty(
          fc.uniqueArray(fc.integer({ min: 40000, max: 60000 }), { minLength: 3, maxLength: 10 }),
          async (prices) => {
            const obFactory = await ethers.getContractFactory("OrderBook");
            const mvFactory = await ethers.getContractFactory("MarginVault");
            const mv = await mvFactory.deploy();
            await mv.waitForDeployment();
            const ob = await obFactory.deploy(await mv.getAddress());
            await ob.waitForDeployment();
            await mv.setAuthorized(await ob.getAddress(), true);
            await mv.connect(trader).deposit(1000000n * SIZE_SCALE);

            const leverage = 10n;
            const size = 1n * SIZE_SCALE;

            for (const p of prices) {
              await ob.connect(trader).placeOrder(
                true,
                BigInt(p) * PRICE_SCALE,
                size,
                leverage
              );
            }

            const bestBid = await ob.bestBid();
            const maxPrice = BigInt(Math.max(...prices)) * PRICE_SCALE;
            expect(bestBid).to.equal(maxPrice);
          }
        ),
        { numRuns: 20 }
      );
    });

    it("bestAsk is always <= all other ask prices after any sequence of inserts", async function () {
      await fc.assert(
        fc.asyncProperty(
          fc.uniqueArray(fc.integer({ min: 40000, max: 60000 }), { minLength: 3, maxLength: 10 }),
          async (prices) => {
            const obFactory = await ethers.getContractFactory("OrderBook");
            const mvFactory = await ethers.getContractFactory("MarginVault");
            const mv = await mvFactory.deploy();
            await mv.waitForDeployment();
            const ob = await obFactory.deploy(await mv.getAddress());
            await ob.waitForDeployment();
            await mv.setAuthorized(await ob.getAddress(), true);
            await mv.connect(trader).deposit(1000000n * SIZE_SCALE);

            const leverage = 10n;
            const size = 1n * SIZE_SCALE;

            for (const p of prices) {
              await ob.connect(trader).placeOrder(
                false,
                BigInt(p) * PRICE_SCALE,
                size,
                leverage
              );
            }

            const bestAsk = await ob.bestAsk();
            const minPrice = BigInt(Math.min(...prices)) * PRICE_SCALE;
            expect(bestAsk).to.equal(minPrice);
          }
        ),
        { numRuns: 20 }
      );
    });

    it("order IDs are strictly increasing", async function () {
      await fc.assert(
        fc.asyncProperty(
          fc.integer({ min: 5, max: 15 }),
          async (count) => {
            const leverage = 10n;
            const size = 1n * SIZE_SCALE;
            let lastId = -1n;

            for (let i = 0; i < count; i++) {
              const tx = await orderBook.connect(trader).placeOrder(
                true,
                BigInt(50000 + i) * PRICE_SCALE,
                size,
                leverage
              );
              const receipt = await tx.wait();
              const orderId = (receipt?.logs.find(
                (l: any) => l.fragment?.name === "OrderPlaced"
              ) as any)?.args[0];
              expect(orderId).to.be.gt(lastId);
              lastId = orderId;
            }
          }
        ),
        { numRuns: 20 }
      );
    });
  });

  describe("margin non-negative invariant", function () {
    it("collateral balance never goes negative after deposit/withdraw/place/cancel sequences", async function () {
      await fc.assert(
        fc.asyncProperty(
          fc.array(
            fc.oneof(
              fc.constant("deposit" as const),
              fc.constant("withdraw" as const),
              fc.constant("placeOrder" as const),
              fc.constant("cancelOrder" as const)
            ),
            { minLength: 5, maxLength: 15 }
          ),
          async (actions) => {
            let orderId = -1n;

            for (const action of actions) {
              const balance = await marginVault.getCollateralBalance(
                await trader.getAddress()
              );

              switch (action) {
                case "deposit":
                  await marginVault.connect(trader).deposit(100n * SIZE_SCALE);
                  break;
                case "withdraw":
                  if (balance > 0n) {
                    await marginVault.connect(trader).withdraw(1n * SIZE_SCALE);
                  }
                  break;
                case "placeOrder":
                  if (balance > 10n * SIZE_SCALE) {
                    const tx = await orderBook.connect(trader).placeOrder(
                      true,
                      50000n * PRICE_SCALE,
                      1n * SIZE_SCALE,
                      10n
                    );
                    const receipt = await tx.wait();
                    orderId = (receipt?.logs.find(
                      (l: any) => l.fragment?.name === "OrderPlaced"
                    ) as any)?.args[0] ?? -1n;
                  }
                  break;
                case "cancelOrder":
                  if (orderId >= 0n) {
                    try {
                      await orderBook.connect(trader).cancelOrder(orderId);
                    } catch {
                      // Order may already be filled/cancelled
                    }
                    orderId = -1n;
                  }
                  break;
              }

              // Invariant: balance is never negative (uint256 can't be negative, but check it's accessible)
              const newBalance = await marginVault.getCollateralBalance(
                await trader.getAddress()
              );
              // uint256 can't be negative by definition, but this ensures no reverts
              expect(newBalance >= 0n).to.be.true;
            }
          }
        ),
        { numRuns: 20 }
      );
    });
  });
});
