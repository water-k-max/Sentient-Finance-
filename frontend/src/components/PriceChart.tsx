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
  time: string;
  price: number;
}

export default function PriceChart({ data, pair }: { data: number[]; pair?: string }) {
  if (data.length === 0) return null;

  const lastPrice = data[data.length - 1];
  const firstPrice = data[0];
  const priceChange = lastPrice - firstPrice;
  const lineColor = priceChange >= 0 ? "#00E676" : "#FF1744";

  // Transform raw data into Recharts-compatible points
  const points: PricePoint[] = data.map((price, i) => ({
    time: `${i}`,
    price: Math.round(price * 100) / 100,
  }));

  const minPrice = Math.min(...data);
  const maxPrice = Math.max(...data);
  const padding = (maxPrice - minPrice) * 0.05 || 1; // 5% padding, minimum 1

  // Custom tooltip
  const CustomTooltip = ({ active, payload }: any) => {
    if (!active || !payload?.length) return null;
    return (
      <div className="bg-surface border border-border rounded px-3 py-2 text-xs font-mono">
        <div className="text-gray-400">Mark Price</div>
        <div className="text-white font-medium">
          ${payload[0].value.toLocaleString()}
        </div>
      </div>
    );
  };

  // Gradient definition ID
  const gradientId = "priceGradient";

  return (
    <div className="p-4 h-full">
      <div className="flex justify-between items-center mb-2">
        <span className="text-sm text-gray-400 font-heading">
          {pair || "BTC-USD"} — MARK PRICE
        </span>
        <span className="text-lg font-medium" style={{ color: lineColor }}>
          ${lastPrice.toFixed(2)}
        </span>
      </div>
      <ResponsiveContainer width="100%" height="90%">
        <AreaChart data={points}>
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor={lineColor} stopOpacity={0.15} />
              <stop offset="95%" stopColor={lineColor} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid
            stroke="#1a1a1a"
            strokeDasharray="3 3"
            vertical={false}
          />
          <XAxis
            dataKey="time"
            hide
          />
          <YAxis
            domain={[minPrice - padding, maxPrice + padding]}
            tick={{ fill: "#666", fontSize: 10, fontFamily: "IBM Plex Mono" }}
            tickFormatter={(v: number) => `$${v.toLocaleString()}`}
            width={70}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip content={<CustomTooltip />} />
          <Area
            type="monotone"
            dataKey="price"
            stroke={lineColor}
            strokeWidth={1.5}
            fill={`url(#${gradientId})`}
            dot={false}
            activeDot={{ r: 3, fill: lineColor, opacity: 0.8 }}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
