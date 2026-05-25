import { useState } from "react";

export default function TradeForm({
  onTrade,
}: {
  onTrade: (type: "buy" | "sell", size: number, leverage: number, price?: number) => void;
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

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onTrade(
      side,
      parseFloat(size),
      leverage,
      orderType === "limit" ? parseFloat(price) : undefined
    );
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {/* Side toggle */}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => setSide("buy")}
          className={`flex-1 py-2 rounded text-sm font-medium transition-colors ${
            side === "buy"
              ? "bg-green/15 text-green border border-green/30"
              : "bg-surface text-gray-500 border border-border"
          }`}
        >
          Buy / Long
        </button>
        <button
          type="button"
          onClick={() => setSide("sell")}
          className={`flex-1 py-2 rounded text-sm font-medium transition-colors ${
            side === "sell"
              ? "bg-red/15 text-red border border-red/30"
              : "bg-surface text-gray-500 border border-border"
          }`}
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
          />
          <span className="text-gray-400">Market</span>
        </label>
        <label className="flex items-center gap-2">
          <input
            type="radio"
            checked={orderType === "limit"}
            onChange={() => setOrderType("limit")}
            className="accent-cyan"
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
          />
        </div>
      )}

      {/* Size */}
      <div>
        <label className="text-xs text-gray-500 mb-1 block">Size (BTC)</label>
        <input
          type="number"
          step="0.0001"
          value={size}
          onChange={(e) => setSize(e.target.value)}
          className="w-full bg-surface border border-border rounded px-3 py-2 text-sm text-white focus:border-cyan outline-none"
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
      </div>

      {/* Submit */}
      <button
        type="submit"
        className={`w-full py-3 rounded text-sm font-medium transition-colors ${
          side === "buy"
            ? "bg-green/15 text-green border border-green/30 hover:bg-green/25"
            : "bg-red/15 text-red border border-red/30 hover:bg-red/25"
        }`}
      >
        {side === "buy" ? "Buy / Long" : "Sell / Short"} {size} BTC @ {leverage}x
      </button>
    </form>
  );
}
