import { useState, useEffect } from "react";
import { ethers } from "ethers";
import { CONTRACT_ADDRESSES } from "../config/addresses";

interface FeedEvent {
  timestamp: Date;
  message: string;
  type: "match" | "liquidation" | "rebalance" | "order";
}

const ORDERBOOK_ABI = [
  "event OrderPlaced(uint256 orderId, address trader, bool isBid, uint256 price, uint256 size)",
  "event OrderMatched(uint256 bidOrderId, uint256 askOrderId, uint256 fillPrice, uint256 fillSize)",
];

const VAULT_ABI = [
  "event LiquidationExecuted(address trader, uint256 liquidationPrice, uint256 remainingMargin)",
];

const LP_AGENT_ABI = [
  "event Rebalanced(uint256 midPrice, uint256 spreadBps)",
];

const PRICE_SCALE = 1e8;
const SIZE_SCALE = 1e18;

export function useEventFeed(maxEvents = 50): FeedEvent[] {
  const [events, setEvents] = useState<FeedEvent[]>([]);

  useEffect(() => {
    const orderBookAddr = CONTRACT_ADDRESSES.orderBooks["BTC-USD"];
    const vaultAddr = CONTRACT_ADDRESSES.marginVault;
    const lpAddr = CONTRACT_ADDRESSES.liquidityProviderAgent;

    if (
      !orderBookAddr || orderBookAddr === ethers.ZeroAddress ||
      !vaultAddr || vaultAddr === ethers.ZeroAddress
    ) {
      // Fallback to demo events when not deployed
      setEvents([
        { timestamp: new Date(), message: "Connect wallet and deploy contracts to see live events", type: "order" },
        { timestamp: new Date(), message: "LP Agent placed bid at $49,950 | 1.0000 BTC", type: "order" },
        { timestamp: new Date(), message: "Order matched: 0.5000 BTC @ $50,000", type: "match" },
        { timestamp: new Date(), message: "Sentinel monitoring 3 open positions", type: "liquidation" },
      ]);
      return;
    }

    const provider = new ethers.JsonRpcProvider(
      process.env.REACT_APP_SOMNIA_RPC_URL || "https://dream-rpc.somnia.network"
    );

    const orderBook = new ethers.Contract(orderBookAddr, ORDERBOOK_ABI, provider);
    const vault = new ethers.Contract(vaultAddr, VAULT_ABI, provider);
    const lpAgent = new ethers.Contract(lpAddr, LP_AGENT_ABI, provider);

    const addEvent = (message: string, type: FeedEvent["type"]) => {
      setEvents((prev) => {
        const next = [{ timestamp: new Date(), message, type }, ...prev];
        return next.slice(0, maxEvents);
      });
    };

    // Subscribe to events
    orderBook.on("OrderMatched", (_bidId: bigint, _askId: bigint, fillPrice: bigint, fillSize: bigint) => {
      addEvent(
        `Order matched: ${(Number(fillSize) / SIZE_SCALE).toFixed(4)} BTC @ $${(Number(fillPrice) / PRICE_SCALE).toLocaleString()}`,
        "match"
      );
    });

    orderBook.on("OrderPlaced", (_orderId: bigint, _trader: string, isBid: boolean, price: bigint, size: bigint) => {
      addEvent(
        `${isBid ? "Buy" : "Sell"} order placed: ${(Number(size) / SIZE_SCALE).toFixed(4)} BTC @ $${(Number(price) / PRICE_SCALE).toLocaleString()}`,
        "order"
      );
    });

    vault.on("LiquidationExecuted", (trader: string, liqPrice: bigint, _remaining: bigint) => {
      addEvent(
        `Sentinel liquidated ${trader.slice(0, 6)}...${trader.slice(-4)} at $${(Number(liqPrice) / PRICE_SCALE).toLocaleString()}`,
        "liquidation"
      );
    });

    lpAgent.on("Rebalanced", (midPrice: bigint, spreadBps: bigint) => {
      addEvent(
        `LP Agent rebalanced spread to ${(Number(spreadBps) / 100).toFixed(2)}% at $${(Number(midPrice) / PRICE_SCALE).toLocaleString()}`,
        "rebalance"
      );
    });

    return () => {
      orderBook.removeAllListeners();
      vault.removeAllListeners();
      lpAgent.removeAllListeners();
    };
  }, []);

  return events;
}
