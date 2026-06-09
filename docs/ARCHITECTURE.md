# Architecture — Sentient Finance

## System Overview

Sentient Finance is a fully on-chain perpetual swap matching engine that uses Somnia's reactive execution layer to operate without any off-chain keeper infrastructure.

## Contract Dependency Graph

```
                     PerpEngine.sol
                    (coordinator)
                      /    |    \
                     /     |     \
            OrderBook.sol  |  SentimentOracle.sol
                 /         |       |        \
                /          |       |         \
          MarginVault.sol ←─┘   AgentOracle  SomniaPriceOracle
                |    \              (Somnia    (keeper median)
                |     \          JSON API)
                |      \        MockPriceFeed / MockUSDC.sol
                |       \       (test)        (collateral)
                |        \
    LiquidationSentinel  AgentInterface.sol
                             /    |    \
                            /     |     \
                 LiquidityProvider  EnhancedLiquidityProviderAgent
                   Agent (base)     (AI-augmented, uses sentiment)
                                         |
                                   SentimentOracle (reads sentiment data)
```

## Data Flow

### 1. Order Placement → Matching
```
User calls PerpEngine.openPosition()
  → OrderBook.placeOrder()
    → MarginVault.lockMargin()
    → Insert into heap (bid/ask)
    → _attemptMatch()
      → recordFill(pairId, price, size)   ← VWAP mark price history
      → If bestBid >= bestAsk:
        → MarginVault.settlePosition()
          → Create long + short positions
          → Compute liquidation prices
          → Track in monitored list
      → Emit OrderMatched
```

### 2. Price Update → Full Reactive Cascade
```
OracleAdapter / SentimentOracle / SomniaPriceOracle
  → Emit PriceUpdated
    → Somnia Reactive Layer detects event
      → AgentInterface.onEvent()
        → _executeCascade(newPrice):
            Step 1: MarginVault.updateAllPnL()
              → For each tracked position:
                → Compute unrealized PnL
                → Update margin health
                → Emit PnLUpdated

            Step 2: LiquidationSentinel.checkAllPositions()
              → For each tracked trader (reverse iteration):
                → If marginHealth < 5%:
                  → MarginVault.liquidate()
                  → Emit LiquidationExecuted

            Step 3: LiquidityProviderAgent.rebalance()
              → If price move > threshold (1%):
                → Cancel existing orders
                → Compute new bid/ask (mid ± spread)
                → Adjust spread if volatility high
                → Place new orders

            Step 4: EnhancedLiquidityProviderAgent.rebalance()
              → Uses sentiment multiplier + volatility score
              → effectiveSpread = baseSpread × (1 + vol/100) × sentimentMultiplier

            Step 5: Emit SentimentAnalysisTriggered
```

### 3. SentimentOracle — Multi-Agent Data Flow
```
Admin triggers (separate transactions, require STT deposits):
  ┌─ requestApiPrice() ──→ Somnia Agent 1 (JSON API) → CoinGecko → apiPrice
  ├─ requestWebsitePrice() → Somnia Agent 2 (LLM Parse) → CoinDesk → websitePrice
  └─ analyzeSentiment()  ─→ Somnia Agent 3 (LLM Inference) → Headline → sentiment
    + computeVolatilityScore() → Somnia Agent 3 (LLM Inference) → Price history → volatilityScore

All callbacks arrive asynchronously → SentimentOracle stores results:

_checkDivergence():
  if |apiPrice - websitePrice| < 1%:
    consensusPrice = (apiPrice + websitePrice) / 2
  else:
    consensusPrice = min(apiPrice, websitePrice)

EnhancedLPAgent reads:
  sentimentOracle.consensusPrice()   →  rebalance() argument
  sentimentOracle.sentiment()        →  onSentimentUpdate() → sentimentMultiplierBps
  sentimentOracle.volatilityScore()  →  onVolatilityUpdate() → lastVolatilityScore
```

## Storage Model

### OrderBook
- **Heap-based order storage** — Max-heap for bids (highest first), min-heap for asks (lowest first)
- **O(log n) insertion** — Sift up/down for heap maintenance
- **O(1) best price access** — Root of heap is always best
- **recordFill auto-called** — Each match writes fill price + size to PerpEngine's circular buffer for VWAP mark price

### MarginVault
- **Position-per-trader** — One active position per address (simplified for hackathon)
- **Tracked traders array** — Linear iteration for PnL updates (optimized in production with sorted linked list)
- **5% maintenance margin** — Positions below this threshold are liquidatable

### PerpEngine
- **Fill history (circular buffer)** — 50 most recent fills per pair for VWAP mark price computation
- **Funding interval** — 8 hours between settlements
- **Multi-pair registry** — `allPairs` array + `pairRegistered` mapping

## Gas Considerations

| Operation | Estimated Gas | Notes |
|-----------|--------------|-------|
| placeOrder (no match) | ~200k | Heap insert + margin lock |
| placeOrder (match) | ~400k | Heap ops + position settlement |
| updateAllPnL (10 positions) | ~500k | Linear scan, scales with positions |
| liquidate | ~150k | Position close + cleanup |
| LP rebalance (base) | ~600k | Cancel 2 orders + place 2 new |
| Enhanced LP rebalance | ~650k | Same as base + sentiment oracle read |
| Full reactive cascade | ~1.5M | All 5 steps (PnL + liquidation + LP + enhanced LP + event) |

On Somnia's MultiStream consensus with IceDB, these costs are significantly lower than on standard EVM chains due to parallel execution and efficient state access.

## Security Model

1. **Authorization** — Only authorized contracts can call MarginVault's critical functions
2. **No external liquidation** — Only the Sentinel can liquidate (prevents griefing)
3. **Re-entrancy safe** — No external calls during state mutations
4. **Overflow protected** — Solidity 0.8.x native checks + explicit `unchecked` where safe
5. **Cascade isolation** — Each step in `_executeCascade()` is wrapped in `try/catch` so a single failing component never blocks the entire system
