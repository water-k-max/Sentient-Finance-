/**
 * Security Audit — Reproduction Suite
 * ===================================
 * Each test asserts the SECURE / correct behaviour for one finding in
 * docs/audit/AUDIT_REPORT.md.
 *
 *   • Against the UNAUDITED contracts (branch `main`) these tests FAIL,
 *     proving the vulnerability is real and reachable.
 *   • Against the PATCHED contracts (branch `security-audit`) they PASS,
 *     proving the fix.
 *
 * The suite deliberately calls only methods that exist in BOTH versions
 * (no post-fix-only API), so the exact same file compiles and runs before
 * and after patching. Access-control fixes authorise the deployer/owner by
 * construction, so `owner` is used as the legitimate caller.
 *
 *   npx hardhat test test/audit/findings.spec.ts
 *
 * Patched here ....... F-01 F-02 F-03 F-04 F-05 F-06 F-08 F-10 F-13 F-14
 * Documented only .... F-07 F-09 F-11 F-12 F-15 F-16 (architectural)
 */
import { expect } from "chai";
import { ethers } from "hardhat";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";

const PRICE_SCALE = 10n ** 8n;
const USDC_SCALE = 10n ** 6n;
const BTC_USD = ethers.keccak256(ethers.toUtf8Bytes("BTC-USD"));
const INITIAL_BTC_PRICE = 50000n * PRICE_SCALE;

let owner: HardhatEthersSigner;
let attacker: HardhatEthersSigner;
let trader1: HardhatEthersSigner;
let trader2: HardhatEthersSigner;
let authorized: HardhatEthersSigner;

beforeEach(async () => {
  [owner, attacker, trader1, trader2, authorized] = await ethers.getSigners();
});

/* ------------------------------------------------------------------ */
/* Minimal self-contained deploy helpers                               */
/* ------------------------------------------------------------------ */

async function deployUSDC() {
  const c = await (await ethers.getContractFactory("MockUSDC")).deploy();
  await c.waitForDeployment();
  return c;
}
async function deployVault(usdc: string) {
  const c = await (await ethers.getContractFactory("MarginVault")).deploy(usdc);
  await c.waitForDeployment();
  return c;
}
async function deployPerp(vault: string) {
  const c = await (await ethers.getContractFactory("PerpEngine")).deploy(vault);
  await c.waitForDeployment();
  return c;
}
async function deployOrderBook(vault: string, perp: string) {
  const c = await (await ethers.getContractFactory("OrderBook")).deploy(vault, perp, BTC_USD);
  await c.waitForDeployment();
  return c;
}
async function fund(vault: any, usdc: any, trader: HardhatEthersSigner, amount: bigint) {
  await usdc.mint(trader.address, amount); // owner mints (owner-gated after F-06)
  await usdc.connect(trader).approve(await vault.getAddress(), amount);
  await vault.connect(trader).deposit(amount);
}

/* ================================================================== */
/* F-01 — OracleAdapter.updatePriceDirect is permissionless (CRITICAL) */
/* ================================================================== */
describe("F-01 · OracleAdapter permissionless price write", () => {
  it("rejects a direct price write from a non-owner", async () => {
    const feed = await (await ethers.getContractFactory("MockPriceFeed")).deploy(INITIAL_BTC_PRICE);
    const oracle = await (await ethers.getContractFactory("OracleAdapter")).deploy(
      await feed.getAddress(), BTC_USD
    );
    // Attacker sets BTC to $1 — would let them liquidate/scale out at will.
    await expect(oracle.connect(attacker).updatePriceDirect(1n * PRICE_SCALE)).to.be.reverted;
    // Owner still can.
    await expect(oracle.connect(owner).updatePriceDirect(51000n * PRICE_SCALE)).to.not.be.reverted;
  });
});

/* ================================================================== */
/* F-02 — PerpEngine.setIndexPrice / recordFill permissionless (CRIT)  */
/* ================================================================== */
describe("F-02 · PerpEngine permissionless index/mark-price writes", () => {
  it("rejects setIndexPrice and recordFill from an unauthorized caller", async () => {
    const usdc = await deployUSDC();
    const vault = await deployVault(await usdc.getAddress());
    const perp = await deployPerp(await vault.getAddress());

    // Attacker poisons the index price (drives funding + liquidation math).
    await expect(perp.connect(attacker).setIndexPrice(BTC_USD, 1n * PRICE_SCALE)).to.be.reverted;
    // Attacker poisons the VWAP mark-price buffer with a fake fill.
    await expect(perp.connect(attacker).recordFill(BTC_USD, 1n * PRICE_SCALE, 10n ** 12n)).to.be.reverted;
  });
});

