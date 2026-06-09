import { useState, useEffect } from "react";
import { ethers } from "ethers";
import { CONTRACT_ADDRESSES, SOMNIA_RPC_URL } from "../config/addresses";

const PERP_ENGINE_ABI = [
  "function getMarkPrice(bytes32 pairId) view returns (uint256)",
  "function totalVolume() view returns (uint256)",
];

const ORACLE_ADAPTER_ABI = [
  "function latestPrice() view returns (uint256)",
];

interface PricePoint {
  t: number;
  p: number;
}

export function useOraclePrice(_pair: string, pollInterval = 2000) {
  const [price, setPrice] = useState<number | null>(null);
  const [history, setHistory] = useState<PricePoint[]>([]);

  useEffect(() => {
    const addr = CONTRACT_ADDRESSES.oracleAdapter;
    if (!addr || addr === ethers.ZeroAddress) return;

    let cancelled = false;
    const provider = new ethers.JsonRpcProvider(SOMNIA_RPC_URL);
    const oracle = new ethers.Contract(addr, ORACLE_ADAPTER_ABI, provider);

    const fetch = async () => {
      try {
        const raw: bigint = await oracle.latestPrice();
        if (cancelled) return;
        const usd = Number(raw) / 1e8;
        if (usd > 0) {
          setPrice(usd);
          setHistory((prev) => {
            const next = [...prev, { t: Date.now(), p: usd }];
            return next.slice(-300);
          });
        }
      } catch {
        // silent
      }
    };

    fetch();
    const interval = setInterval(fetch, pollInterval);
    return () => { cancelled = true; clearInterval(interval); };
  }, [_pair, pollInterval]);

  return { price, history };
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
          totalVolume: Number(vol) / 1e6,
          activePairs: 3,
          markPrice: Number(markPrice) / 1e8,
        });
      } catch {
        // silent
      }
    };

    fetch();
    const interval = setInterval(fetch, pollInterval);
    return () => { cancelled = true; clearInterval(interval); };
  }, [pollInterval]);

  return stats;
}
