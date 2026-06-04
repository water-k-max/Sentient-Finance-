import { useState, useEffect } from "react";
import { ethers } from "ethers";
import { CONTRACT_ADDRESSES, SOMNIA_RPC_URL } from "../config/addresses";

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
  error: string | null;
}

const PRICE_SCALE = 1e8;
const SIZE_SCALE = 1e6;

export function useOrderBook(pair: string, pollInterval = 2000): OrderBookState {
  const [state, setState] = useState<OrderBookState>({
    bids: [],
    asks: [],
    bestBid: 0,
    bestAsk: 0,
    loading: true,
    error: null,
  });

  useEffect(() => {
    const orderBookAddr = CONTRACT_ADDRESSES.orderBooks[pair as keyof typeof CONTRACT_ADDRESSES.orderBooks];
    if (!orderBookAddr || orderBookAddr === ethers.ZeroAddress) {
      setState((prev) => ({ ...prev, loading: false, error: null }));
      return;
    }

    let cancelled = false;
    let provider: ethers.JsonRpcProvider | null = null;

    const fetchDepth = async () => {
      try {
        if (!provider) {
          provider = new ethers.JsonRpcProvider(SOMNIA_RPC_URL);
        }
        const orderBook = new ethers.Contract(orderBookAddr, ORDERBOOK_ABI, provider);
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
          error: null,
        });
      } catch (e: any) {
        console.error("Failed to fetch order book:", e);
        if (!cancelled) {
          setState((prev) => ({
            ...prev,
            loading: false,
            error: e?.message || "Failed to fetch order book",
          }));
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
