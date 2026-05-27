import { useState, useEffect } from "react";
import { ethers } from "ethers";
import OrderBook from "../components/OrderBook";
import TradeForm from "../components/TradeForm";
import PositionsPanel from "../components/PositionsPanel";
import EventFeed from "../components/EventFeed";
import PriceChart from "../components/PriceChart";
import { useWallet } from "../hooks/useWallet";
import { useOrderBook } from "../hooks/useOrderBook";
import { usePosition } from "../hooks/usePosition";
import { useEventFeed } from "../hooks/useEventFeed";
import { isDeployed } from "../config/addresses";
import { getPerpEngineWithSigner, pairToBytes32 } from "../lib/contracts";
import { useOraclePrice } from "../hooks/useOraclePrice";

type TradingPair = "BTC-USD" | "ETH-USD" | "SOL-USD";

const PAIR_CONFIG: Record<TradingPair, { midPrice: number; symbol: string; step: number; vol: number }> = {
  "BTC-USD": { midPrice: 50000, symbol: "BTC", step: 50, vol: 200 },
  "ETH-USD": { midPrice: 3000, symbol: "ETH", step: 5, vol: 15 },
  "SOL-USD": { midPrice: 150, symbol: "SOL", step: 0.5, vol: 1 },
};

export default function TradingView() {
  const [pair, setPair] = useState<TradingPair>("BTC-USD");
  const config = PAIR_CONFIG[pair];

  // Live hooks (fall back to mock when not deployed)
  const liveOrderBook = useOrderBook(pair);
  const { address, signer, connected } = useWallet();
  const livePosition = usePosition(address);
  const liveEvents = useEventFeed();
  const isLive = isDeployed() && connected;
  const oraclePrice = useOraclePrice(pair);

  // Transaction status
  const [txStatus, setTxStatus] = useState<string | null>(null);

  // Mock data for pre-deployment
  const [mockBids, setMockBids] = useState<Array<{ price: number; size: number }>>([]);
  const [mockAsks, setMockAsks] = useState<Array<{ price: number; size: number }>>([]);
  const [mockEvents, setMockEvents] = useState<string[]>([]);
  const [priceHistory, setPriceHistory] = useState<number[]>([]);

  // Use oracle price for chart, fallback to mock
  useEffect(() => {
    if (oraclePrice) {
      setPriceHistory((prev) => {
        const next = [...prev, oraclePrice];
        return next.slice(-50);
      });
    }
  }, [oraclePrice]);

  // Reinitialize mock data when pair changes (only used when not deployed)
  useEffect(() => {
    if (isLive) return; // Skip mock data when live

    const { midPrice, step, vol } = config;
    const initialBids = Array.from({ length: 12 }, (_, i) => ({
      price: midPrice - (i + 1) * step,
      size: parseFloat((Math.random() * 2 + 0.1).toFixed(4)),
    }));
    const initialAsks = Array.from({ length: 12 }, (_, i) => ({
      price: midPrice + (i + 1) * step,
      size: parseFloat((Math.random() * 2 + 0.1).toFixed(4)),
    }));
    setMockBids(initialBids);
    setMockAsks(initialAsks);

    const history = Array.from({ length: 50 }, (_, i) =>
      midPrice + Math.sin(i * 0.2) * vol + (Math.random() - 0.5) * vol / 2
    );
    setPriceHistory(history);

    setMockEvents([
      `LP Agent placed bid at $${(midPrice - step).toLocaleString()} | 1.0000 ${config.symbol}`,
      `LP Agent placed ask at $${(midPrice + step).toLocaleString()} | 1.0000 ${config.symbol}`,
      `Order matched: 0.5000 ${config.symbol} @ $${midPrice.toLocaleString()}`,
      `Sentinel monitoring 3 open ${config.symbol} positions`,
    ]);
  }, [pair, config, isLive]);

  useEffect(() => {
    if (isLive) return; // Skip mock updates when live

    const interval = setInterval(() => {
      const { step: _step } = config;
      setMockBids((prev) =>
        prev.map((b) => ({
          ...b,
          size: parseFloat(Math.max(0.05, b.size + (Math.random() - 0.5) * 0.3).toFixed(4)),
        }))
      );
      setMockAsks((prev) =>
        prev.map((a) => ({
          ...a,
          size: parseFloat(Math.max(0.05, a.size + (Math.random() - 0.5) * 0.3).toFixed(4)),
        }))
      );
    }, 3000);
    return () => clearInterval(interval);
  }, [pair, config, isLive]);

  // Use live or mock data
  const bids = isLive
    ? liveOrderBook.bids.map((b) => ({ price: b.price, size: b.size }))
    : mockBids;
  const asks = isLive
    ? liveOrderBook.asks.map((a) => ({ price: a.price, size: a.size }))
    : mockAsks;
  const events = isLive
    ? liveEvents.map((e) => e.message)
    : mockEvents;

  const handleTrade = async (type: "buy" | "sell", size: number, leverage: number, price?: number) => {
    if (!isLive || !signer) {
      const event = `${type === "buy" ? "Buy" : "Sell"} order placed: ${size.toFixed(4)} ${config.symbol} @ ${price ? `$${price.toLocaleString()}` : "market"} | ${leverage}x`;
      setMockEvents((prev) => [event, ...prev]);
      return;
    }

    // Live transaction
    try {
      setTxStatus("pending");
      const perpEngine = getPerpEngineWithSigner(signer);
      const pairId = pairToBytes32(pair);
      const isLong = type === "buy";
      const sizeWei = ethers.parseUnits(size.toString(), 18);
      const limitPriceWei = price ? BigInt(Math.floor(price * 1e8)) : 0n;

      const tx = await perpEngine.openPosition(
        pairId,
        isLong,
        sizeWei,
        leverage,
        limitPriceWei
      );

      setTxStatus("confirming");
      await tx.wait();

      setTxStatus("confirmed");
      setTimeout(() => setTxStatus(null), 3000);

      const event = `${type === "buy" ? "Buy" : "Sell"} ${size.toFixed(4)} ${config.symbol} @ ${price ? `$${price.toLocaleString()}` : "market"} | ${leverage}x — ✅ Confirmed`;
      setMockEvents((prev) => [event, ...prev]);
    } catch (e: any) {
      console.error("Trade failed:", e);
      setTxStatus("failed");
      setTimeout(() => setTxStatus(null), 5000);
      const event = `❌ Trade failed: ${e?.reason || e?.message || "unknown error"}`;
      setMockEvents((prev) => [event, ...prev]);
    }
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
        {isLive && liveOrderBook.loading ? (
          <div className="flex-1 flex items-center justify-center text-gray-600 text-sm">Loading...</div>
        ) : (
          <OrderBook bids={bids} asks={asks} />
        )}
      </div>

      {/* Center: Chart + Trade Form */}
      <div className="col-span-6 flex flex-col">
        <div className="flex-1 border-b border-border">
          <PriceChart data={priceHistory} pair={pair} />
        </div>
        <div className="p-4">
          <TradeForm onTrade={handleTrade} symbol={config.symbol} isLive={isLive} txStatus={txStatus} />
        </div>
      </div>

      {/* Right: Positions + Events */}
      <div className="col-span-3 flex flex-col">
        <div className="border-b border-border">
          <PositionsPanel
            symbol={config.symbol}
            position={isLive && livePosition ? livePosition : undefined}
          />
        </div>
        <div className="flex-1 overflow-hidden flex flex-col">
          <div className="px-4 py-2 border-b border-border text-sm text-gray-400 font-heading">
            AGENT ACTIVITY {isLive && <span className="text-green ml-2">● LIVE</span>}
          </div>
          <EventFeed events={events} />
        </div>
      </div>
    </div>
  );
}
