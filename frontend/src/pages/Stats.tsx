import { useState } from "react";

export default function Stats() {
  const [stats] = useState({
    totalVolume: 1247.3821,
    openInterest: 89.45,
    fundingRate: 0.0012,
    insuranceFund: 12450.0,
    totalTrades: 1847,
    avgLeverage: 8.4,
  });

  const [fundingHistory] = useState(() =>
    Array.from({ length: 24 }, (_, i) => ({
      hour: i,
      rate: (Math.random() - 0.5) * 0.005,
    }))
  );

  return (
    <div className="p-8 max-w-6xl mx-auto">
      <h2 className="font-heading text-2xl font-bold text-cyan mb-8 glow-text">
        PROTOCOL STATISTICS
      </h2>

      {/* Stat Cards */}
      <div className="grid grid-cols-4 gap-4 mb-8">
        <StatCard label="Total Volume" value={`${stats.totalVolume.toLocaleString()} BTC`} />
        <StatCard label="Open Interest" value={`${stats.openInterest} BTC`} />
        <StatCard label="Funding Rate" value={`${(stats.fundingRate * 100).toFixed(4)}%`} />
        <StatCard label="Insurance Fund" value={`$${stats.insuranceFund.toLocaleString()}`} />
        <StatCard label="Total Trades" value={stats.totalTrades.toLocaleString()} />
        <StatCard label="Avg Leverage" value={`${stats.avgLeverage}x`} />
      </div>

      {/* Funding Rate History */}
      <div className="border border-border rounded-lg p-6 bg-surface">
        <h3 className="font-heading text-sm text-cyan mb-4">FUNDING RATE — 24H HISTORY</h3>
        <div className="flex items-end gap-1 h-32">
          {fundingHistory.map((h, i) => {
            const height = Math.abs(h.rate) * 20000;
            const color = h.rate >= 0 ? "bg-green" : "bg-red";
            return (
              <div
                key={i}
                className="flex-1 flex flex-col items-center justify-end"
                style={{ height: `${Math.max(height, 4)}%` }}
              >
                <div className={`w-full ${color} rounded-t opacity-80`} style={{ height: "100%" }} />
              </div>
            );
          })}
        </div>
        <div className="flex justify-between text-xs text-gray-600 mt-2">
          <span>24h ago</span>
          <span>Now</span>
        </div>
      </div>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="border border-border rounded-lg p-4 bg-surface">
      <div className="text-xs text-gray-500 mb-1">{label}</div>
      <div className="text-lg font-medium text-white">{value}</div>
    </div>
  );
}
