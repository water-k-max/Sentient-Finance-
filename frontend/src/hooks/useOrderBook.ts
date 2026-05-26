import { useState, useEffect } from "react";
import { ethers } from "ethers";
import { CONTRACT_ADDRESSES } from "../config/addresses";

// Minimal OrderBook ABI (only what we need)
const ORDERBOOK_ABI = [
  "function getOrderBookDepth(uint256 levels) view returns (uint256[] bidPrices, uint256[] bidSizes, uint256[] askPrices, uint256[] askSizes)",
  "function bestBid() view returns (uint256)",
  "function bestAsk() view returns (uint256)",
];

interface OrderBookEntry {
  price: number;
  size: number;
}

interface OrderBookState {
  bids: OrderBookEntry[];
  asks: OrderBookEntry[];
  bestBid: number;
  bestAsk: number;
  loading: boolean;
}

const PRICE_SCALE = 1e8;
const SIZE_SCALE = 1e18;

export function useOrderBook(pair: string, pollInterval = 2000): OrderBookState {
  const [state, setState] = useState<OrderBookState>({
    bids: [],
    asks: [],
    bestBid: 0,
    bestAsk: 0,
    loading: true,
  });

  useEffect(() => {
    const orderBookAddr = CONTRACT_ADDRESSES.orderBooks[pair as keyof typeof CONTRACT_ADDRESSES.orderBooks];
    if (!orderBookAddr || orderBookAddr === ethers.ZeroAddress) {
      setState((prev) => ({ ...prev, loading: false }));
      return;
    }

    let cancelled = false;
    const provider = new ethers.JsonRpcProvider(
      process.env.REACT_APP_SOMNIA_RPC_URL || "https://dream-rpc.somnia.network"
    );
    const orderBook = new ethers.Contract(orderBookAddr, ORDERBOOK_ABI, provider);

    const fetchDepth = async () => {
      try {
        const [bidPrices, bidSizes, askPrices, askSizes] = await orderBook.getOrderBookDepth(20);
        const bestBidRaw = await orderBook.bestBid();
        const bestAskRaw = await orderBook.bestAsk();

        if (cancelled) return;

        const bids: OrderBookEntry[] = bidPrices.map((p: bigint, i: number) => ({
          price: Number(p) / PRICE_SCALE,
          size: Number(bidSizes[i]) / SIZE_SCALE,
        }));

        const asks: OrderBookEntry[] = askPrices.map((p: bigint, i: number) => ({
          price: Number(p) / PRICE_SCALE,
          size: Number(askSizes[i]) / SIZE_SCALE,
        }));

        setState({
          bids,
          asks,
          bestBid: Number(bestBidRaw) / PRICE_SCALE,
          bestAsk: Number(bestAskRaw) / PRICE_SCALE,
          loading: false,
        });
      } catch (e) {
        console.error("Failed to fetch order book:", e);
        if (!cancelled) {
          setState((prev) => ({ ...prev, loading: false }));
        }
      }
    };

    fetchDepth();
    const interval = setInterval(fetchDepth, pollInterval);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [pair, pollInterval]);

  return state;
}
