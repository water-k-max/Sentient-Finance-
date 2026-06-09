interface PositionData {
  isLong: boolean;
  entryPrice: number;
  size: number;
  margin: number;
  leverage: number;
  unrealizedPnl: number;
  liquidationPrice: number;
  isOpen: boolean;
  health: number;
}

interface CollateralData {
  wallet: number;
  vault: number;
}

export default function PositionsPanel({
  position,
  markPrice,
  health = 100,
  collateral,
  onClosePosition,
}: {
  position?: PositionData;
  markPrice?: number;
  health?: number;
  collateral?: CollateralData;
  onClosePosition?: () => void;
}) {
  return (
    <div className="p-4 space-y-4">
      {/* Collateral panel — always visible */}
      <div>
        <div className="text-sm text-gray-400 mb-2 font-heading">COLLATERAL</div>
        <div className="flex justify-between text-xs mb-1">
          <span className="text-gray-500">Wallet USDC</span>
          <span className="font-mono text-white">{collateral?.wallet.toFixed(2) ?? "—"}</span>
        </div>
        <div className="flex justify-between text-xs mb-1">
          <span className="text-gray-500">Vault Balance</span>
          <span className="font-mono text-cyan">{collateral?.vault.toFixed(2) ?? "—"}</span>
        </div>
      </div>

      {/* Margin health bar — always visible */}
      <div>
        <div className="flex justify-between text-xs mb-1">
          <span className="text-gray-500">Margin Health</span>
          <span className={`font-mono ${health < 10 ? "text-red" : health < 25 ? "text-yellow-400" : "text-green"}`}>
            {health.toFixed(1)}%
          </span>
        </div>
        <div className="h-1.5 bg-border rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-500 ${
              health < 10 ? "bg-red" : health < 25 ? "bg-yellow-500" : "bg-green"
            }`}
            style={{ width: `${Math.min(health, 100)}%` }}
          />
        </div>
      </div>

      {/* Open position details */}
      {position && position.isOpen ? (
        <div>
          <div className="text-sm text-gray-400 mb-2 font-heading">OPEN POSITION</div>
          <div className="space-y-2 text-xs">
            <div className="flex justify-between">
              <span className="text-gray-500">Side</span>
              <span className={position.isLong ? "text-green" : "text-red"}>
                {position.isLong ? "Long" : "Short"} {position.leverage}x
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Entry</span>
              <span className="text-white">${position.entryPrice.toLocaleString()}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Mark</span>
              <span className="text-white">${(markPrice ?? position.entryPrice).toLocaleString()}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Liq Price</span>
              <span className="text-red">${position.liquidationPrice.toLocaleString()}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Notional</span>
              <span className="text-white">{position.size.toFixed(2)} USDC</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Margin</span>
              <span className="text-white">{position.margin.toFixed(2)} USDC</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Unrealized PnL</span>
              <span className={`font-medium ${position.unrealizedPnl >= 0 ? "text-green" : "text-red"}`}>
                ${position.unrealizedPnl > 0 ? "+" : ""}
                {position.unrealizedPnl.toFixed(2)}
              </span>
            </div>

            {onClosePosition && (
              <button
                onClick={onClosePosition}
                className="w-full mt-3 py-2 rounded text-xs bg-red/10 text-red border border-red/30 hover:bg-red/20 transition-colors"
              >
                Close Position
              </button>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
