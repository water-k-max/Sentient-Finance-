import { useState, useEffect } from "react";
import { ethers } from "ethers";
import { CONTRACT_ADDRESSES, SOMNIA_RPC_URL } from "../config/addresses";

const PERP_ENGINE_ABI = [
  "event PositionOpened(bytes32 indexed pairId, address indexed trader, uint256 size, uint256 margin, bool isLong, uint256 entryPrice)",
  "event PositionClosed(bytes32 indexed pairId, address indexed trader, uint256 size, uint256 pnl, uint256 exitPrice)",
  "event OrderPlaced(bytes32 indexed pairId, address indexed trader, uint256 size, uint256 price, bool isLong)",
  "event OrderCancelled(bytes32 indexed pairId, address indexed trader, uint256 size, uint256 price, bool isLong)",
  "event PositionLiquidated(bytes32 indexed pairId, address indexed trader, uint256 size, uint256 remainingMargin, uint256 price)",
  "event Rebalance(bytes32 indexed pairId, uint256 oldPrice, uint256 newPrice, uint256 sizeChange)",
  "function getMarkPrice(bytes32 pairId) view returns (uint256)",
];

const SIZE_SCALE = 1e6;
const PRICE_SCALE = 1e8;

interface FeedEvent {
  type: "open" | "close" | "place" | "cancel" | "liquidation" | "rebalance";
  trader?: string;
  size: string;
  price: string;
  ts: number;
  side?: string;
}

function formatSize(raw: bigint): string {
  const val = Number(raw) / SIZE_SCALE;
  return val >= 1000 ? `${(val / 1000).toFixed(1)}k` : val.toFixed(2);
}

function formatPrice(raw: bigint): string {
  const val = Number(raw) / PRICE_SCALE;
  return val.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

function parseLog(log: ethers.Log, iface: ethers.Interface): FeedEvent | null {
  try {
    const parsed = iface.parseLog(log);
    if (!parsed) return null;

    const base: FeedEvent = {
      type: "place",
      size: "",
      price: "",
      ts: Date.now(),
    };

    switch (parsed.name) {
      case "PositionOpened": {
        const s = parsed.args.size as bigint;
        const p = parsed.args.entryPrice as bigint;
        return {
          ...base,
          type: "open",
          trader: (parsed.args.trader as string).slice(0, 6) + "…",
          size: `${formatSize(s)} USDC`,
          price: `$${formatPrice(p)}`,
          side: parsed.args.isLong ? "Long" : "Short",
        };
      }
      case "PositionClosed": {
        const s = parsed.args.size as bigint;
        const pnl = Number(parsed.args.pnl) / 1e6;
        return {
          ...base,
          type: "close",
          trader: (parsed.args.trader as string).slice(0, 6) + "…",
          size: `${formatSize(s)} USDC`,
          price: `PnL $${pnl >= 0 ? "+" : ""}${pnl.toFixed(2)}`,
          side: pnl >= 0 ? "Win" : "Loss",
        };
      }
      case "OrderPlaced": {
        const s = parsed.args.size as bigint;
        const p = parsed.args.price as bigint;
        return {
          ...base,
          type: "place",
          trader: (parsed.args.trader as string).slice(0, 6) + "…",
          size: `${formatSize(s)} USDC @ $${formatPrice(p)}`,
          side: parsed.args.isLong ? "Bid" : "Ask",
        };
      }
      case "OrderCancelled": {
        const s = parsed.args.size as bigint;
        const p = parsed.args.price as bigint;
        return {
          ...base,
          type: "cancel",
          trader: (parsed.args.trader as string).slice(0, 6) + "…",
          size: `${formatSize(s)} USDC @ $${formatPrice(p)}`,
          side: parsed.args.isLong ? "Bid" : "Ask",
        };
      }
      case "PositionLiquidated": {
        const s = parsed.args.size as bigint;
        const p = parsed.args.price as bigint;
        const rem = Number(parsed.args.remainingMargin) / 1e6;
        return {
          ...base,
          type: "liquidation",
          trader: (parsed.args.trader as string).slice(0, 6) + "…",
          size: `${formatSize(s)} USDC (rem ${rem.toFixed(2)})`,
          price: `$${formatPrice(p)}`,
        };
      }
      case "Rebalance": {
        const oldP = parsed.args.oldPrice as bigint;
        const newP = parsed.args.newPrice as bigint;
        const sc = Number(parsed.args.sizeChange) / 1e6;
        return {
          ...base,
          type: "rebalance",
          size: `${sc >= 0 ? "+" : ""}${sc.toFixed(2)} USDC`,
          price: `${formatPrice(oldP)} → ${formatPrice(newP)}`,
        };
      }
      default:
        return null;
    }
  } catch {
    return null;
  }
}

export function useEventFeed(_pair: string, _pollInterval = 5000) {
  const [events, setEvents] = useState<FeedEvent[]>([]);

  useEffect(() => {
    const peAddr = CONTRACT_ADDRESSES.perpEngine;
    if (!peAddr || peAddr === ethers.ZeroAddress) return;

    let cancelled = false;
    const provider = new ethers.JsonRpcProvider(SOMNIA_RPC_URL);
    const iface = new ethers.Interface(PERP_ENGINE_ABI);

    const fetch = async () => {
      try {
        const currentBlock = await provider.getBlockNumber();
        const fromBlock = currentBlock - 500;

        const logs = await provider.getLogs({
          address: peAddr,
          fromBlock,
          toBlock: currentBlock,
        });

        if (cancelled) return;

        const parsed = logs
          .map((l) => parseLog(l, iface))
          .filter((e): e is FeedEvent => e !== null)
          .reverse()
          .slice(0, 50);

        if (parsed.length > 0) {
          setEvents(parsed);
        }
      } catch {
        // silent
      }
    };

    fetch();
    const interval = setInterval(fetch, 5000);
    return () => { cancelled = true; clearInterval(interval); };
  }, []);

  return events;
}
