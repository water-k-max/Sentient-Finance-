import { ethers } from "ethers";
import { useCallback } from "react";
import { CONTRACT_ADDRESSES } from "../config/addresses";
import { pairToBytes32 } from "../lib/contracts";

const PERP_ENGINE_ABI = [
  "function openPosition(bytes32 pairId, bool isLong, uint256 size, uint256 leverage, uint256 limitPrice) returns (uint256 orderId)",
  "function closePosition(bytes32 pairId) external",
  "function getMarkPrice(bytes32 pairId) view returns (uint256)",
];

export function useTrade() {
  const executeTrade = useCallback(async (
    signer: ethers.Signer,
    pair: string,
    type: "buy" | "sell",
    size: number,
    leverage: number,
    limitPrice?: number,
  ): Promise<{ success: boolean; orderId?: string }> => {
    const perpEngine = new ethers.Contract(
      CONTRACT_ADDRESSES.perpEngine,
      PERP_ENGINE_ABI,
      signer,
    );
    const pairId = pairToBytes32(pair);
    const isLong = type === "buy";
    const limitPriceWei = limitPrice ? BigInt(Math.floor(limitPrice * 1e8)) : 0n;

    // Convert BTC amount to USDC 6-dec notional using current mark price
    // size (BTC) → sizeWei (18-dec) → notional (6-dec USDC) = sizeWei * markPrice / 1e20
    const markPrice = await perpEngine.getMarkPrice(pairId);
    const sizeWei = ethers.parseUnits(size.toString(), 18);
    const notional = sizeWei * markPrice / 10n ** 20n;

    const tx = await perpEngine.openPosition(pairId, isLong, notional, leverage, limitPriceWei);
    await tx.wait();
    return { success: true };
  }, []);

  const executeClosePosition = useCallback(async (
    signer: ethers.Signer,
    pair: string,
  ): Promise<boolean> => {
    const perpEngine = new ethers.Contract(
      CONTRACT_ADDRESSES.perpEngine,
      PERP_ENGINE_ABI,
      signer,
    );
    const pairId = pairToBytes32(pair);
    const tx = await perpEngine.closePosition(pairId);
    await tx.wait();
    return true;
  }, []);

  return { executeTrade, executeClosePosition };
}
