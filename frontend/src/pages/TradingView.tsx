import { useState, useCallback } from "react";
import OrderBook from "../components/OrderBook";
import TradeForm from "../components/TradeForm";
import PositionsPanel from "../components/PositionsPanel";
import DepositPanel from "../components/DepositPanel";
import EventFeed from "../components/EventFeed";
import PriceChart from "../components/PriceChart";
import { useWallet } from "../hooks/useWallet";
import { useOrderBook } from "../hooks/useOrderBook";
import { usePosition } from "../hooks/usePosition";
import { useEventFeed } from "../hooks/useEventFeed";
import { isDeployed as checkDeployed } from "../config/addresses";
import { useOraclePrice } from "../hooks/useOraclePrice";
import { useTrade } from "../hooks/useTrade";

type TradingPair = "BTC-USD" | "ETH-USD" | "SOL-USD";

const PAIR_SYMBOLS: Record<TradingPair, string> = {
  "BTC-USD": "BTC",
  "ETH-USD": "ETH",
  "SOL-USD": "SOL",
};

export default function TradingView() {
  const [pair, setPair] = useState<TradingPair>("BTC-USD");
  const symbol = PAIR_SYMBOLS[pair];

  const liveOrderBook = useOrderBook(pair);
  const { address, signer, connected } = useWallet();
  const { position: livePosition, health, collateral } = usePosition(address);
  const liveEvents = useEventFeed(pair);
  const isDeployed = checkDeployed();
  const isLive = isDeployed && connected;
  const { price: oraclePrice, history: priceHistory } = useOraclePrice(pair, 2000);
  const [txStatus, setTxStatus] = useState<string | null>(null);
  const { executeTrade, executeClosePosition } = useTrade();

  const handleTrade = useCallback(async (type: "buy" | "sell", size: number, leverage: number, price?: number) => {
    if (!isLive || !signer) {
      setTxStatus("failed");
      setTimeout(() => setTxStatus(null), 3000);
      return;
    }

    setTxStatus("pending");
    try {
      const result = await executeTrade(signer, pair, type, size, leverage, price);
      if (result.success) {
        setTxStatus("confirmed");
        setTimeout(() => setTxStatus(null), 3000);
      } else {
        setTxStatus("failed");
        setTimeout(() => setTxStatus(null), 5000);
      }
    } catch {
      setTxStatus("failed");
      setTimeout(() => setTxStatus(null), 5000);
    }
  }, [isLive, signer, pair, executeTrade]);

  if (!isDeployed) {
    return (
      <div className="flex items-center justify-center h-[calc(100vh-7rem)] text-gray-500">
        <div className="text-center space-y-4">
          <div className="text-4xl font-heading text-cyan glow-text">SENTIENT FINANCE</div>
          <div className="text-sm">Connect wallet to view live data</div>
        </div>
      </div>
    );
  }

  const handleClosePosition = async () => {
    if (!signer) return;
    await executeClosePosition(signer, pair);
  };

  return (
    <div className="grid grid-cols-12 gap-0 h-[calc(100vh-7rem)]">
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
        {liveOrderBook.loading ? (
          <div className="flex-1 flex items-center justify-center text-gray-600 text-sm">Loading...</div>
        ) : (
          <OrderBook bids={liveOrderBook.bids} asks={liveOrderBook.asks} />
        )}
      </div>

      <div className="col-span-6 flex flex-col">
        <div className="flex-1 border-b border-border">
          <PriceChart history={priceHistory} pair={pair} />
        </div>
        <div className="p-4">
          <TradeForm onTrade={handleTrade} symbol={symbol} isLive={isLive} txStatus={txStatus} oraclePrice={oraclePrice ?? 0} />
        </div>
      </div>

      <div className="col-span-3 flex flex-col">
        <div className="border-b border-border">
          <PositionsPanel
            position={livePosition ?? undefined}
            markPrice={oraclePrice ?? undefined}
            health={health}
            collateral={collateral}
            onClosePosition={handleClosePosition}
          />
        </div>
        <DepositPanel signer={signer} />
        <div className="flex-1 overflow-hidden flex flex-col">
          <div className="px-4 py-2 border-b border-border text-sm text-gray-400 font-heading">
            AGENT ACTIVITY <span className="text-green ml-2">● LIVE</span>
          </div>
          <EventFeed events={liveEvents} />
        </div>
      </div>
    </div>
  );
}
