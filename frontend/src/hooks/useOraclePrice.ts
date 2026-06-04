import { useState, useEffect } from "react";
import { ethers } from "ethers";
import { CONTRACT_ADDRESSES, SOMNIA_RPC_URL } from "../config/addresses";


const PERP_ENGINE_ABI = [
  "function getMarkPrice(bytes32 pairId) view returns (uint256)",
  "function totalVolume() view returns (uint256)",
];

export function useOraclePrice(_pair: string, pollInterval = 3000): number | null {
  const [price, setPrice] = useState<number | null>(null);

  useEffect(() => {
    // Read from OracleAdapter (the demo price trigger path):
    // updatePrice.ts → MockPriceFeed → OracleAdapter.updatePriceDirect() → PriceUpdated
    const addr = CONTRACT_ADDRESSES.oracleAdapter;
    if (!addr || addr === ethers.ZeroAddress) return;

    let cancelled = false;
    const provider = new ethers.JsonRpcProvider(SOMNIA_RPC_URL);
    const oracle = new ethers.Contract(addr, [
      "function latestPrice() view returns (uint256)",
    ], provider);

    const fetch = async () => {
      try {
        const raw: bigint = await oracle.latestPrice();
        if (cancelled) return;
        if (raw > 0n) setPrice(Number(raw) / 1e8);
      } catch (e) {
        // silent
      }
    };

    fetch();
    const interval = setInterval(fetch, pollInterval);
    return () => { cancelled = true; clearInterval(interval); };
  }, [_pair, pollInterval]);

  return price;
}

export function useProtocolStats(pollInterval = 5000) {
  const [stats, setStats] = useState({
    totalVolume: 0,
    activePairs: 3,
    markPrice: 0,
  });

  useEffect(() => {
    const peAddr = CONTRACT_ADDRESSES.perpEngine;
    if (!peAddr || peAddr === ethers.ZeroAddress) return;

    let cancelled = false;
    const provider = new ethers.JsonRpcProvider(SOMNIA_RPC_URL);
    const pe = new ethers.Contract(peAddr, PERP_ENGINE_ABI, provider);
    const pairId = ethers.keccak256(ethers.toUtf8Bytes("BTC-USD"));

    const fetch = async () => {
      try {
        const [vol, markPrice] = await Promise.all([
          pe.totalVolume(),
          pe.getMarkPrice(pairId),
        ]);
        if (cancelled) return;
        setStats({
          totalVolume: Number(ethers.formatUnits(vol, 18)),
          activePairs: 3,
          markPrice: Number(markPrice) / 1e8,
        });
      } catch (e) {
        // silent
      }
    };

    fetch();
    const interval = setInterval(fetch, pollInterval);
    return () => { cancelled = true; clearInterval(interval); };
  }, [pollInterval]);

  return stats;
}