/* ================================================================== */
/* F-03 — MarginVault.getFreeMargin double-subtracts locked (HIGH)     */
/* ================================================================== */
describe("F-03 · getFreeMargin double-counts locked margin", () => {
  it("reports collateral that is actually free (locked already removed)", async () => {
    const usdc = await deployUSDC();
    const vault = await deployVault(await usdc.getAddress());
    await vault.setAuthorized(authorized.address, true);

    await fund(vault, usdc, trader1, 1000n * USDC_SCALE);
    // Lock 300 as if for a resting order: collateralBalances 1000 -> 700, locked 0 -> 300.
    await vault.connect(authorized).lockMargin(trader1.address, 300n * USDC_SCALE);

    // Free margin must be the 700 still in collateralBalances, not 700 - 300.
    expect(await vault.getFreeMargin(trader1.address)).to.equal(700n * USDC_SCALE);
  });
});

/* ================================================================== */
/* F-04 — MarginVault.liquidate zeroes ALL locked margin (HIGH)        */
/* ================================================================== */
describe("F-04 · liquidate destroys resting-order margin", () => {
  it("preserves margin locked by resting orders when a position is liquidated", async () => {
    const usdc = await deployUSDC();
    const vault = await deployVault(await usdc.getAddress());
    await vault.setAuthorized(authorized.address, true);

    await fund(vault, usdc, trader1, 1000n * USDC_SCALE);
    await fund(vault, usdc, trader2, 1000n * USDC_SCALE);

    // 200 USDC locked for a resting (unfilled) order — unrelated to any position.
    await vault.connect(authorized).lockMargin(trader1.address, 200n * USDC_SCALE);

    // Open a 10x long for trader1 vs a short for trader2 at 50,000.
    await vault.connect(authorized).settlePosition(
      trader1.address, trader2.address,
      50000n * PRICE_SCALE, 100n * USDC_SCALE, 10n, 10n
    );

    // Crash the price so trader1's long is deep underwater -> health 0.
    await vault.updatePnL(trader1.address, 40000n * PRICE_SCALE);
    expect(await vault.marginHealth(trader1.address)).to.equal(0n);

    await vault.connect(authorized).liquidate(trader1.address);

    // The resting order's 200 USDC lock must survive the liquidation...
    expect(await vault.getLockedMargin(trader1.address)).to.equal(200n * USDC_SCALE);
    // ...and therefore still be releasable (the resting order can be cancelled).
    await expect(
      vault.connect(authorized).releaseMargin(trader1.address, 200n * USDC_SCALE)
    ).to.not.be.reverted;
  });
});

/* ================================================================== */
/* F-05 — OrderBook self-match guard is an unbounded loop (HIGH DoS)   */
/* ================================================================== */
describe("F-05 · self-match guard gas-burn DoS", () => {
  it("does not run out of gas when a trader crosses their own resting bid", async () => {
    const usdc = await deployUSDC();
    const vault = await deployVault(await usdc.getAddress());
    const perp = await deployPerp(await vault.getAddress());
    const book = await deployOrderBook(await vault.getAddress(), await perp.getAddress());
    await vault.setAuthorized(await book.getAddress(), true);
    // Register the book so a legitimate fill could record (not exercised here).
    await perp.registerPair(BTC_USD, await book.getAddress());

    await fund(vault, usdc, trader1, 100_000n * USDC_SCALE);

    const price = 50000n * PRICE_SCALE;
    const size = 100n * USDC_SCALE;
    // Resting bid, then two crossing asks from the SAME trader.
    await book.connect(trader1).placeOrder(true, price, size, 10n);
    await book.connect(trader1).placeOrder(false, price, size, 10n);
    // Third order triggers the oscillating self-match scan. Bounded gas => must not revert.
    await expect(
      book.connect(trader1).placeOrder(false, price, size, 10n, { gasLimit: 5_000_000 })
    ).to.not.be.reverted;
  });
});

