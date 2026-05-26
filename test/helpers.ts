import { ethers } from "hardhat";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { OrderBook, MarginVault } from "../typechain-types";
import { PRICE_SCALE, SIZE_SCALE } from "./fixtures";

/**
 * Place two crossing orders (bid + ask) that will match.
 * Returns the matched order IDs and fill details.
 */
export async function placeMatchingOrders(
  orderBook: OrderBook,
  marginVault: MarginVault,
  bidTrader: HardhatEthersSigner,
  askTrader: HardhatEthersSigner,
  price: bigint,
  size: bigint,
  leverage: bigint
): Promise<{ bidOrderId: bigint; askOrderId: bigint; fillPrice: bigint; fillSize: bigint }> {
  const notional = (size * price) / SIZE_SCALE;
  const marginPerOrder = notional / leverage;

  await marginVault.connect(bidTrader).deposit(marginPerOrder * 2n);
  await marginVault.connect(askTrader).deposit(marginPerOrder * 2n);

  // Place ask first
  const askTx = await orderBook.connect(askTrader).placeOrder(false, price, size, leverage);
  const askReceipt = await askTx.wait();
  const askOrderId = (askReceipt?.logs.find(
    (l: any) => l.fragment?.name === "OrderPlaced"
  ) as any)?.args[0] ?? 0n;

  // Place crossing bid
  const bidTx = await orderBook.connect(bidTrader).placeOrder(true, price + 1n * PRICE_SCALE, size, leverage);
  const bidReceipt = await bidTx.wait();
  const bidOrderId = (bidReceipt?.logs.find(
    (l: any) => l.fragment?.name === "OrderPlaced"
  ) as any)?.args[0] ?? 0n;

  const fillPrice = price; // ask price (older order)
  const fillSize = size;

  return { bidOrderId, askOrderId, fillPrice, fillSize };
}

/**
 * Compute the price that would liquidate a long position at given leverage.
 * liqPrice = entryPrice * (leverage - 1) / leverage + entryPrice * 0.05
 */
export function computeLongLiquidationPrice(entryPrice: bigint, leverage: bigint): bigint {
  const MAINTENANCE_MARGIN_RATIO = 5n * 10n ** 16n; // 5e16 = 5%
  const base = (entryPrice * (leverage - 1n)) / leverage;
  const maint = (entryPrice * MAINTENANCE_MARGIN_RATIO) / 10n ** 18n;
  return base + maint;
}

/**
 * Compute the price that would liquidate a short position at given leverage.
 */
export function computeShortLiquidationPrice(entryPrice: bigint, leverage: bigint): bigint {
  const MAINTENANCE_MARGIN_RATIO = 5n * 10n ** 16n;
  const base = (entryPrice * (leverage + 1n)) / leverage;
  const maint = (entryPrice * MAINTENANCE_MARGIN_RATIO) / 10n ** 18n;
  return base - maint;
}

/**
 * Create a test wallet with a random private key (for gas estimation, multi-user tests).
 */
export async function createTestWallet(): Promise<HardhatEthersSigner> {
  const wallet = ethers.Wallet.createRandom();
  return ethers.provider.getSigner(await wallet.getAddress());
}

/**
 * Fast-forward block time by seconds.
 */
export async function increaseTime(seconds: number): Promise<void> {
  await ethers.provider.send("evm_increaseTime", [seconds]);
  await ethers.provider.send("evm_mine", []);
}
