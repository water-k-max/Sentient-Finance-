import { useState, useEffect, useRef } from "react";
import { ethers } from "ethers";
import { CONTRACT_ADDRESSES, SOMNIA_RPC_URL } from "../config/addresses";

export interface FeedEvent {
  timestamp: Date;
  message: string;
  type: "match" | "liquidation" | "rebalance" | "order";
}

const ORDERBOOK_ABI = [
  "event OrderPlaced(uint256 indexed orderId, address indexed trader, bool isBid, uint256 price, uint256 size)",
  "event OrderMatched(uint256 indexed bidOrderId, uint256 indexed askOrderId, uint256 fillPrice, uint256 fillSize)",
];

const VAULT_ABI = [
  "event LiquidationExecuted(address indexed trader, uint256 liquidationPrice, uint256 remainingMargin)",
];

const LP_AGENT_ABI = [
  "event Rebalanced(uint256 midPrice, uint256 spreadBps)",
];

const PRICE_SCALE = 1e8;
const SIZE_SCALE = 1e18;

export function useEventFeed(pair = "BTC-USD", maxEvents = 50): FeedEvent[] {
  const [events, setEvents] = useState<FeedEvent[]>([]);
  const lastBlockRef = useRef<number>(0);

  useEffect(() => {
    const orderBookAddr = CONTRACT_ADDRESSES.orderBooks[pair as keyof typeof CONTRACT_ADDRESSES.orderBooks];
    const vaultAddr = CONTRACT_ADDRESSES.marginVault;
    const lpAddr = CONTRACT_ADDRESSES.liquidityProviderAgent;

    if (
      !orderBookAddr || orderBookAddr === ethers.ZeroAddress ||
      !vaultAddr || vaultAddr === ethers.ZeroAddress
    ) {
      return;
    }

    let cancelled = false;
    const provider = new ethers.JsonRpcProvider(SOMNIA_RPC_URL);
    const orderBook = new ethers.Contract(orderBookAddr, ORDERBOOK_ABI, provider);
    const vault = new ethers.Contract(vaultAddr, VAULT_ABI, provider);
    const lpAgent = new ethers.Contract(lpAddr, LP_AGENT_ABI, provider);

    const fetchEvents = async () => {
      try {
        const currentBlock = await provider.getBlockNumber();
        if (cancelled) return;

        const fromBlock = lastBlockRef.current > 0
          ? lastBlockRef.current
          : Math.max(0, currentBlock - 100);
        const toBlock = currentBlock;

        if (fromBlock >= toBlock) return;

        const [matched, placed, liquidations, rebalanced] = await Promise.allSettled([
          orderBook.queryFilter("OrderMatched", fromBlock, toBlock),
          orderBook.queryFilter("OrderPlaced", fromBlock, toBlock),
          vault.queryFilter("LiquidationExecuted", fromBlock, toBlock),
          lpAgent.queryFilter("Rebalanced", fromBlock, toBlock),
        ]);

        if (cancelled) return;

        const newEvents: FeedEvent[] = [];

        if (matched.status === "fulfilled") {
          for (const e of matched.value) {
            const args = (e as any).args;
            newEvents.push({
              timestamp: new Date(Number((e as any).blockTimestamp || 0) * 1000),
              message: `Order matched: ${(Number(args.fillSize) / SIZE_SCALE).toFixed(4)} BTC @ $${(Number(args.fillPrice) / PRICE_SCALE).toLocaleString()}`,
              type: "match",
            });
          }
        }

        if (placed.status === "fulfilled") {
          for (const e of placed.value) {
            const args = (e as any).args;
            newEvents.push({
              timestamp: new Date(Number((e as any).blockTimestamp || 0) * 1000),
              message: `${args.isBid ? "Buy" : "Sell"} order placed: ${(Number(args.size) / SIZE_SCALE).toFixed(4)} BTC @ $${(Number(args.price) / PRICE_SCALE).toLocaleString()}`,
              type: "order",
            });
          }
        }

        if (liquidations.status === "fulfilled") {
          for (const e of liquidations.value) {
            const args = (e as any).args;
            newEvents.push({
              timestamp: new Date(Number((e as any).blockTimestamp || 0) * 1000),
              message: `Sentinel liquidated ${args.trader.slice(0, 6)}...${args.trader.slice(-4)} at $${(Number(args.liquidationPrice) / PRICE_SCALE).toLocaleString()}`,
              type: "liquidation",
            });
          }
        }

        if (rebalanced.status === "fulfilled") {
          for (const e of rebalanced.value) {
            const args = (e as any).args;
            newEvents.push({
              timestamp: new Date(Number((e as any).blockTimestamp || 0) * 1000),
              message: `LP Agent rebalanced spread to ${(Number(args.spreadBps) / 100).toFixed(2)}% at $${(Number(args.midPrice) / PRICE_SCALE).toLocaleString()}`,
              type: "rebalance",
            });
          }
        }

        if (newEvents.length > 0) {
          setEvents((prev) => [...newEvents, ...prev].slice(0, maxEvents));
        }

        lastBlockRef.current = toBlock;
      } catch (e) {
        console.error("Failed to fetch events:", e);
      }
    };

    fetchEvents();
    const interval = setInterval(fetchEvents, 5000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [pair]);

  return events;
}
