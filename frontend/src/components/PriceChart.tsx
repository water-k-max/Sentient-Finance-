export default function PriceChart({ data }: { data: number[] }) {
  if (data.length === 0) return null;

  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const width = 800;
  const height = 300;
  const padding = 40;

  const points = data.map((val, i) => {
    const x = padding + (i / (data.length - 1)) * (width - padding * 2);
    const y = height - padding - ((val - min) / range) * (height - padding * 2);
    return { x, y, val };
  });

  const pathD = points
    .map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`)
    .join(" ");

  const lastPrice = data[data.length - 1];
  const firstPrice = data[0];
  const priceChange = lastPrice - firstPrice;
  const lineColor = priceChange >= 0 ? "#00E676" : "#FF1744";

  // Grid lines
  const gridLines = 5;
  const gridValues = Array.from(
    { length: gridLines },
    (_, i) => min + (range * i) / (gridLines - 1)
  );

  return (
    <div className="p-4 h-full">
      <div className="flex justify-between items-center mb-2">
        <span className="text-sm text-gray-400 font-heading">BTC-USD — MARK PRICE</span>
        <span className="text-lg font-medium" style={{ color: lineColor }}>
          ${lastPrice.toFixed(2)}
        </span>
      </div>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="w-full h-[calc(100%-2rem)]"
        preserveAspectRatio="none"
      >
        {/* Grid */}
        {gridValues.map((val, i) => {
          const y = height - padding - ((val - min) / range) * (height - padding * 2);
          return (
            <g key={i}>
              <line
                x1={padding}
                y1={y}
                x2={width - padding}
                y2={y}
                stroke="#1a1a1a"
                strokeWidth="1"
              />
              <text
                x={width - padding + 4}
                y={y + 4}
                fill="#666"
                fontSize="10"
                fontFamily="IBM Plex Mono"
              >
                ${val.toFixed(0)}
              </text>
            </g>
          );
        })}

        {/* Price line */}
        <path
          d={pathD}
          fill="none"
          stroke={lineColor}
          strokeWidth="1.5"
          vectorEffect="non-scaling-stroke"
        />

        {/* Glow effect */}
        <path
          d={pathD}
          fill="none"
          stroke={lineColor}
          strokeWidth="4"
          opacity="0.15"
          vectorEffect="non-scaling-stroke"
        />

        {/* Current price dot */}
        {points.length > 0 && (
          <circle
            cx={points[points.length - 1].x}
            cy={points[points.length - 1].y}
            r="3"
            fill={lineColor}
            opacity="0.8"
          />
        )}
      </svg>
    </div>
  );
}
