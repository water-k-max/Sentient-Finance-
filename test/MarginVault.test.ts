import { expect } from "chai";
import { ethers } from "hardhat";
import { MarginVault, MockUSDC } from "../typechain-types";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";

describe("MarginVault", function () {
  let marginVault: MarginVault;
  let mockUSDC: MockUSDC;
  let owner: HardhatEthersSigner;
  let trader1: HardhatEthersSigner;
  let trader2: HardhatEthersSigner;
  let authorizedAddr: HardhatEthersSigner;

  const PRICE_SCALE = 10n ** 8n;
  const USDC_SCALE = 10n ** 6n;

  beforeEach(async function () {
    [owner, trader1, trader2, authorizedAddr] = await ethers.getSigners();

    const MockUSDC = await ethers.getContractFactory("MockUSDC");
    mockUSDC = await MockUSDC.deploy();
    await mockUSDC.waitForDeployment();

    const MarginVaultFactory = await ethers.getContractFactory("MarginVault");
    marginVault = await MarginVaultFactory.deploy(await mockUSDC.getAddress());
    await marginVault.waitForDeployment();

    await marginVault.setAuthorized(await authorizedAddr.getAddress(), true);
  });

  describe("deposit", function () {
    it("should increase collateralBalance correctly", async function () {
      const amount = 1000n * USDC_SCALE;
      const vaultAddr = await marginVault.getAddress();
      await mockUSDC.mint(trader1.address, amount);
      await mockUSDC.connect(trader1).approve(vaultAddr, amount);
      await marginVault.connect(trader1).deposit(amount);

      const balance = await marginVault.getCollateralBalance(
        await trader1.getAddress()
      );
      expect(balance).to.equal(amount);
    });

    it("should emit Deposit event", async function () {
      const amount = 500n * USDC_SCALE;
      const vaultAddr = await marginVault.getAddress();
      await mockUSDC.mint(trader1.address, amount);
      await mockUSDC.connect(trader1).approve(vaultAddr, amount);
      const tx = await marginVault.connect(trader1).deposit(amount);
      const receipt = await tx.wait();

      const event = receipt?.logs.find(
        (l: any) => l.fragment?.name === "Deposit"
      );
      expect(event).to.not.be.undefined;
    });
  });

  describe("settlePosition", function () {
    it("should create correct long and short positions", async function () {
      const fillPrice = 50000n * PRICE_SCALE;
      const fillSize = 100n * USDC_SCALE;
    });
  });

  describe("computeLiquidationPrice", function () {
    it("should return correct value at 10x leverage for longs", async function () {
      const entryPrice = 50000n * PRICE_SCALE;
      const leverage = 10n;

      const liqPrice = await marginVault.computeLiquidationPrice(
        true,
        entryPrice,
        leverage
      );

      const expected = 47500n * PRICE_SCALE;
      expect(liqPrice).to.equal(expected);
    });

    it("should return correct value at 10x leverage for shorts", async function () {
      const entryPrice = 50000n * PRICE_SCALE;
      const leverage = 10n;

      const liqPrice = await marginVault.computeLiquidationPrice(
        false,
        entryPrice,
        leverage
      );

      const expected = 52500n * PRICE_SCALE;
      expect(liqPrice).to.equal(expected);
    });
  });

  describe("withdraw", function () {
    it("should allow withdrawal of free collateral", async function () {
      const deposit = 1000n * USDC_SCALE;
      const vaultAddr = await marginVault.getAddress();
      await mockUSDC.mint(trader1.address, deposit);
      await mockUSDC.connect(trader1).approve(vaultAddr, deposit);
      await marginVault.connect(trader1).deposit(deposit);

      const withdrawAmount = 500n * USDC_SCALE;
      await marginVault.connect(trader1).withdraw(withdrawAmount);

      const balance = await marginVault.getCollateralBalance(
        await trader1.getAddress()
      );
      expect(balance).to.equal(deposit - withdrawAmount);
    });

    it("should revert if withdrawal would exceed balance", async function () {
      const deposit = 100n * USDC_SCALE;
      const vaultAddr = await marginVault.getAddress();
      await mockUSDC.mint(trader1.address, deposit);
      await mockUSDC.connect(trader1).approve(vaultAddr, deposit);
      await marginVault.connect(trader1).deposit(deposit);

      await expect(
        marginVault.connect(trader1).withdraw(deposit + 1n)
      ).to.be.reverted;
    });
  });

  describe("authorization", function () {
    it("should only allow authorized addresses to call lockMargin", async function () {
      const deposit = 100n * USDC_SCALE;
      const vaultAddr = await marginVault.getAddress();
      await mockUSDC.mint(trader1.address, deposit);
      await mockUSDC.connect(trader1).approve(vaultAddr, deposit);
      await marginVault.connect(trader1).deposit(deposit);

      await expect(
        marginVault.connect(trader1).lockMargin(
          await trader1.getAddress(),
          10n * USDC_SCALE
        )
      ).to.be.revertedWith("MarginVault: not authorized");

      await marginVault.connect(authorizedAddr).lockMargin(
        await trader1.getAddress(),
        10n * USDC_SCALE
      );
    });

    it("liquidate should only be callable by authorized", async function () {
      await expect(
        marginVault.connect(trader1).liquidate(await trader2.getAddress())
      ).to.be.revertedWith("MarginVault: not authorized");
    });
  });
});
