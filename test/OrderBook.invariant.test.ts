import { expect } from "chai";
import { ethers } from "hardhat";
import { OrderBook, MarginVault, MockUSDC } from "../typechain-types";
import fc from "fast-check";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";

describe("OrderBook — Invariant Tests", function () {
  let orderBook: OrderBook;
  let marginVault: MarginVault;
  let mockUSDCGlobal: MockUSDC;
  let trader: HardhatEthersSigner;

  const PRICE_SCALE = 10n ** 8n;
  const USDC_SCALE = 10n ** 6n;
  const ORDER_SIZE_USDC = 100n * USDC_SCALE;

  beforeEach(async function () {
    [, trader] = await ethers.getSigners();

    const MockUSDC = await ethers.getContractFactory("MockUSDC");
    mockUSDCGlobal = await MockUSDC.deploy();
    await mockUSDCGlobal.waitForDeployment();
    const usdcAddr = await mockUSDCGlobal.getAddress();

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

    await marginVault.setAuthorized(await orderBook.getAddress(), true);

    await mockUSDCGlobal.mint(trader.address, 1000000n * USDC_SCALE);
    await mockUSDCGlobal.connect(trader).approve(vaultAddr, 1000000n * USDC_SCALE);
    await marginVault.connect(trader).deposit(1000000n * USDC_SCALE);
  });

  describe("heap ordering invariants", function () {
    it("bestBid is always >= all other bid prices after any sequence of inserts", async function () {
      await fc.assert(
        fc.asyncProperty(
          fc.uniqueArray(fc.integer({ min: 40000, max: 60000 }), { minLength: 3, maxLength: 10 }),
          async (prices) => {
            const MockUSDC = await ethers.getContractFactory("MockUSDC");
            const musdc = await MockUSDC.deploy();
            await musdc.waitForDeployment();
            const mf = await ethers.getContractFactory("MarginVault");
            const mv = await mf.deploy(await musdc.getAddress());
            await mv.waitForDeployment();
            const vaultAddr = await mv.getAddress();
            const pf = await ethers.getContractFactory("PerpEngine");
            const pe = await pf.deploy(vaultAddr);
            await pe.waitForDeployment();
            const of = await ethers.getContractFactory("OrderBook");
            const ob = await of.deploy(vaultAddr, await pe.getAddress(), ethers.keccak256(ethers.toUtf8Bytes("BTC-USD")));
            await ob.waitForDeployment();
            await mv.setAuthorized(await ob.getAddress(), true);
            await musdc.mint(trader.address, 1000000n * USDC_SCALE);
            await musdc.connect(trader).approve(vaultAddr, 1000000n * USDC_SCALE);
            await mv.connect(trader).deposit(1000000n * USDC_SCALE);

            const leverage = 10n;
            const size = ORDER_SIZE_USDC;

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
            const MockUSDC = await ethers.getContractFactory("MockUSDC");
            const musdc = await MockUSDC.deploy();
            await musdc.waitForDeployment();
            const mf = await ethers.getContractFactory("MarginVault");
            const mv = await mf.deploy(await musdc.getAddress());
            await mv.waitForDeployment();
            const vaultAddr = await mv.getAddress();
            const pf = await ethers.getContractFactory("PerpEngine");
            const pe = await pf.deploy(vaultAddr);
            await pe.waitForDeployment();
            const of = await ethers.getContractFactory("OrderBook");
            const ob = await of.deploy(vaultAddr, await pe.getAddress(), ethers.keccak256(ethers.toUtf8Bytes("BTC-USD")));
            await ob.waitForDeployment();
            await mv.setAuthorized(await ob.getAddress(), true);
            await musdc.mint(trader.address, 1000000n * USDC_SCALE);
            await musdc.connect(trader).approve(vaultAddr, 1000000n * USDC_SCALE);
            await mv.connect(trader).deposit(1000000n * USDC_SCALE);

            const leverage = 10n;
            const size = ORDER_SIZE_USDC;

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
            const size = ORDER_SIZE_USDC;
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
                case "deposit": {
                  const amt = 100n * USDC_SCALE;
                  await mockUSDCGlobal.mint(trader.address, amt);
                  await mockUSDCGlobal.connect(trader).approve(await marginVault.getAddress(), amt);
                  await marginVault.connect(trader).deposit(amt);
                  break;
                }
                case "withdraw":
                  if (balance > 0n) {
                    await marginVault.connect(trader).withdraw(1n * USDC_SCALE);
                  }
                  break;
                case "placeOrder":
                  if (balance > 10n * USDC_SCALE) {
                    const tx = await orderBook.connect(trader).placeOrder(
                      true,
                      50000n * PRICE_SCALE,
                      ORDER_SIZE_USDC,
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

              const newBalance = await marginVault.getCollateralBalance(
                await trader.getAddress()
              );
              expect(newBalance >= 0n).to.be.true;
            }
          }
        ),
        { numRuns: 20 }
      );
    });
  });
});
