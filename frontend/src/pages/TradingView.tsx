import { useState, useEffect } from "react";
import OrderBook from "../components/OrderBook";
import TradeForm from "../components/TradeForm";
import PositionsPanel from "../components/PositionsPanel";
import EventFeed from "../components/EventFeed";
import PriceChart from "../components/PriceChart";

export default function TradingView() {
  // Mock data for demo
  const [bids, setBids] = useState<Array<{ price: number; size: number }>>([]);
  const [asks, setAsks] = useState<Array<{ price: number; size: number }>>([]);
  const [events, setEvents] = useState<string[]>([]);
  const [priceHistory, setPriceHistory] = useState<number[]>([]);

  // Simulate live order book data
  useEffect(() => {
    const midPrice = 50000;
    const initialBids = Array.from({ length: 12 }, (_, i) => ({
      price: midPrice - (i + 1) * 50,
      size: parseFloat((Math.random() * 2 + 0.1).toFixed(4)),
    }));
    const initialAsks = Array.from({ length: 12 }, (_, i) => ({
      price: midPrice + (i + 1) * 50,
      size: parseFloat((Math.random() * 2 + 0.1).toFixed(4)),
    }));
    setBids(initialBids);
    setAsks(initialAsks);

    // Price history
    const history = Array.from({ length: 50 }, (_, i) =>
      midPrice + Math.sin(i * 0.2) * 200 + (Math.random() - 0.5) * 100
    );
    setPriceHistory(history);

    // Initial events
    setEvents([
      "LP Agent placed bid at $49,950 | 1.0000 BTC",
      "LP Agent placed ask at $50,050 | 1.0000 BTC",
      "Order matched: 0.5000 BTC @ $50,000",
      "Sentinel monitoring 3 open positions",
    ]);
  }, []);

  // Simulate live updates
  useEffect(() => {
    const interval = setInterval(() => {
      setBids((prev) =>
        prev.map((b) => ({
          ...b,
          size: parseFloat(
            Math.max(0.05, b.size + (Math.random() - 0.5) * 0.3).toFixed(4)
          ),
        }))
      );
      setAsks((prev) =>
        prev.map((a) => ({
          ...a,
          size: parseFloat(
            Math.max(0.05, a.size + (Math.random() - 0.5) * 0.3).toFixed(4)
          ),
        }))
      );

      setPriceHistory((prev) => {
        const last = prev[prev.length - 1];
        const next = last + (Math.random() - 0.5) * 80;
        return [...prev.slice(1), next];
      });
    }, 3000);

    return () => clearInterval(interval);
  }, []);

  const handleTrade = (type: "buy" | "sell", size: number, leverage: number, price?: number) => {
    const event = `${type === "buy" ? "Buy" : "Sell"} order placed: ${size.toFixed(4)} BTC @ ${price ? `$${price.toLocaleString()}` : "market"} | ${leverage}x`;
    setEvents((prev) => [event, ...prev]);
  };

  return (
    <div className="grid grid-cols-12 gap-0 h-[calc(100vh-7rem)]">
      {/* Left: Order Book */}
      <div className="col-span-3 border-r border-border flex flex-col">
        <div className="px-4 py-2 border-b border-border text-sm text-gray-400 font-heading">
          ORDER BOOK — BTC-USD
        </div>
        <OrderBook bids={bids} asks={asks} />
      </div>

      {/* Center: Chart + Trade Form */}
      <div className="col-span-6 flex flex-col">
        <div className="flex-1 border-b border-border">
          <PriceChart data={priceHistory} />
        </div>
        <div className="p-4">
          <TradeForm onTrade={handleTrade} />
        </div>
      </div>

      {/* Right: Positions + Events */}
      <div className="col-span-3 flex flex-col">
        <div className="border-b border-border">
          <PositionsPanel />
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
