import { useEffect, useRef } from "react";

interface FeedEvent {
  type: "open" | "close" | "place" | "cancel" | "liquidation" | "rebalance";
  trader?: string;
  size: string;
  price: string;
  ts: number;
  side?: string;
}

const typeConfig: Record<string, { label: string; color: string }> = {
  open: { label: "OPEN", color: "text-green" },
  close: { label: "CLOSE", color: "text-red" },
  place: { label: "ORDER", color: "text-white" },
  cancel: { label: "CANCEL", color: "text-gray-500" },
  liquidation: { label: "LIQ", color: "text-red font-bold" },
  rebalance: { label: "REBALANCE", color: "text-cyan" },
};

export default function EventFeed({ events }: { events: FeedEvent[] }) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = 0;
    }
  }, [events]);

  return (
    <div
      ref={containerRef}
      className="flex-1 overflow-y-auto p-4 space-y-2 text-xs"
    >
      {events.map((ev, i) => {
        const cfg = typeConfig[ev.type] ?? { label: ev.type.toUpperCase(), color: "text-gray-400" };
        return (
          <div key={i} className="border-l-2 border-border pl-3 py-1 flex flex-wrap gap-x-2">
            <span className="text-gray-600 shrink-0">
              {new Date(ev.ts).toLocaleTimeString()}
            </span>
            <span className={`${cfg.color} shrink-0`}>{cfg.label}</span>
            {ev.side && (
              <span className={ev.side === "Long" || ev.side === "Bid" || ev.side === "Win" ? "text-green" : "text-red"}>
                {ev.side}
              </span>
            )}
            {ev.trader && <span className="text-gray-400">{ev.trader}</span>}
            <span className="text-white">{ev.size}</span>
            <span className="text-gray-400">{ev.price}</span>
          </div>
        );
      })}
    </div>
  );
}
