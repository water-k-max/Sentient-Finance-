# Architecture — Sentient Finance

## System Overview

Sentient Finance is a fully on-chain perpetual swap matching engine that uses Somnia's reactive execution layer to operate without any off-chain keeper infrastructure.

## Contract Dependency Graph

```
                    PerpEngine.sol
                   (coordinator)
                     /    |    \
                    /     |     \
           OrderBook.sol  |  OracleAdapter.sol
                /         |       \
               /          |        \
         MarginVault.sol ←─┘     MockPriceFeed.sol
               |    \               \
               |     \            MockUSDC.sol
               |      \          (collateral)
               |       \
   LiquidationSentinel  AgentInterface.sol
                            /    \
                           /      \
                LiquidityProviderAgent  (Somnia Reactive Layer)
```

## Data Flow

### 1. Order Placement → Matching
```
User calls PerpEngine.openPosition()
  → OrderBook.placeOrder()
    → MarginVault.lockMargin()
    → Insert into heap (bid/ask)
    → _attemptMatch()
      → If bestBid >= bestAsk:
        → MarginVault.settlePosition()
          → Create long + short positions
          → Compute liquidation prices
          → Track in monitored list
      → Emit OrderMatched
```

### 2. Price Update → PnL Cascade
```
OracleAdapter.updatePrice()
  → Emit PriceUpdated
    → Somnia Reactive Layer detects event
      → AgentInterface.onEvent()
        → MarginVault.updateAllPnL()
          → For each tracked position:
            → Compute unrealized PnL
            → Update margin health
            → Emit PnLUpdated
        → LiquidationSentinel.checkAllPositions()
          → For each tracked trader:
            → If marginHealth < 5%:
              → MarginVault.liquidate()
              → Emit LiquidationExecuted
```

### 3. LP Agent Rebalancing
```
PriceUpdated event detected
  → AgentInterface triggers LP rebalance
    → LiquidityProviderAgent.rebalance()
      → If price move > threshold (1%):
        → Cancel existing orders
        → Compute new bid/ask (mid ± spread)
        → Adjust spread if volatility high
        → Place new orders via OrderBook
```

## Storage Model

### OrderBook
- **Heap-based order storage** — Max-heap for bids (highest first), min-heap for asks (lowest first)
- **O(log n) insertion** — Sift up/down for heap maintenance
- **O(1) best price access** — Root of heap is always best

### MarginVault
- **Position-per-trader** — One active position per address (simplified for hackathon)
- **Tracked traders array** — Linear iteration for PnL updates (optimized in production with sorted linked list)
- **5% maintenance margin** — Positions below this threshold are liquidatable

## Gas Considerations

| Operation | Estimated Gas | Notes |
|-----------|--------------|-------|
| placeOrder (no match) | ~200k | Heap insert + margin lock |
| placeOrder (match) | ~400k | Heap ops + position settlement |
| updateAllPnL (10 positions) | ~500k | Linear scan, scales with positions |
| liquidate | ~150k | Position close + cleanup |
| LP rebalance | ~600k | Cancel 2 orders + place 2 new |

On Somnia's MultiStream consensus with IceDB, these costs are significantly lower than on standard EVM chains due to parallel execution and efficient state access.

## Security Model

1. **Authorization** — Only authorized contracts can call MarginVault's critical functions
2. **No external liquidation** — Only the Sentinel can liquidate (prevents griefing)
3. **Re-entrancy safe** — No external calls during state mutations
4. **Overflow protected** — Solidity 0.8.x native checks + explicit `unchecked` where safe