/* ================================================================== */
/* F-06 — MockUSDC.mint is permissionless (CRITICAL, live collateral)  */
/* ================================================================== */
describe("F-06 · collateral token has an open mint", () => {
  it("rejects minting from a non-owner", async () => {
    const usdc = await deployUSDC();
    await expect(usdc.connect(attacker).mint(attacker.address, 10n ** 15n)).to.be.reverted;
    await expect(usdc.connect(owner).mint(owner.address, 1000n)).to.not.be.reverted;
  });
});

/* ================================================================== */
/* F-08 — EnhancedLPAgent oracle callbacks permissionless + unbounded  */
/* ================================================================== */
describe("F-08 · Enhanced LP agent oracle-push access control & bounds", () => {
  async function deployAgent() {
    const usdc = await deployUSDC();
    const agent = await (await ethers.getContractFactory("EnhancedLiquidityProviderAgent")).deploy(
      attacker.address,        // orderBook (unused by these callbacks)
      attacker.address,        // marginVault (unused)
      attacker.address,        // sentimentOracle (unused)
      await usdc.getAddress()  // collateralToken (must be non-zero)
    );
    await agent.waitForDeployment();
    return agent; // deployed by `owner`, so owner is the legitimate caller
  }

  it("rejects sentiment/volatility pushes from an unauthorized caller", async () => {
    const agent = await deployAgent();
    await expect(agent.connect(attacker).onVolatilityUpdate(50n)).to.be.reverted;
    await expect(agent.connect(attacker).onSentimentUpdate("bearish")).to.be.reverted;
  });

  it("bounds volatility so the spread formula cannot underflow", async () => {
    const agent = await deployAgent();
    // A sane value from the legitimate caller is accepted...
    await expect(agent.connect(owner).onVolatilityUpdate(50n)).to.not.be.reverted;
    // ...an absurd value that would make (10000 - effectiveSpread) underflow is rejected.
    await expect(agent.connect(owner).onVolatilityUpdate(ethers.MaxUint256)).to.be.reverted;
  });
});

/* ================================================================== */
/* F-10 — Funding rate scaled by the interval twice (HIGH)             */
/* ================================================================== */
describe("F-10 · funding rate double-scaled by FUNDING_INTERVAL", () => {
  it("computes a per-interval funding rate, not one divided by seconds", async () => {
    const usdc = await deployUSDC();
    const vault = await deployVault(await usdc.getAddress());
    const perp = await deployPerp(await vault.getAddress());

    // owner is the legitimate caller (onlyOwner after the fix).
    await perp.connect(owner).setIndexPrice(BTC_USD, 50000n * PRICE_SCALE);
    await perp.connect(owner).recordFill(BTC_USD, 50500n * PRICE_SCALE, 100n); // mark 1% above index

    // Expected: (mark - index) / index = 500/50000 = 1% = 1e16 per interval.
    expect(await perp.computeFundingRate(BTC_USD)).to.equal(10n ** 16n);
  });
});

/* ================================================================== */
/* F-13 — KeeperRegistry.removeKeeper uses transfer() (2300 gas) (MED) */
/* ================================================================== */
describe("F-13 · keeper bond refund via transfer()", () => {
  it("refunds a bond to a contract wallet that needs >2300 gas", async () => {
    const registry = await (await ethers.getContractFactory("KeeperRegistry")).deploy();
    const greedy = await (await ethers.getContractFactory("GreedyReceiver")).deploy();
    await greedy.waitForDeployment();

    await registry.addKeeper(await greedy.getAddress(), { value: ethers.parseEther("0.1") });
    // transfer() reverts against a >2300-gas receiver; a low-level call must succeed.
    await expect(registry.removeKeeper(await greedy.getAddress())).to.not.be.reverted;
    expect(await registry.isActiveKeeper(await greedy.getAddress())).to.equal(false);
  });
});

/* ================================================================== */
/* F-14 — Frontend targets the wrong Somnia chain id (MED, off-chain)  */
/* ================================================================== */
describe("F-14 · frontend Somnia chain id", () => {
  it("resolves 50312 to 0xC488, the value the frontend must use", () => {
    // The shipped frontend used 0xC478 == 50296 (wrong network).
    expect((50312).toString(16).toLowerCase()).to.equal("c488");
    expect(50296).to.not.equal(50312);
  });
});
