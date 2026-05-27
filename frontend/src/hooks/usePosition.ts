import { useState, useEffect } from "react";
import { ethers } from "ethers";
import { CONTRACT_ADDRESSES, SOMNIA_RPC_URL } from "../config/addresses";

const VAULT_ABI = [
  "function getPosition(address trader) view returns (tuple(address trader, bool isLong, uint256 entryPrice, uint256 size, uint256 margin, uint256 leverage, int256 unrealizedPnl, uint256 liquidationPrice, bool isOpen) position)",
  "function marginHealth(address trader) view returns (uint256)",
];

const PRICE_SCALE = 1e8;

interface PositionData {
  isLong: boolean;
  entryPrice: number;
  size: number;
  margin: number;
  leverage: number;
  unrealizedPnl: number;
  liquidationPrice: number;
  isOpen: boolean;
  health: number;
}

export function usePosition(
  address: string | null,
  pollInterval = 3000
): PositionData | null {
  const [position, setPosition] = useState<PositionData | null>(null);

  useEffect(() => {
    if (!address) {
      setPosition(null);
      return;
    }

    const vaultAddr = CONTRACT_ADDRESSES.marginVault;
    if (!vaultAddr || vaultAddr === ethers.ZeroAddress) return;

    let cancelled = false;
    let provider: ethers.JsonRpcProvider | null = null;

    const fetchPosition = async () => {
      try {
        if (!provider) {
          provider = new ethers.JsonRpcProvider(SOMNIA_RPC_URL);
        }
        const vault = new ethers.Contract(vaultAddr, VAULT_ABI, provider);
        const [pos, healthRaw] = await Promise.all([
          vault.getPosition(address),
          vault.marginHealth(address),
        ]);

        if (cancelled) return;

        if (!pos.isOpen) {
          setPosition(null);
          return;
        }

        setPosition({
          isLong: pos.isLong,
          entryPrice: Number(pos.entryPrice) / PRICE_SCALE,
          size: Number(pos.size) / 1e18,
          margin: Number(pos.margin) / 1e6,
          leverage: Number(pos.leverage),
          unrealizedPnl: Number(pos.unrealizedPnl) / 1e6,
          liquidationPrice: Number(pos.liquidationPrice) / PRICE_SCALE,
          isOpen: pos.isOpen,
          health: Number(healthRaw) / 1e16,
        });
      } catch (e) {
        console.error("Failed to fetch position:", e);
      }
    };

    fetchPosition();
    const interval = setInterval(fetchPosition, pollInterval);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [address, pollInterval]);

  return position;
}
