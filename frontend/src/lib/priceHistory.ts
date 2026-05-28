// Module-level singleton — persists across React component mounts/unmounts.
// Solves the tab-switch state loss problem: when TradingView unmounts
// and remounts, priceHistory retains accumulated data.

let _history: number[] = [];
const MAX_LENGTH = 100;
const listeners = new Set<() => void>();

export function getPriceHistory(): number[] {
  return _history;
}

export function addPricePoint(price: number): void {
  _history = [..._history, price].slice(-MAX_LENGTH);
  listeners.forEach((fn) => fn());
}

export function subscribeToPriceHistory(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}