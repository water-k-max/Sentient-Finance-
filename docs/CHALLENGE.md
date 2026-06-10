# Challenge: On-Chain Price Oracle Latency — To Be Addressed with Somnia Team

## Context

Sentient Finance is a fully on-chain reactive perpetual DEX on Somnia L1. The project's core
narrative is "zero off-chain keepers" — order matching, liquidations, and market making all
happen entirely on-chain via Somnia's reactive execution layer.

**However, one component remains off-chain: the price feed.**

## The Problem

### Current Architecture

```
┌──────────────────────────┐
│  Off-chain (script/CLI)  │  ← THE ONLY OFF-CHAIN COMPONENT
│  HTTP → CoinGecko API    │
│  MockPriceFeed.updatePrice() on-chain │
└──────────────────────────┘
          │ ~1s latency
          ▼
┌──────────────────────────┐
│  On-chain (Somnia L1)    │
│  OracleAdapter → emit PriceUpdated  │
│  → updateAllPnL() → Sentinel → LP  │
│  All within 1 block via reactive cascade │
└──────────────────────────┘
```

### Why the Somnia Agents Can't Serve Real-Time Prices

The Somnia JSON API Request Agent (`agentId: 13174292974160097713`) fetches CoinGecko data
via a decentralized validator subcommittee that reaches consensus before returning results:

1. User calls `createRequest(payload)` → `RequestCreated` event emitted
2. Validator subcommittee (3 nodes) each independently:
   - Pick up the event from the mempool
   - Execute an HTTP GET to CoinGecko API
   - Call `submitResponse(requestId, result, ...)`
3. Platform waits for consensus (Threshold: 2 of 3 matching results)
4. Platform calls `handleResponse(requestId, responses[], status)` on callback contract
5. Total round-trip: **30 seconds to 2 minutes**

This makes the Somnia agents unsuitable for:
- **Real-time order book price display** — traders need sub-second price updates
- **Live price chart** — needs a new data point every few seconds
- **Accurate PnL calculations** — needs the current index price, not a 60-second-old one
- **Multi-pair simultaneous pricing** — BTC, ETH, SOL all need their own agent calls

### The Sine Wave Problem

The frontend price chart currently shows a **sine wave / mock data** for ETH-USD and SOL-USD
because:

1. The `useOraclePrice` hook reads `OracleAdapter.getIndexPrice()` — but only BTC-USD had a
   MockPriceFeed update pushed. ETH-USD and SOL-USD still read 0.
2. Even for BTC-USD, the chart only gets one data point every poll interval (3s), not a
   continuous stream. The chart interpolates between points.
3. Without a high-frequency price source, the chart cannot show accurate market movement.

**The sine wave is a placeholder for what should be real price data.**

## Current Workaround

`scripts/priceFeed.ts` — fetches CoinGecko prices off-chain via HTTP and pushes them on-chain
via `MockPriceFeed.updatePrice()`. This takes ~1 second but is centralized (single caller)
and not verifiable by validators. The `demoFullFlow.ts` script combines seeding, trading, and
liquidation into a single command for the demo video.

## Questions for Somnia Team

1. **Is there a path to sub-5-second agent finalization?** What are the current bottlenecks
   (validator pickup time, HTTP latency, consensus aggregation)? Could validators cache API
   responses or pre-fetch popular endpoints?

2. **Can the agent platform support a "fire-and-forget" mode?** Instead of waiting for
   consensus, could we have a mode where the first validator response is accepted and subsequent
   responses are used for slashing/challenging if they differ? This would enable near-real-time
   oracle updates.

3. **Could Somnia expose a built-in price oracle?** If the validator nodes themselves ran
   price feed aggregators (like a Chainlink node built into the Somnia validator stack), the
   consensus step could be eliminated entirely — validators would already agree on the price
   before the request is even made.

4. **Is there a streaming/WebSocket API planned for RequestFinalized events?** Currently we
   must poll `getRequest()` or subscribe to `eth_subscribe` for event logs. A direct
   streaming endpoint would reduce the perceived latency.

5. **Can we run a hybrid model?** Use MockPriceFeed (centralized, fast) for the trading UI
   price display, but have Somnia agents verify the price periodically (every 60s) for the
   "zero keeper" proof. This would match the demo narrative: "Prices shown instantly,
   verified asynchronously by Somnia's decentralized agents."

6. **Multi-pair support:** Can we batch multiple CoinGecko queries into a single agent call?
   Currently each pair (BTC, ETH, SOL) would need its own `createRequest()`, tripling the
   cost and latency. A `fetchUintArray` or multi-URL agent function would help.

## Temporary Mitigations

| Mitigation | Latency | Tradeoff |
|-----------|---------|----------|
| MockPriceFeed with off-chain script | ~1s | Centralized, single caller |
| Somnia Agent (Threshold 2/3) | 30–120s | Decentralized but too slow for trading |
| Hybrid: Mock for UI, Agents for verification | ~1s UI, 60s verification | Best of both worlds |
| Pre-fetching + caching agent results | 0s display, 60s staleness | OK for demo, not for production |
| `scripts/priceFeed.ts` for real-time push | ~3s | Off-chain script, single caller |

## See Also
- [`KNOWN_ISSUES.md`](./KNOWN_ISSUES.md) — complete deferred fix inventory
- [`PITCH_DEMO_SCRIPT.md`](./PITCH_DEMO_SCRIPT.md) — demo video transcript

## Recommendation for Agentathon Demo

Use the **hybrid model**: MockPriceFeed for real-time UI (instant price chart, order book
reference price), Somnia agents for the "verified price" badge in AgentDashboard. This
addresses both the UX requirement (fast) and the agentathon narrative (decentralized
verification). The challenge document here serves as the honest acknowledgment that
on-chain agent latency is the current bottleneck for fully autonomous trading.