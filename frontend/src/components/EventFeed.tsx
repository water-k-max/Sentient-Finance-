import { useEffect, useRef } from "react";

export default function EventFeed({ events }: { events: string[] }) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = 0;
    }
  }, [events]);

  const getEventColor = (event: string) => {
    if (event.includes("LP Agent")) return "text-cyan";
    if (event.includes("Sentinel")) return "text-yellow-500";
    if (event.includes("matched")) return "text-green";
    if (event.includes("liquidat")) return "text-red";
    if (event.includes("Buy") || event.includes("Sell")) return "text-white";
    return "text-gray-400";
  };

  return (
    <div
      ref={containerRef}
      className="flex-1 overflow-y-auto p-4 space-y-2 text-xs"
    >
      {events.map((event, i) => (
        <div
          key={i}
          className={`border-l-2 border-border pl-3 py-1 ${getEventColor(event)}`}
        >
          <span className="text-gray-600 mr-2">
            {new Date().toLocaleTimeString()}
          </span>
          {event}
        </div>
      ))}
    </div>
  );
}
