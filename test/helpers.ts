import { ethers } from "hardhat";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { OrderBook, MarginVault, MockUSDC } from "../typechain-types";
import { PRICE_SCALE, USDC_SCALE } from "./fixtures";

export async function placeMatchingOrders(
  orderBook: OrderBook,
  marginVault: MarginVault,
  mockUSDC: MockUSDC,
  bidTrader: HardhatEthersSigner,
  askTrader: HardhatEthersSigner,
  price: bigint,
  size: bigint,
  leverage: bigint
): Promise<{ bidOrderId: bigint; askOrderId: bigint; fillPrice: bigint; fillSize: bigint }> {
  const vaultAddr = await marginVault.getAddress();
  const marginPerOrder = size / leverage;

  await mockUSDC.connect(bidTrader).approve(vaultAddr, marginPerOrder * 2n);
  await mockUSDC.connect(askTrader).approve(vaultAddr, marginPerOrder * 2n);
  await marginVault.connect(bidTrader).deposit(marginPerOrder * 2n);
  await marginVault.connect(askTrader).deposit(marginPerOrder * 2n);

  const askTx = await orderBook.connect(askTrader).placeOrder(false, price, size, leverage);
  const askReceipt = await askTx.wait();
  const askOrderId = (askReceipt?.logs.find(
    (l: any) => l.fragment?.name === "OrderPlaced"
  ) as any)?.args[0] ?? 0n;

  const bidTx = await orderBook.connect(bidTrader).placeOrder(true, price + 1n * PRICE_SCALE, size, leverage);
  const bidReceipt = await bidTx.wait();
  const bidOrderId = (bidReceipt?.logs.find(
    (l: any) => l.fragment?.name === "OrderPlaced"
  ) as any)?.args[0] ?? 0n;

  const fillPrice = price;
  const fillSize = size;

  return { bidOrderId, askOrderId, fillPrice, fillSize };
}

export function computeLongLiquidationPrice(entryPrice: bigint, leverage: bigint): bigint {
  const MAINTENANCE_MARGIN_RATIO = 5n * 10n ** 16n;
  const base = (entryPrice * (leverage - 1n)) / leverage;
  const maint = (entryPrice * MAINTENANCE_MARGIN_RATIO) / 10n ** 18n;
  return base + maint;
}

export function computeShortLiquidationPrice(entryPrice: bigint, leverage: bigint): bigint {
  const MAINTENANCE_MARGIN_RATIO = 5n * 10n ** 16n;
  const base = (entryPrice * (leverage + 1n)) / leverage;
  const maint = (entryPrice * MAINTENANCE_MARGIN_RATIO) / 10n ** 18n;
  return base - maint;
}

export async function createTestWallet(): Promise<HardhatEthersSigner> {
  const wallet = ethers.Wallet.createRandom();
  return ethers.provider.getSigner(await wallet.getAddress());
}

export async function increaseTime(seconds: number): Promise<void> {
  await ethers.provider.send("evm_increaseTime", [seconds]);
  await ethers.provider.send("evm_mine", []);
}
