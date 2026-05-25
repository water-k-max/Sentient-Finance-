export default function PositionsPanel() {
  // Mock position
  const position = {
    side: "Long" as const,
    entryPrice: 49800,
    markPrice: 50100,
    size: 0.5,
    margin: 2490,
    leverage: 10,
    unrealizedPnl: 150,
    health: 112,
    liqPrice: 44820,
  };

  if (!position) {
    return (
      <div className="px-4 py-8 text-center text-gray-600 text-sm">
        No open positions
      </div>
    );
  }

  const pnlColor = position.unrealizedPnl >= 0 ? "text-green" : "text-red";
  const healthPct = Math.min(position.health, 100);
  const healthColor =
    position.health > 50 ? "bg-green" : position.health > 20 ? "bg-yellow-500" : "bg-red";

  return (
    <div className="p-4">
      <div className="text-sm text-gray-400 mb-3 font-heading">OPEN POSITION</div>
      <div className="space-y-2 text-xs">
        <div className="flex justify-between">
          <span className="text-gray-500">Side</span>
          <span className={position.side === "Long" ? "text-green" : "text-red"}>
            {position.side}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-500">Entry</span>
          <span className="text-white">${position.entryPrice.toLocaleString()}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-500">Mark</span>
          <span className="text-white">${position.markPrice.toLocaleString()}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-500">Size</span>
          <span className="text-white">{position.size} BTC</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-500">Leverage</span>
          <span className="text-cyan">{position.leverage}x</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-500">Unrealized PnL</span>
          <span className={`font-medium ${pnlColor}`}>
            ${position.unrealizedPnl > 0 ? "+" : ""}
            {position.unrealizedPnl.toFixed(2)}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-500">Liquidation</span>
          <span className="text-red">${position.liqPrice.toLocaleString()}</span>
        </div>

        {/* Health bar */}
        <div className="pt-2">
          <div className="flex justify-between mb-1">
            <span className="text-gray-500">Margin Health</span>
            <span className="text-white">{position.health.toFixed(1)}%</span>
          </div>
          <div className="h-1.5 bg-border rounded overflow-hidden">
            <div
              className={`h-full ${healthColor} transition-all duration-500`}
              style={{ width: `${healthPct}%` }}
            />
          </div>
        </div>

        <button className="w-full mt-3 py-2 rounded text-xs bg-red/10 text-red border border-red/30 hover:bg-red/20 transition-colors">
          Close Position
        </button>
      </div>
    </div>
  );
}
