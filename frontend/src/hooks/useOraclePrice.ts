import { useState, useEffect } from "react";
import { ethers } from "ethers";
import { CONTRACT_ADDRESSES, SOMNIA_RPC_URL } from "../config/addresses";


const PERP_ENGINE_ABI = [
  "function getMarkPrice(bytes32 pairId) view returns (uint256)",
  "function totalVolume() view returns (uint256)",
];

export function useOraclePrice(pair: string, pollInterval = 3000): number | null {
  const [price, setPrice] = useState<number | null>(null);

  useEffect(() => {
    const oracleAddr = CONTRACT_ADDRESSES.compositeOracle;
    if (!oracleAddr || oracleAddr === ethers.ZeroAddress) return;

    let cancelled = false;
    const provider = new ethers.JsonRpcProvider(SOMNIA_RPC_URL);
    const oracle = new ethers.Contract(oracleAddr, [
      "function getLastPrice() view returns (uint256 price, uint256 timestamp)",
    ], provider);

    const fetch = async () => {
      try {
        const [raw] = await oracle.getLastPrice();
        if (cancelled) return;
        if (raw > 0n) setPrice(Number(raw) / 1e18);
      } catch (e) {
        // silent
      }
    };

    fetch();
    const interval = setInterval(fetch, pollInterval);
    return () => { cancelled = true; clearInterval(interval); };
  }, [pair, pollInterval]);

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