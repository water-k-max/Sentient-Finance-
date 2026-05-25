export default function OrderBook({
  bids,
  asks,
}: {
  bids: Array<{ price: number; size: number }>;
  asks: Array<{ price: number; size: number }>;
}) {
  const maxSize = Math.max(
    ...bids.map((b) => b.size),
    ...asks.map((a) => a.size)
  );

  return (
    <div className="flex-1 overflow-y-auto text-xs">
      {/* Asks (reversed so lowest is at bottom) */}
      <div className="flex flex-col-reverse">
        {asks.map((ask, i) => (
          <OrderRow
            key={`ask-${i}`}
            price={ask.price}
            size={ask.size}
            maxSize={maxSize}
            type="ask"
          />
        ))}
      </div>

      {/* Spread indicator */}
      <div className="py-2 px-4 border-y border-border text-center text-gray-500">
        {bids[0] && asks[0]
          ? `Spread: $${(asks[0].price - bids[0].price).toFixed(2)} (${(
              ((asks[0].price - bids[0].price) / bids[0].price) *
              100
            ).toFixed(3)}%)`
          : "No orders"}
      </div>

      {/* Bids */}
      {bids.map((bid, i) => (
        <OrderRow
          key={`bid-${i}`}
          price={bid.price}
          size={bid.size}
          maxSize={maxSize}
          type="bid"
        />
      ))}
    </div>
  );
}

function OrderRow({
  price,
  size,
  maxSize,
  type,
}: {
  price: number;
  size: number;
  maxSize: number;
  type: "bid" | "ask";
}) {
  const widthPct = (size / maxSize) * 100;
  const color = type === "bid" ? "text-green" : "text-red";
  const bg = type === "bid" ? "rgba(0, 230, 118, 0.06)" : "rgba(255, 23, 68, 0.06)";

  return (
    <div className="relative px-4 py-0.5 hover:bg-white/5 cursor-pointer group">
      <div
        className="absolute inset-0 size-bar"
        style={{ width: `${widthPct}%`, right: 0, left: "auto", background: bg }}
      />
      <div className="relative flex justify-between">
        <span className={color}>{price.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
        <span className="text-gray-400">{size.toFixed(4)}</span>
      </div>
    </div>
  );
}
