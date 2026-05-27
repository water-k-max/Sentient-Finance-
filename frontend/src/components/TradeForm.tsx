import { useState } from "react";

export default function TradeForm({
  onTrade,
  symbol = "BTC",
  isLive = false,
  txStatus = null,
}: {
  onTrade: (type: "buy" | "sell", size: number, leverage: number, price?: number) => void;
  symbol?: string;
  isLive?: boolean;
  txStatus?: string | null;
}) {
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [size, setSize] = useState("0.1");
  const [leverage, setLeverage] = useState(10);
  const [price, setPrice] = useState("");
  const [orderType, setOrderType] = useState<"limit" | "market">("market");

  const estimatedMargin =
    parseFloat(size || "0") * 50000 / leverage;
  const estimatedLiqPrice =
    side === "buy"
      ? 50000 * (1 - 1 / leverage + 0.05)
      : 50000 * (1 + 1 / leverage - 0.05);

  const isSubmitting = txStatus === "pending" || txStatus === "confirming";

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;
    onTrade(
      side,
      parseFloat(size),
      leverage,
      orderType === "limit" ? parseFloat(price) : undefined
    );
  };

  const statusConfig = {
    pending: { text: "Sign in wallet...", color: "text-yellow-400" },
    confirming: { text: "Confirming on-chain...", color: "text-cyan" },
    confirmed: { text: "✅ Trade confirmed!", color: "text-green" },
    failed: { text: "❌ Transaction failed", color: "text-red" },
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {/* Side toggle */}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => setSide("buy")}
          disabled={isSubmitting}
          className={`flex-1 py-2 rounded text-sm font-medium transition-colors ${
            side === "buy"
              ? "bg-green/15 text-green border border-green/30"
              : "bg-surface text-gray-500 border border-border"
          } ${isSubmitting ? "opacity-50 cursor-not-allowed" : ""}`}
        >
          Buy / Long
        </button>
        <button
          type="button"
          onClick={() => setSide("sell")}
          disabled={isSubmitting}
          className={`flex-1 py-2 rounded text-sm font-medium transition-colors ${
            side === "sell"
              ? "bg-red/15 text-red border border-red/30"
              : "bg-surface text-gray-500 border border-border"
          } ${isSubmitting ? "opacity-50 cursor-not-allowed" : ""}`}
        >
          Sell / Short
        </button>
      </div>

      {/* Order type */}
      <div className="flex gap-4 text-xs">
        <label className="flex items-center gap-2">
          <input
            type="radio"
            checked={orderType === "market"}
            onChange={() => setOrderType("market")}
            className="accent-cyan"
            disabled={isSubmitting}
          />
          <span className="text-gray-400">Market</span>
        </label>
        <label className="flex items-center gap-2">
          <input
            type="radio"
            checked={orderType === "limit"}
            onChange={() => setOrderType("limit")}
            className="accent-cyan"
            disabled={isSubmitting}
          />
          <span className="text-gray-400">Limit</span>
        </label>
      </div>

      {/* Price (limit only) */}
      {orderType === "limit" && (
        <div>
          <label className="text-xs text-gray-500 mb-1 block">Price (USD)</label>
          <input
            type="number"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            className="w-full bg-surface border border-border rounded px-3 py-2 text-sm text-white focus:border-cyan outline-none"
            placeholder="50000"
            disabled={isSubmitting}
          />
        </div>
      )}

      {/* Size */}
      <div>
        <label className="text-xs text-gray-500 mb-1 block">Size ({symbol})</label>
        <input
          type="number"
          step="0.0001"
          value={size}
          onChange={(e) => setSize(e.target.value)}
          className="w-full bg-surface border border-border rounded px-3 py-2 text-sm text-white focus:border-cyan outline-none"
          disabled={isSubmitting}
        />
      </div>

      {/* Leverage slider */}
      <div>
        <div className="flex justify-between text-xs mb-1">
          <span className="text-gray-500">Leverage</span>
          <span className="text-cyan">{leverage}x</span>
        </div>
        <input
          type="range"
          min="1"
          max="20"
          value={leverage}
          onChange={(e) => setLeverage(parseInt(e.target.value))}
          className="w-full accent-cyan"
          disabled={isSubmitting}
        />
        <div className="flex justify-between text-xs text-gray-600">
          <span>1x</span>
          <span>20x</span>
        </div>
      </div>

      {/* Preview */}
      <div className="border border-border rounded p-3 space-y-1 text-xs">
        <div className="flex justify-between">
          <span className="text-gray-500">Margin Required</span>
          <span className="text-white">${estimatedMargin.toFixed(2)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-500">Est. Liquidation</span>
          <span className="text-red">${estimatedLiqPrice.toFixed(2)}</span>
        </div>
        {isLive && (
          <div className="flex justify-between">
            <span className="text-gray-500">Network</span>
            <span className="text-cyan">Somnia Testnet</span>
          </div>
        )}
      </div>

      {/* Transaction status */}
      {txStatus && statusConfig[txStatus as keyof typeof statusConfig] && (
        <div
          className={`text-xs text-center py-2 rounded border ${
            txStatus === "failed"
              ? "bg-red/10 border-red/30 text-red"
              : txStatus === "confirmed"
              ? "bg-green/10 border-green/30 text-green"
              : "bg-cyan-dim border-cyan/30 text-cyan"
          }`}
        >
          {statusConfig[txStatus as keyof typeof statusConfig].text}
        </div>
      )}

      {/* Submit */}
      <button
        type="submit"
        disabled={isSubmitting}
        className={`w-full py-3 rounded text-sm font-medium transition-colors ${
          side === "buy"
            ? "bg-green/15 text-green border border-green/30 hover:bg-green/25"
            : "bg-red/15 text-red border border-red/30 hover:bg-red/25"
        } ${isSubmitting ? "opacity-50 cursor-not-allowed animate-pulse" : ""}`}
      >
        {isSubmitting
          ? "Processing..."
          : `${side === "buy" ? "Buy / Long" : "Sell / Short"} ${size} ${symbol} @ ${leverage}x`}
      </button>
    </form>
  );
}