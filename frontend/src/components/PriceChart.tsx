import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

interface PricePoint {
  t: number;
  p: number;
}

export default function PriceChart({ history, pair: _pair }: { history: PricePoint[]; pair?: string }) {
  if (history.length < 2) {
    return (
      <div className="flex items-center justify-center h-full text-zinc-500 text-sm">
        Waiting for price data...
      </div>
    );
  }

  const lastPrice = history[history.length - 1].p;
  const prices = history.map(h => h.p);
  const min = Math.min(...prices) * 0.9995;
  const max = Math.max(...prices) * 1.0005;
  const firstPrice = prices[0];
  const lineColor = lastPrice >= firstPrice ? "#00E676" : "#FF1744";

  const CustomTooltip = ({ active, payload }: any) => {
    if (!active || !payload?.length) return null;
    return (
      <div className="bg-surface border border-border rounded px-3 py-2 text-xs font-mono">
        <div className="text-gray-400">BTC-USD</div>
        <div className="text-white font-medium">
          ${payload[0].value.toLocaleString()}
        </div>
      </div>
    );
  };

  return (
    <div className="p-4 h-full">
      <div className="flex justify-between items-center mb-2">
        <span className="text-sm text-gray-400 font-heading">
          BTC-USD — PRICE
        </span>
        <span className="text-lg font-medium" style={{ color: lineColor }}>
          ${lastPrice.toLocaleString()}
        </span>
      </div>
      <ResponsiveContainer width="100%" height="90%">
        <AreaChart data={history}>
          <defs>
            <linearGradient id="priceGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor={lineColor} stopOpacity={0.15} />
              <stop offset="95%" stopColor={lineColor} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="#1a1a1a" strokeDasharray="3 3" vertical={false} />
          <XAxis
            dataKey="t"
            tickFormatter={(t: number) => new Date(t).toLocaleTimeString()}
            tick={{ fontSize: 10, fill: "#64748b" }}
            tickCount={5}
          />
          <YAxis
            domain={[min, max]}
            tick={{ fill: "#666", fontSize: 10, fontFamily: "IBM Plex Mono" }}
            tickFormatter={(v: number) => `$${v.toLocaleString()}`}
            width={80}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip content={<CustomTooltip />} />
          <Area
            type="monotone"
            dataKey="p"
            stroke={lineColor}
            strokeWidth={1.5}
            fill="url(#priceGradient)"
            dot={false}
            activeDot={{ r: 3, fill: lineColor, opacity: 0.8 }}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
