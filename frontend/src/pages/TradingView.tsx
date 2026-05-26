import { useState, useEffect } from "react";
import OrderBook from "../components/OrderBook";
import TradeForm from "../components/TradeForm";
import PositionsPanel from "../components/PositionsPanel";
import EventFeed from "../components/EventFeed";
import PriceChart from "../components/PriceChart";

type TradingPair = "BTC-USD" | "ETH-USD" | "SOL-USD";

const PAIR_CONFIG: Record<TradingPair, { midPrice: number; symbol: string; step: number; vol: number }> = {
  "BTC-USD": { midPrice: 50000, symbol: "BTC", step: 50, vol: 200 },
  "ETH-USD": { midPrice: 3000, symbol: "ETH", step: 5, vol: 15 },
  "SOL-USD": { midPrice: 150, symbol: "SOL", step: 0.5, vol: 1 },
};

export default function TradingView() {
  const [pair, setPair] = useState<TradingPair>("BTC-USD");
  const config = PAIR_CONFIG[pair];

  const [bids, setBids] = useState<Array<{ price: number; size: number }>>([]);
  const [asks, setAsks] = useState<Array<{ price: number; size: number }>>([]);
  const [events, setEvents] = useState<string[]>([]);
  const [priceHistory, setPriceHistory] = useState<number[]>([]);

  // Reinitialize data when pair changes
  useEffect(() => {
    const { midPrice, step, vol, symbol } = config;
    const initialBids = Array.from({ length: 12 }, (_, i) => ({
      price: midPrice - (i + 1) * step,
      size: parseFloat((Math.random() * 2 + 0.1).toFixed(4)),
    }));
    const initialAsks = Array.from({ length: 12 }, (_, i) => ({
      price: midPrice + (i + 1) * step,
      size: parseFloat((Math.random() * 2 + 0.1).toFixed(4)),
    }));
    setBids(initialBids);
    setAsks(initialAsks);

    const history = Array.from({ length: 50 }, (_, i) =>
      midPrice + Math.sin(i * 0.2) * vol + (Math.random() - 0.5) * vol / 2
    );
    setPriceHistory(history);

    setEvents([
      `LP Agent placed bid at $${(midPrice - step).toLocaleString()} | 1.0000 ${symbol}`,
      `LP Agent placed ask at $${(midPrice + step).toLocaleString()} | 1.0000 ${symbol}`,
      `Order matched: 0.5000 ${symbol} @ $${midPrice.toLocaleString()}`,
      `Sentinel monitoring 3 open ${symbol} positions`,
    ]);
  }, [pair, config]);

  useEffect(() => {
    const interval = setInterval(() => {
      const { step } = config;
      setBids((prev) =>
        prev.map((b) => ({
          ...b,
          size: parseFloat(Math.max(0.05, b.size + (Math.random() - 0.5) * 0.3).toFixed(4)),
        }))
      );
      setAsks((prev) =>
        prev.map((a) => ({
          ...a,
          size: parseFloat(Math.max(0.05, a.size + (Math.random() - 0.5) * 0.3).toFixed(4)),
        }))
      );

      setPriceHistory((prev) => {
        const last = prev[prev.length - 1];
        const next = last + (Math.random() - 0.5) * step * 2;
        return [...prev.slice(1), next];
      });
    }, 3000);
    return () => clearInterval(interval);
  }, [pair, config]);

  const handleTrade = (type: "buy" | "sell", size: number, leverage: number, price?: number) => {
    const event = `${type === "buy" ? "Buy" : "Sell"} order placed: ${size.toFixed(4)} ${config.symbol} @ ${price ? `$${price.toLocaleString()}` : "market"} | ${leverage}x`;
    setEvents((prev) => [event, ...prev]);
  };

  return (
    <div className="grid grid-cols-12 gap-0 h-[calc(100vh-7rem)]">
      {/* Left: Order Book */}
      <div className="col-span-3 border-r border-border flex flex-col">
        <div className="px-4 py-2 border-b border-border flex items-center justify-between">
          <span className="text-sm text-gray-400 font-heading">ORDER BOOK</span>
          <select
            value={pair}
            onChange={(e) => setPair(e.target.value as TradingPair)}
            className="bg-surface border border-border text-cyan text-sm rounded px-2 py-1 font-mono focus:border-cyan outline-none"
          >
            <option value="BTC-USD">BTC-USD</option>
            <option value="ETH-USD">ETH-USD</option>
            <option value="SOL-USD">SOL-USD</option>
          </select>
        </div>
        <OrderBook bids={bids} asks={asks} />
      </div>

      {/* Center: Chart + Trade Form */}
      <div className="col-span-6 flex flex-col">
        <div className="flex-1 border-b border-border">
          <PriceChart data={priceHistory} pair={pair} />
        </div>
        <div className="p-4">
          <TradeForm onTrade={handleTrade} symbol={config.symbol} />
        </div>
      </div>

      {/* Right: Positions + Events */}
      <div className="col-span-3 flex flex-col">
        <div className="border-b border-border">
          <PositionsPanel symbol={config.symbol} />
        </div>
        <div className="flex-1 overflow-hidden flex flex-col">
          <div className="px-4 py-2 border-b border-border text-sm text-gray-400 font-heading">
            AGENT ACTIVITY
          </div>
          <EventFeed events={events} />
        </div>
      </div>
    </div>
  );
}
